// SQLite persistence using Node's built-in driver (no native build step).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.KEEL_DATA_DIR || path.join(here, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = process.env.KEEL_DB || path.join(DATA_DIR, "keel.db");

export function openDb(file = DB_PATH) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive migrations for databases created by earlier versions. */
function migrate(db) {
  const cols = db.prepare("PRAGMA table_info(findings)").all().map((c) => c.name);
  // which version of the rule raised a finding, so a clarified rule can be judged before vs after
  if (!cols.includes("rule_version")) db.exec("ALTER TABLE findings ADD COLUMN rule_version INTEGER");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('creator','agency','reviewer','brand_admin')),
  team TEXT, title TEXT
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Brand kit ("brand constitution as data")
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
  type TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('blocker','major','minor','info')),
  guideline TEXT NOT NULL, rationale TEXT, config TEXT NOT NULL DEFAULT '{}',
  example_bad TEXT, example_good TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY, statement TEXT NOT NULL, value TEXT, keywords TEXT NOT NULL DEFAULT '[]',
  superseded_values TEXT NOT NULL DEFAULT '[]', source TEXT, valid_from TEXT, valid_until TEXT,
  required_disclaimer TEXT, confidential INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL,
  usage TEXT, confidential INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS confidential_terms (
  id TEXT PRIMARY KEY, term TEXT NOT NULL, reason TEXT, until TEXT
);

-- Content + workflow
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, channel TEXT NOT NULL, format TEXT NOT NULL,
  status TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), reviewer_id TEXT REFERENCES users(id),
  intent TEXT NOT NULL DEFAULT '{}', current_revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT, seeded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS revisions (
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE, number INTEGER NOT NULL,
  body TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]', author_id TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (submission_id, number)
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, rule_id TEXT, category TEXT NOT NULL, severity TEXT NOT NULL,
  engine TEXT NOT NULL, confidence REAL NOT NULL, start_pos INTEGER, end_pos INTEGER, excerpt TEXT,
  message TEXT NOT NULL, why TEXT NOT NULL, source TEXT NOT NULL DEFAULT '{}', suggestion TEXT,
  status TEXT NOT NULL DEFAULT 'open', resolution_note TEXT, resolved_by TEXT, resolved_at TEXT,
  fingerprint TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_sub ON findings(submission_id, revision);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, text TEXT NOT NULL, start_pos INTEGER, end_pos INTEGER,
  verdict TEXT NOT NULL, fact_id TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  finding_id TEXT, author_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT, actor_id TEXT, type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
-- every change to a rule; kind='clarification' changes are tracked for before/after impact
CREATE TABLE IF NOT EXISTS rule_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id TEXT NOT NULL, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'edit', note TEXT, before TEXT NOT NULL DEFAULT '{}', changed_by TEXT, changed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT, purpose TEXT NOT NULL, model TEXT,
  chars_sent INTEGER NOT NULL, redactions INTEGER NOT NULL, outcome TEXT NOT NULL,
  kept INTEGER NOT NULL DEFAULT 0, discarded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
`;

export const now = () => new Date().toISOString();
export const uid = (p = "") => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
export const j = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

export function getSetting(db, key, dflt) {
  const r = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return r ? j(r.value, dflt) : dflt;
}
export function setSetting(db, key, value) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, JSON.stringify(value));
}

/** Load the whole brand kit in the shape the review engine expects. */
export function loadBrandKit(db, { includeConfidential = true } = {}) {
  const rules = db.prepare("SELECT * FROM rules WHERE enabled=1 ORDER BY id").all()
    .map((r) => ({ ...r, config: j(r.config, {}) }));
  const facts = db.prepare("SELECT * FROM facts ORDER BY id").all()
    .filter((f) => includeConfidential || !f.confidential)
    .map((f) => ({ ...f, keywords: j(f.keywords, []), superseded_values: j(f.superseded_values, []), confidential: !!f.confidential }));
  const assets = db.prepare("SELECT * FROM assets ORDER BY kind, name").all()
    .filter((a) => includeConfidential || !a.confidential).map((a) => ({ ...a, confidential: !!a.confidential }));
  const confidential = db.prepare("SELECT * FROM confidential_terms").all();
  const brandName = getSetting(db, "brand_name", "Brand");
  return { rules, facts, assets, confidential, brandName };
}

export function logEvent(db, { submission_id = null, actor_id = null, type, detail = {} }) {
  db.prepare("INSERT INTO events(submission_id,actor_id,type,detail,created_at) VALUES(?,?,?,?,?)")
    .run(submission_id, actor_id, type, JSON.stringify(detail), now());
}
