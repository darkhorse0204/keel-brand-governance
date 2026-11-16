// Review orchestration: runs the engine (+ optional AI), persists findings, and carries
// human decisions across revisions so nobody has to dismiss the same thing twice.
import { reviewContent } from "./engine/index.js";
import { loadBrandKit, now, uid, j, logEvent } from "./db.js";
import { aiReview, aiEnabled } from "./ai.js";
import { norm } from "./engine/text.js";

export function currentRevision(db, sub) {
  const r = db.prepare("SELECT * FROM revisions WHERE submission_id=? AND number=?").get(sub.id, sub.current_revision);
  return r && { ...r, images: j(r.images, []) };
}

const aiFingerprint = (f) => `${f.rule_id}|ai|${norm(f.excerpt)}`;

/**
 * Run a review on the submission's current revision.
 * opts.ai: true = call the AI layer; false = rules only (AI findings from the previous
 * revision are carried over if their quoted text still exists).
 */
export async function runReview(db, subId, { ai = false, actor = null, today } = {}) {
  const sub = db.prepare("SELECT * FROM submissions WHERE id=?").get(subId);
  const rev = currentRevision(db, sub);
  const kit = loadBrandKit(db);
  const result = reviewContent({ body: rev.body, format: sub.format, channel: sub.channel, images: rev.images }, kit, { today });
  let aiMeta = null;
  const findings = result.findings;

  // previous decisions, keyed by fingerprint
  const prior = db.prepare("SELECT * FROM findings WHERE submission_id=? AND revision<? AND status NOT IN ('carried') ORDER BY revision DESC").all(sub.id, rev.number);
  const priorByFp = new Map();
  for (const p of prior) if (!priorByFp.has(p.fingerprint)) priorByFp.set(p.fingerprint, p);

  if (ai && aiEnabled(db)) {
    const r = await aiReview(db, { submission_id: sub.id, body: rev.body, channel: sub.channel, format: sub.format, intent: j(sub.intent, {}) });
    aiMeta = r.ok ? { ok: true, summary: r.summary, intent: r.intent, kept: r.findings.length, discarded: r.discarded.length, at: now() } : { ok: false, error: r.error, at: now() };
    if (r.ok) {
      // the ai sometimes repeats what the rule engine already caught (same rule, same words) - keep one copy
      const dup = (f) => result.findings.some((g) => g.engine === "rules" && g.rule_id === f.rule_id && g.start != null && f.start < g.end && g.start < f.end);
      const fresh = r.findings.filter((f) => !dup(f));
      aiMeta.kept = fresh.length;
      aiMeta.duplicates = r.findings.length - fresh.length;
      for (const f of fresh) { f.fingerprint = aiFingerprint(f); findings.push(f); }
    }
  } else {
    // carry previous AI findings whose quoted text still exists in this revision
    const prevAi = db.prepare("SELECT * FROM findings WHERE submission_id=? AND revision=? AND engine='ai'").all(sub.id, rev.number - 1);
    for (const p of prevAi) {
      if (!p.excerpt || p.start_pos == null) continue;
      const idx = rev.body.indexOf(p.excerpt);
      if (idx < 0) continue;
      findings.push({ rule_id: p.rule_id, category: p.category, severity: p.severity, engine: "ai", confidence: p.confidence,
        start: idx, end: idx + p.excerpt.length, excerpt: p.excerpt, message: p.message, why: p.why,
        source: j(p.source, {}), suggestion: j(p.suggestion, null), fingerprint: p.fingerprint });
    }
    const prevMeta = db.prepare("SELECT value FROM settings WHERE key=?").get(`ai_meta:${sub.id}`);
    aiMeta = prevMeta ? j(prevMeta.value) : null;
  }
  if (aiMeta) db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`ai_meta:${sub.id}`, JSON.stringify(aiMeta));

  // persist (replace this revision's findings)
  db.exec("BEGIN");
  try {
    const keep = db.prepare("SELECT fingerprint, status, resolution_note, resolved_by, resolved_at FROM findings WHERE submission_id=? AND revision=?").all(sub.id, rev.number);
    const keepByFp = new Map(keep.map((k) => [k.fingerprint, k]));
    db.prepare("DELETE FROM findings WHERE submission_id=? AND revision=?").run(sub.id, rev.number);
    db.prepare("DELETE FROM claims WHERE submission_id=? AND revision=?").run(sub.id, rev.number);
    const ruleVersion = Object.fromEntries(kit.rules.map((r) => [r.id, r.version]));
    const ins = db.prepare(`INSERT INTO findings(id,submission_id,revision,rule_id,category,severity,engine,confidence,start_pos,end_pos,excerpt,message,why,source,suggestion,status,resolution_note,resolved_by,resolved_at,fingerprint,created_at,rule_version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const newFps = new Set();
    for (const f of findings) {
      newFps.add(f.fingerprint);
      // a decision on this revision wins; else a sticky decision (dismiss/override) from earlier revisions
      const same = keepByFp.get(f.fingerprint);
      const earlier = priorByFp.get(f.fingerprint);
      let status = "open", note = null, by = null, at = null;
      if (same && same.status !== "open") ({ status, resolution_note: note, resolved_by: by, resolved_at: at } = same);
      else if (earlier && ["dismissed", "overridden"].includes(earlier.status)) {
        status = earlier.status; note = `${earlier.resolution_note || ""} (carried from revision ${earlier.revision})`.trim(); by = earlier.resolved_by; at = earlier.resolved_at;
      }
      ins.run(uid("f_"), sub.id, rev.number, f.rule_id, f.category, f.severity, f.engine, f.confidence, f.start, f.end, f.excerpt,
        f.message, f.why, JSON.stringify(f.source || {}), f.suggestion ? JSON.stringify(f.suggestion) : null, status, note, by, at, f.fingerprint, now(), ruleVersion[f.rule_id] ?? null);
    }
    // earlier-revision open findings: fixed by an edit -> resolved, still present -> carried
    for (const p of prior.filter((x) => x.revision === rev.number - 1 && x.status === "open")) {
      db.prepare("UPDATE findings SET status=?, resolved_at=? WHERE id=?").run(newFps.has(p.fingerprint) ? "carried" : "resolved", now(), p.id);
    }
    for (const p of prior.filter((x) => x.revision === rev.number - 1 && ["dismissed", "overridden"].includes(x.status) && newFps.has(x.fingerprint))) {
      db.prepare("UPDATE findings SET status='carried' WHERE id=?").run(p.id);
    }
    const insC = db.prepare("INSERT INTO claims(id,submission_id,revision,text,start_pos,end_pos,verdict,fact_id,note) VALUES(?,?,?,?,?,?,?,?,?)");
    for (const c of result.claims) insC.run(uid("c_"), sub.id, rev.number, c.text, c.start, c.end, c.verdict, c.fact_id, c.note);
    db.prepare("UPDATE submissions SET updated_at=? WHERE id=?").run(now(), sub.id);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }

  logEvent(db, { submission_id: sub.id, actor_id: actor, type: "review_run", detail: { revision: rev.number, findings: findings.length, ai: !!ai, ai_ok: aiMeta?.ok ?? null } });
  return { stats: result.stats, ai: aiMeta };
}

/** Create a new revision from a body (manual edit or applied suggestion). Edits invalidate approval. */
export function createRevision(db, sub, { body, images, author_id, note }) {
  const rev = currentRevision(db, sub);
  const n = sub.current_revision + 1;
  db.prepare("INSERT INTO revisions(submission_id,number,body,images,author_id,note,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(sub.id, n, body, JSON.stringify(images ?? rev.images), author_id, note || null, now());
  let status = sub.status;
  if (status === "approved") status = "in_review"; // approval no longer covers this content
  db.prepare("UPDATE submissions SET current_revision=?, status=?, approved_at=CASE WHEN ?='approved' THEN approved_at ELSE NULL END, updated_at=? WHERE id=?")
    .run(n, status, status, now(), sub.id);
  if (sub.status === "approved") logEvent(db, { submission_id: sub.id, actor_id: author_id, type: "approval_invalidated", detail: { revision: n } });
  return n;
}

/** Apply a finding's suggestion to the text, producing a new revision. Never silently overrides. */
export function applySuggestion(body, finding, replacementOverride) {
  const sug = finding.suggestion;
  const replacement = replacementOverride ?? sug?.replacement;
  if (!sug || (sug.kind !== "replace" && sug.kind !== "append") || replacement == null) throw httpError(400, "This finding has no automatic fix — edit the content instead.");
  if (sug.kind === "append" && replacementOverride == null) return body.replace(/\s*$/, "") + "\n\n" + replacement;
  let { start_pos: s, end_pos: e } = finding;
  if (s == null || body.slice(s, e) !== finding.excerpt) {
    const idx = body.indexOf(finding.excerpt);
    if (idx < 0) throw httpError(409, "The flagged text has changed since the review. Re-run the check.");
    s = idx; e = idx + finding.excerpt.length;
  }
  if (replacement === "") { if (body[e] === " ") e++; else if (body[s - 1] === " ") s--; } // removing a word: drop one adjacent space
  return body.slice(0, s) + replacement + body.slice(e);
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
