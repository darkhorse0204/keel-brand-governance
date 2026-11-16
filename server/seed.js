// Seeds the demo workspace. Historical submissions are flagged seeded=1 and labelled
// "demo history" in the UI so nobody mistakes them for real usage data.
import { openDb, now, uid, setSetting, DB_PATH } from "./db.js";
import { reviewContent } from "./engine/index.js";
import { loadBrandKit } from "./db.js";
import { USERS, RULES, FACTS, ASSETS, CONFIDENTIAL, DEMO_DRAFTS, HISTORY_TEMPLATES, BRAND_NAME } from "./seed-data.js";
import { runReview } from "./review.js";
import fs from "node:fs";

// deterministic pseudo-random so the demo looks the same every time
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); }

export async function seed(db) {
  const t = now();
  db.exec("BEGIN");
  for (const u of USERS) db.prepare("INSERT INTO users(id,name,email,role,team,title) VALUES(?,?,?,?,?,?)").run(u.id, u.name, u.email, u.role, u.team, u.title);
  for (const r of RULES) db.prepare("INSERT INTO rules(id,title,category,type,severity,guideline,rationale,config,example_bad,example_good,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(r.id, r.title, r.category, r.type, r.severity, r.guideline, r.rationale || null, JSON.stringify(r.config || {}), r.example_bad || null, r.example_good || null, t, "u_sam");
  for (const f of FACTS) db.prepare("INSERT INTO facts(id,statement,value,keywords,superseded_values,source,valid_from,valid_until,required_disclaimer,confidential,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(f.id, f.statement, f.value ?? null, JSON.stringify(f.keywords || []), JSON.stringify(f.superseded_values || []), f.source || null, f.valid_from || null, f.valid_until || null, f.required_disclaimer || null, f.confidential ? 1 : 0, t);
  for (const a of ASSETS) db.prepare("INSERT INTO assets(id,kind,name,value,usage,confidential,updated_at) VALUES(?,?,?,?,?,?,?)").run(a.id, a.kind, a.name, a.value, a.usage || null, a.confidential ? 1 : 0, t);
  for (const c of CONFIDENTIAL) db.prepare("INSERT INTO confidential_terms(id,term,reason,until) VALUES(?,?,?,?)").run(c.id, c.term, c.reason, c.until);
  setSetting(db, "brand_name", BRAND_NAME);
  setSetting(db, "ai_enabled", true);
  db.exec("COMMIT");

  const clarifiedAt = seedHistory(db);
  clarifyRule(db, clarifiedAt);

  // two live drafts to demo the core workflow
  for (const d of DEMO_DRAFTS) {
    const id = uid("s_");
    db.prepare("INSERT INTO submissions(id,title,channel,format,status,author_id,reviewer_id,intent,current_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, d.title, d.channel, d.format, d.status || "draft", d.author, d.reviewer || null, JSON.stringify(d.intent), 1, t, t);
    if (d.status === "in_review") db.prepare("INSERT INTO events(submission_id,actor_id,type,detail,created_at) VALUES(?,?,?,?,?)").run(id, d.author, "submit", "{}", t);
    db.prepare("INSERT INTO revisions(submission_id,number,body,images,author_id,note,created_at) VALUES(?,?,?,?,?,?,?)").run(id, 1, d.body, "[]", d.author, "First draft", t);
    await runReview(db, id, { ai: false, actor: d.author });
  }
}

function seedHistory(db) {
  const rand = rng(42);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const kit = loadBrandKit(db);
  const authors = ["u_aditi", "u_aditi", "u_marcus", "u_marcus", "u_marcus"];
  const reasons = {
    "TERM-02": ["guideline_unclear", 'In product UI copy, "user" is the standard term — the rule doesn\'t say whether it applies to UI text.'],
    "A11Y-03": ["false_positive", "Legal disclaimer wording is fixed and can't be shortened."],
    "CLAIM-01": ["intentional_exception", "Member quote — the wording is theirs and Compliance approved it."],
  };
  const dayMs = 864e5;
  const start = Date.now() - 56 * dayMs;
  // demo story: Sam clarifies CLAIM-01 halfway through the history (see clarifyRule below)
  const CLARIFY_INDEX = 13;
  const decisions = {};
  const ins = db.prepare(`INSERT INTO findings(id,submission_id,revision,rule_id,category,severity,engine,confidence,start_pos,end_pos,excerpt,message,why,source,suggestion,status,resolution_note,resolved_by,resolved_at,fingerprint,created_at,rule_version)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < 34; i++) {
    const tpl = HISTORY_TEMPLATES[i % HISTORY_TEMPLATES.length];
    // later weeks improve: authors learn, so fewer mistakes over time
    const late = i > 20;
    const author = pick(authors);
    const created = new Date(start + (i / 34) * 54 * dayMs + rand() * dayMs);
    const approvedAt = new Date(created.getTime() + (6 + rand() * (late ? 20 : 60)) * 3600e3);
    const id = uid("s_");
    const status = i > 31 ? "in_review" : rand() < 0.15 ? "published" : "approved";
    db.prepare("INSERT INTO submissions(id,title,channel,format,status,author_id,reviewer_id,intent,current_revision,created_at,updated_at,approved_at,seeded) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)")
      .run(id, tpl.title, tpl.channel, tpl.format, status, author, "u_priya", "{}", late ? 1 : 2, created.toISOString(), approvedAt.toISOString(), status === "in_review" ? null : approvedAt.toISOString());
    db.prepare("INSERT INTO revisions(submission_id,number,body,images,author_id,note,created_at) VALUES(?,?,?,?,?,?,?)").run(id, 1, tpl.body, "[]", author, "First draft", created.toISOString());
    if (!late) db.prepare("INSERT INTO revisions(submission_id,number,body,images,author_id,note,created_at) VALUES(?,?,?,?,?,?,?)").run(id, 2, tpl.body, "[]", author, "Applied fixes", approvedAt.toISOString());
    const { findings } = reviewContent({ body: tpl.body, format: tpl.format, channel: tpl.channel }, kit);
    for (const f of findings) {
      if (late && rand() < 0.5) continue; // fewer issues later
      let st = rand() < 0.7 ? "accepted" : "resolved", note = null;
      const r = reasons[f.rule_id];
      const clarified = f.rule_id === "CLAIM-01" && i >= CLARIFY_INDEX;
      // fixed dismissal schedule so the demo story is stable: TERM-02 is dismissed 2 times in 3
      // (unclear rule); CLAIM-01 1 in 2 before its clarification and 1 in 6 after; A11Y-03 1 in 3
      const phase = `${f.rule_id}|${clarified}`;
      const k = (decisions[phase] = (decisions[phase] || 0) + 1);
      const every = { "TERM-02|false": [3, 2], "CLAIM-01|false": [2, 1], "CLAIM-01|true": [6, 1], "A11Y-03|false": [3, 1] }[phase];
      if (r && every && (k - 1) % every[0] < every[1]) { st = "dismissed"; note = `${r[0]}: ${r[1]}`; }
      if (f.severity === "blocker" && st === "dismissed") st = "overridden";
      if (status === "in_review") { st = "open"; note = null; }
      ins.run(uid("f_"), id, 1, f.rule_id, f.category, f.severity, f.engine, f.confidence, f.start, f.end, f.excerpt, f.message, f.why,
        JSON.stringify(f.source), f.suggestion ? JSON.stringify(f.suggestion) : null, st, note, st === "open" ? null : pick(["u_priya", author]),
        st === "open" ? null : approvedAt.toISOString(), f.fingerprint, created.toISOString(), clarified ? 2 : 1);
    }
    db.prepare("INSERT INTO events(submission_id,actor_id,type,detail,created_at) VALUES(?,?,?,?,?)").run(id, author, "submitted", "{}", created.toISOString());
    if (status !== "in_review") db.prepare("INSERT INTO events(submission_id,actor_id,type,detail,created_at) VALUES(?,?,?,?,?)").run(id, "u_priya", "approved", "{}", approvedAt.toISOString());
  }
  return new Date(start + (CLARIFY_INDEX / 34) * 54 * dayMs).toISOString();
}

/** The demo's guideline clarification: CLAIM-01 v1 -> v2, recorded exactly like a real edit. */
function clarifyRule(db, at) {
  const old = db.prepare("SELECT * FROM rules WHERE id='CLAIM-01'").get();
  const guideline = "Comparative and superlative claims (best, #1, fastest) need an approved source. Absolute promises (guaranteed, risk-free, never lose) are never allowed. Exception: a real member's quote may keep its wording if it is attributed by name and Compliance has approved it.";
  db.prepare("UPDATE rules SET guideline=?, example_good=?, version=2, updated_at=?, updated_by='u_sam' WHERE id='CLAIM-01'")
    .run(guideline, '"Fernway is the best thing I did this year." (Riya, member since 2024, approved quote)', at);
  db.prepare("INSERT INTO rule_history(rule_id,from_version,to_version,kind,note,before,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("CLAIM-01", 1, 2, "clarification", "Said when approved member quotes are allowed, and added an example.",
      JSON.stringify({ guideline: old.guideline, example_bad: old.example_bad, example_good: old.example_good, severity: old.severity }), "u_sam", at);
}

/** Wipe every table and seed again (used by the public demo's "Reset demo data" button). */
export async function resetDemo(db) {
  db.exec("BEGIN");
  for (const t of ["findings", "claims", "comments", "events", "revisions", "submissions", "sessions", "rule_history", "ai_log", "settings", "rules", "facts", "assets", "confidential_terms", "users"])
    db.exec(`DELETE FROM ${t}`);
  db.exec("COMMIT");
  await seed(db);
}

// CLI: node server/seed.js --reset
if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  if (process.argv.includes("--reset")) for (const ext of ["", "-wal", "-shm"]) fs.rmSync(DB_PATH + ext, { force: true });
  const db = openDb();
  if (db.prepare("SELECT COUNT(*) n FROM users").get().n === 0) { await seed(db); console.log("Seeded demo workspace at", DB_PATH); }
  else console.log("Database already has data; use --reset to recreate.");
}
