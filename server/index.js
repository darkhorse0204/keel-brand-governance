// Keel API server.
import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import { openDb, now, uid, j, getSetting, setSetting, loadBrandKit, logEvent } from "./db.js";
import { seed, resetDemo } from "./seed.js";
import { reviewContent } from "./engine/index.js";
import { runReview, createRevision, applySuggestion, currentRevision, httpError } from "./review.js";
import { aiConfigured, aiEnabled, aiRewrite, aiImageReview, aiImportGuidelines, MODEL, PROVIDER } from "./ai.js";
import { parsePdf, parsePptx, ocrImage, dataUrlToBuffer, marker } from "./intake.js";
import { computeInsights } from "./insights.js";
import { importGuidelines, proposalToRule } from "./importer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const db = openDb();
if (db.prepare("SELECT COUNT(*) n FROM users").get().n === 0) { await seed(db); console.log("Seeded demo workspace."); }

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "15mb" }));
app.use((req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ROLE_CAN = {
  review: ["reviewer", "brand_admin"],
  admin: ["brand_admin"],
  insights: ["creator", "reviewer", "brand_admin"],
};

// ------------------------------------------------------------------ auth (demo-grade, see README limitations)
app.get("/api/users", (req, res) => res.json(db.prepare("SELECT id,name,role,team,title FROM users ORDER BY rowid").all()));
app.post("/api/login", (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.body?.user_id);
  if (!u) return res.status(404).json({ error: "Unknown user" });
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)").run(token, u.id, now());
  logEvent(db, { actor_id: u.id, type: "login" });
  res.json({ token, user: u });
});
// Public demo: anyone can put the shared demo workspace back to its starting state.
// Turn off with KEEL_DEMO_RESET=off. Limited to once a minute.
let lastReset = 0;
app.post("/api/demo/reset", wrap(async (req, res) => {
  if (process.env.KEEL_DEMO_RESET === "off") throw httpError(403, "Demo reset is turned off on this server");
  if (Date.now() - lastReset < 60_000) throw httpError(429, "The demo was reset less than a minute ago. Try again shortly.");
  lastReset = Date.now();
  await resetDemo(db);
  res.json({ ok: true });
}));

app.use("/api", (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  const s = token && db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?").get(token);
  if (!s) return res.status(401).json({ error: "Please sign in" });
  req.user = s;
  next();
});
const need = (cap) => (req, res, next) => (ROLE_CAN[cap].includes(req.user.role) ? next() : res.status(403).json({ error: "Your role can't do that" }));

app.get("/api/me", (req, res) => res.json(req.user));
app.get("/api/meta", (req, res) => res.json({
  brandName: getSetting(db, "brand_name", "Brand"), aiConfigured: aiConfigured(), aiEnabled: aiEnabled(db), model: MODEL, provider: PROVIDER,
  reviewers: db.prepare("SELECT id,name FROM users WHERE role IN ('reviewer','brand_admin')").all(),
}));

// ------------------------------------------------------------------ submissions
function loadSub(req) {
  const sub = db.prepare("SELECT * FROM submissions WHERE id=?").get(req.params.id);
  if (!sub) throw httpError(404, "Not found");
  if (["creator", "agency"].includes(req.user.role) && sub.author_id !== req.user.id) throw httpError(403, "You can only open your own submissions");
  return sub;
}
const isReviewer = (u) => ROLE_CAN.review.includes(u.role);

app.get("/api/submissions", (req, res) => {
  const scope = req.query.scope || "all";
  let rows = db.prepare(`SELECT s.*, u.name author_name, r.name reviewer_name,
      (SELECT COUNT(*) FROM findings f WHERE f.submission_id=s.id AND f.revision=s.current_revision AND f.status='open') open_findings,
      (SELECT COUNT(*) FROM findings f WHERE f.submission_id=s.id AND f.revision=s.current_revision AND f.status='open' AND f.severity='blocker') open_blockers
    FROM submissions s JOIN users u ON u.id=s.author_id LEFT JOIN users r ON r.id=s.reviewer_id ORDER BY s.updated_at DESC`).all();
  if (!isReviewer(req.user) || scope === "mine") rows = rows.filter((s) => s.author_id === req.user.id);
  if (scope === "review") rows = rows.filter((s) => s.status === "in_review" && s.author_id !== req.user.id);
  if (req.query.live) rows = rows.filter((s) => !s.seeded);
  res.json(rows.map((s) => ({ ...s, intent: j(s.intent, {}) })));
});

app.post("/api/preflight", (req, res) => {
  const { body = "", format = "text", channel = "general", images = [] } = req.body || {};
  const kit = loadBrandKit(db);
  const r = reviewContent({ body, format, channel, images }, kit);
  res.json(redactForRole(req.user, r));
});

app.post("/api/parse-file", wrap(async (req, res) => {
  const { filename = "", data = "" } = req.body || {};
  const buf = Buffer.from(data, "base64");
  if (buf.length > 10e6) throw httpError(413, "File too large (10 MB max)");
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") {
    try { return res.json(await parsePdf(buf)); }
    catch (e) { throw httpError(422, "Couldn't read this PDF (it may be password-protected or damaged)"); }
  }
  if (ext === ".pptx") {
    try { return res.json(await parsePptx(buf, { ocr: !!req.body?.ocr })); }
    catch (e) { throw httpError(422, e.message?.startsWith("No slides") ? e.message : "Couldn't read this PowerPoint file"); }
  }
  if (ext === ".ppt") throw httpError(415, "Old .ppt files aren't supported. Save the deck as .pptx and upload it again.");
  if (ext === ".docx") {
    const r = await mammoth.convertToMarkdown({ buffer: buf });
    return res.json({ format: "markdown", body: r.value.replace(/\\([.!#\-()])/g, "$1"), note: "Converted from Word (.docx)" });
  }
  if ([".md", ".markdown"].includes(ext)) return res.json({ format: "markdown", body: buf.toString("utf8") });
  if ([".html", ".htm"].includes(ext)) return res.json({ format: "html", body: buf.toString("utf8") });
  if ([".txt", ""].includes(ext)) return res.json({ format: "text", body: buf.toString("utf8") });
  throw httpError(415, "Supported files: .pdf, .pptx, .docx, .md, .html, .txt (and images via the image panel)");
}));

// OCR runs locally (tesseract.js + bundled English model): the image is not sent to any outside service.
app.post("/api/ocr", wrap(async (req, res) => {
  let buf;
  try { buf = dataUrlToBuffer(req.body?.dataUrl); } catch { throw httpError(400, "Send a PNG, JPEG, GIF or WebP image"); }
  const r = await ocrImage(buf);
  res.json(r);
}));

app.post("/api/submissions", wrap(async (req, res) => {
  const { title, channel = "general", format = "text", body = "", images = [], intent = {}, ai = false } = req.body || {};
  if (!title?.trim()) throw httpError(400, "Title is required");
  if (!body.trim() && !images.length) throw httpError(400, "Add some content or an image");
  const id = uid("s_"), t = now();
  db.prepare("INSERT INTO submissions(id,title,channel,format,status,author_id,intent,current_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(id, title.trim(), channel, format, "draft", req.user.id, JSON.stringify(intent), 1, t, t);
  db.prepare("INSERT INTO revisions(submission_id,number,body,images,author_id,note,created_at) VALUES(?,?,?,?,?,?,?)").run(id, 1, body, JSON.stringify(images), req.user.id, "First draft", t);
  logEvent(db, { submission_id: id, actor_id: req.user.id, type: "created" });
  await runReview(db, id, { ai: !!ai, actor: req.user.id });
  res.json({ id });
}));

app.get("/api/submissions/:id", wrap(async (req, res) => {
  const sub = loadSub(req);
  const rev = currentRevision(db, sub);
  const findings = db.prepare("SELECT * FROM findings WHERE submission_id=? AND revision=? ORDER BY CASE severity WHEN 'blocker' THEN 0 WHEN 'major' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END, start_pos").all(sub.id, rev.number)
    .map((f) => ({ ...f, source: j(f.source, {}), suggestion: j(f.suggestion, null) }));
  const kit = loadBrandKit(db);
  const stats = reviewContent({ body: rev.body, format: sub.format, channel: sub.channel, images: rev.images }, kit).stats;
  const users = Object.fromEntries(db.prepare("SELECT id,name,role FROM users").all().map((u) => [u.id, u]));
  const facts = Object.fromEntries(kit.facts.map((f) => [f.id, f]));
  res.json({
    submission: { ...sub, intent: j(sub.intent, {}), author: users[sub.author_id], reviewer: users[sub.reviewer_id] || null },
    revision: rev, stats,
    findings: findings.map((f) => redactFinding(req.user, f)),
    claims: db.prepare("SELECT * FROM claims WHERE submission_id=? AND revision=? ORDER BY start_pos").all(sub.id, rev.number)
      .map((c) => ({ ...c, fact: c.fact_id && facts[c.fact_id] && !(facts[c.fact_id].confidential && req.user.role === "agency") ? { id: c.fact_id, statement: facts[c.fact_id].statement, source: facts[c.fact_id].source, valid_until: facts[c.fact_id].valid_until } : null })),
    revisions: db.prepare("SELECT number, author_id, note, created_at FROM revisions WHERE submission_id=? ORDER BY number").all(sub.id).map((r) => ({ ...r, author: users[r.author_id]?.name })),
    comments: db.prepare("SELECT * FROM comments WHERE submission_id=? ORDER BY created_at").all(sub.id).map((c) => ({ ...c, author: users[c.author_id] })),
    events: db.prepare("SELECT * FROM events WHERE submission_id=? ORDER BY id DESC LIMIT 60").all(sub.id).map((e) => ({ ...e, detail: j(e.detail, {}), actor: users[e.actor_id]?.name })),
    ai: j(db.prepare("SELECT value FROM settings WHERE key=?").get(`ai_meta:${sub.id}`)?.value, null),
    permissions: permissions(req.user, sub),
  });
}));

app.get("/api/submissions/:id/revisions/:n", (req, res) => {
  const sub = loadSub(req);
  const r = db.prepare("SELECT * FROM revisions WHERE submission_id=? AND number=?").get(sub.id, +req.params.n);
  if (!r) throw httpError(404, "No such revision");
  res.json({ ...r, images: j(r.images, []) });
});

function permissions(user, sub) {
  const own = sub.author_id === user.id, rev = isReviewer(user);
  const editable = !["published"].includes(sub.status);
  return {
    edit: editable && (own || rev),
    submit: own && ["draft", "changes_requested"].includes(sub.status),
    withdraw: own && sub.status === "in_review",
    decide: rev && !own && sub.status === "in_review",
    publish: (own || user.role === "brand_admin") && sub.status === "approved",
    override: rev,
    runAi: aiEnabled(db),
  };
}

app.put("/api/submissions/:id/content", wrap(async (req, res) => {
  const sub = loadSub(req);
  if (!permissions(req.user, sub).edit) throw httpError(403, "This submission can't be edited");
  const { body, images, note } = req.body || {};
  if (typeof body !== "string") throw httpError(400, "body required");
  const n = createRevision(db, sub, { body, images, author_id: req.user.id, note: note || "Edited content" });
  logEvent(db, { submission_id: sub.id, actor_id: req.user.id, type: "edited", detail: { revision: n } });
  await runReview(db, sub.id, { ai: false, actor: req.user.id });
  res.json({ revision: n });
}));

app.post("/api/submissions/:id/review", wrap(async (req, res) => {
  const sub = loadSub(req);
  if (req.body?.ai && !aiEnabled(db)) throw httpError(400, "AI review is not enabled on this workspace");
  const r = await runReview(db, sub.id, { ai: !!req.body?.ai, actor: req.user.id });
  res.json(r);
}));

app.post("/api/submissions/:id/images/:idx/ai-review", wrap(async (req, res) => {
  const sub = loadSub(req);
  if (!aiEnabled(db)) throw httpError(400, "AI review is not enabled");
  const rev = currentRevision(db, sub);
  const idx = +req.params.idx, image = rev.images[idx];
  if (!image) throw httpError(404, "No such image");
  const r = await aiImageReview(db, { submission_id: sub.id, image, index: idx });
  if (!r.ok) throw httpError(502, r.error);
  const ins = db.prepare(`INSERT INTO findings(id,submission_id,revision,rule_id,category,severity,engine,confidence,start_pos,end_pos,excerpt,message,why,source,suggestion,status,fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`);
  for (const f of r.findings) ins.run(uid("f_"), sub.id, rev.number, f.rule_id, f.category, f.severity, "ai", f.confidence, null, null, f.excerpt, f.message, f.why, JSON.stringify(f.source), JSON.stringify(f.suggestion), `${f.rule_id}|ai|img${idx}|${f.message.slice(0, 40)}`, now());
  logEvent(db, { submission_id: sub.id, actor_id: req.user.id, type: "image_ai_review", detail: { image: idx, findings: r.findings.length } });
  res.json({ findings: r.findings.length, suggested_alt: r.suggested_alt });
}));

// Read the text inside an attached image and add it to the content, so the same rules check it.
app.post("/api/submissions/:id/images/:idx/ocr", wrap(async (req, res) => {
  const sub = loadSub(req);
  if (!permissions(req.user, sub).edit) throw httpError(403, "This submission can't be edited");
  const rev = currentRevision(db, sub);
  const idx = +req.params.idx, image = rev.images[idx];
  if (!image) throw httpError(404, "No such image");
  const label = `Text in image ${image.name || idx + 1}`;
  if (rev.body.includes(marker(label))) throw httpError(409, "Text from this image has already been added");
  const r = await ocrImage(dataUrlToBuffer(image.dataUrl));
  if (!r.text || r.text.replace(/\W/g, "").length < 3) throw httpError(422, "No readable text found in this image");
  const body = `${rev.body.replace(/\s*$/, "")}\n\n${marker(label)}\n${r.text}`;
  const n = createRevision(db, sub, { body, author_id: req.user.id, note: `Added text read from image ${image.name || idx + 1} (OCR, ${r.confidence}% confidence)` });
  logEvent(db, { submission_id: sub.id, actor_id: req.user.id, type: "image_text_read", detail: { image: idx, confidence: r.confidence, revision: n } });
  await runReview(db, sub.id, { ai: false, actor: req.user.id });
  res.json({ revision: n, text: r.text, confidence: r.confidence });
}));

// ------------------------------------------------------------------ findings
function loadFinding(req) {
  const f = db.prepare("SELECT * FROM findings WHERE id=?").get(req.params.id);
  if (!f) throw httpError(404, "Finding not found");
  req.params.id = f.submission_id;
  const sub = loadSub(req);
  if (f.revision !== sub.current_revision) throw httpError(409, "This finding belongs to an older revision");
  return { f: { ...f, source: j(f.source, {}), suggestion: j(f.suggestion, null) }, sub };
}
const setStatus = (f, status, user, note) => db.prepare("UPDATE findings SET status=?, resolution_note=?, resolved_by=?, resolved_at=? WHERE id=?").run(status, note || null, user.id, now(), f.id);

app.post("/api/findings/:id/apply", wrap(async (req, res) => {
  const { f, sub } = loadFinding(req);
  if (!permissions(req.user, sub).edit) throw httpError(403, "You can't edit this submission");
  const rev = currentRevision(db, sub);
  const body = applySuggestion(rev.body, f, req.body?.replacement);
  setStatus(f, "accepted", req.user, req.body?.replacement != null ? "Applied edited suggestion" : "Applied suggestion");
  const n = createRevision(db, sub, { body, author_id: req.user.id, note: `Applied fix for ${f.rule_id}: ${f.message}`.slice(0, 160) });
  logEvent(db, { submission_id: sub.id, actor_id: req.user.id, type: "suggestion_applied", detail: { rule: f.rule_id, engine: f.engine, revision: n } });
  await runReview(db, sub.id, { ai: false, actor: req.user.id });
  res.json({ revision: n });
}));

app.post("/api/findings/:id/rewrite", wrap(async (req, res) => {
  const { f, sub } = loadFinding(req);
  if (!aiEnabled(db)) throw httpError(400, "AI is not enabled");
  const rev = currentRevision(db, sub);
  const r = await aiRewrite(db, { submission_id: sub.id, body: rev.body, finding: f, intent: j(sub.intent, {}) });
  if (!r.ok) throw httpError(502, r.error);
  // self-check: run the rule engine on the rewritten passage before offering it
  const kit = loadBrandKit(db);
  const check = reviewContent({ body: r.rewrite, format: "text", channel: "general" }, kit).findings
    .filter((x) => !["A11Y-03"].includes(x.rule_id)).map((x) => `${x.rule_id}: ${x.message}`);
  res.json({ rewrite: r.rewrite, rationale: r.rationale, verification: check });
}));

const DISMISS_REASONS = ["false_positive", "guideline_unclear", "intentional_exception", "not_applicable"];
app.post("/api/findings/:id/dismiss", wrap(async (req, res) => {
  const { f, sub } = loadFinding(req);
  const { reason, note = "" } = req.body || {};
  if (!DISMISS_REASONS.includes(reason)) throw httpError(400, "Choose a reason");
  if (f.severity === "blocker") throw httpError(403, "Blockers can't be dismissed — a reviewer must override with a justification");
  if (f.severity === "major" && note.trim().length < 5) throw httpError(400, "Explain why this major issue doesn't apply");
  if (!permissions(req.user, sub).edit && !isReviewer(req.user)) throw httpError(403, "Not allowed");
  setStatus(f, "dismissed", req.user, `${reason}: ${note}`.trim());
  logEvent(db, { submission_id: sub.id, actor_id: req.user.id, type: "finding_dismissed", detail: { rule: f.rule_id, reason, note } });
  res.json({ ok: true });
}));

app.post("/api/findings/:id/override", need("review"), wrap(async (req, res) => {
  const { f, sub } = loadFinding(req);
  const note = (req.body?.note || "").trim();
  if (note.length < 10) throw httpError(400, "Write a justification (at least 10 characters) — it is kept in the audit trail");
  if (sub.author_id === req.user.id) throw httpError(403, "You can't override findings on your own content");
  setStatus(f, "overridden", req.user, note);
  logEvent(db, { submission_id: sub.id, actor_id: req.user.id, type: "finding_overridden", detail: { rule: f.rule_id, severity: f.severity, note } });
  res.json({ ok: true });
}));

app.post("/api/findings/:id/reopen", wrap(async (req, res) => {
  const { f, sub } = loadFinding(req);
  if (f.status === "overridden" && !isReviewer(req.user)) throw httpError(403, "Only reviewers can reopen overrides");
  setStatus(f, "open", req.user, null);
  logEvent(db, { submission_id: sub.id, actor_id: req.user.id, type: "finding_reopened", detail: { rule: f.rule_id } });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ comments & workflow
app.post("/api/submissions/:id/comments", wrap(async (req, res) => {
  const sub = loadSub(req);
  const body = (req.body?.body || "").trim();
  if (!body) throw httpError(400, "Comment is empty");
  db.prepare("INSERT INTO comments(id,submission_id,finding_id,author_id,body,created_at) VALUES(?,?,?,?,?,?)").run(uid("m_"), sub.id, req.body.finding_id || null, req.user.id, body.slice(0, 4000), now());
  logEvent(db, { submission_id: sub.id, actor_id: req.user.id, type: "commented" });
  res.json({ ok: true });
}));

app.post("/api/submissions/:id/transition", wrap(async (req, res) => {
  const sub = loadSub(req);
  const { action, note = "", reviewer_id } = req.body || {};
  const p = permissions(req.user, sub);
  const open = db.prepare("SELECT severity, COUNT(*) n FROM findings WHERE submission_id=? AND revision=? AND status='open' GROUP BY severity").all(sub.id, sub.current_revision);
  const openN = Object.fromEntries(open.map((o) => [o.severity, o.n]));
  let status;
  if (action === "submit") {
    if (!p.submit) throw httpError(403, "You can't submit this");
    status = "in_review";
    const rid = reviewer_id || sub.reviewer_id || db.prepare("SELECT id FROM users WHERE role='reviewer' LIMIT 1").get()?.id;
    db.prepare("UPDATE submissions SET reviewer_id=? WHERE id=?").run(rid, sub.id);
  } else if (action === "withdraw") { if (!p.withdraw) throw httpError(403, "Not allowed"); status = "draft"; }
  else if (action === "request_changes") {
    if (!p.decide) throw httpError(403, "Only an assigned reviewer (not the author) can request changes");
    if (note.trim().length < 3) throw httpError(400, "Tell the author what to change");
    status = "changes_requested";
  } else if (action === "approve") {
    if (!p.decide) throw httpError(403, "Only a reviewer who isn't the author can approve");
    if (openN.blocker) throw httpError(409, `${openN.blocker} blocker(s) still open — fix or override them first`);
    if (openN.major && note.trim().length < 5) throw httpError(409, `${openN.major} major issue(s) still open — resolve them or add an approval note acknowledging them`);
    status = "approved";
  } else if (action === "publish") { if (!p.publish) throw httpError(403, "Only approved content can be marked published"); status = "published"; }
  else throw httpError(400, "Unknown action");
  db.prepare("UPDATE submissions SET status=?, updated_at=?, approved_at=CASE WHEN ?='approved' THEN ? ELSE approved_at END WHERE id=?").run(status, now(), status, now(), sub.id);
  if (note.trim()) db.prepare("INSERT INTO comments(id,submission_id,author_id,body,created_at) VALUES(?,?,?,?,?)").run(uid("m_"), sub.id, req.user.id, `[${action.replace("_", " ")}] ${note.trim()}`, now());
  logEvent(db, { submission_id: sub.id, actor_id: req.user.id, type: action, detail: { note, open: openN, revision: sub.current_revision } });
  res.json({ status });
}));

// ------------------------------------------------------------------ brand kit
app.get("/api/brand", (req, res) => {
  const agency = req.user.role === "agency";
  const kit = loadBrandKit(db, { includeConfidential: !agency });
  res.json({
    brandName: kit.brandName,
    rules: db.prepare("SELECT * FROM rules ORDER BY category, id").all().map((r) => ({ ...r, config: j(r.config, {}) })),
    facts: kit.facts, assets: kit.assets,
    confidential: agency ? [] : kit.confidential,
    hidden: agency ? "Confidential facts, assets and the confidential register are hidden for agency accounts." : null,
  });
});

const RULE_TYPES = ["term_replace", "canonical_spelling", "banned_phrase", "max_count", "conditional_required", "builtin", "ai"];
app.post("/api/brand/rules", need("admin"), (req, res) => {
  const r = req.body || {};
  if (!r.title || !r.guideline || !RULE_TYPES.includes(r.type)) throw httpError(400, "title, guideline and a valid type are required");
  const id = r.id || `${(r.category || "custom").slice(0, 4).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
  db.prepare("INSERT INTO rules(id,title,category,type,severity,guideline,rationale,config,example_bad,example_good,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, r.title, r.category || "messaging", r.type, r.severity || "minor", r.guideline, r.rationale || null, JSON.stringify(r.config || {}), r.example_bad || null, r.example_good || null, now(), req.user.id);
  logEvent(db, { actor_id: req.user.id, type: "rule_created", detail: { id } });
  res.json({ id });
});
app.put("/api/brand/rules/:id", need("admin"), (req, res) => {
  const old = db.prepare("SELECT * FROM rules WHERE id=?").get(req.params.id);
  if (!old) throw httpError(404, "No such rule");
  const { change_note = "", clarification = false, ...fields } = req.body || {};
  if (clarification && change_note.trim().length < 5) throw httpError(400, "Say what you clarified (it is shown next to the before/after results)");
  const r = { ...old, ...fields, config: JSON.stringify(fields.config ?? j(old.config, {})) };
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE rules SET title=?, category=?, severity=?, guideline=?, rationale=?, config=?, example_bad=?, example_good=?, enabled=?, version=version+1, updated_at=?, updated_by=? WHERE id=?")
      .run(r.title, r.category, r.severity, r.guideline, r.rationale, r.config, r.example_bad, r.example_good, r.enabled ? 1 : 0, now(), req.user.id, old.id);
    db.prepare("INSERT INTO rule_history(rule_id,from_version,to_version,kind,note,before,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(old.id, old.version, old.version + 1, clarification ? "clarification" : "edit", change_note.trim() || null,
        JSON.stringify({ guideline: old.guideline, example_bad: old.example_bad, example_good: old.example_good, severity: old.severity }), req.user.id, now());
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  logEvent(db, { actor_id: req.user.id, type: clarification ? "rule_clarified" : "rule_updated", detail: { id: old.id, from_version: old.version, note: change_note } });
  res.json({ ok: true, version: old.version + 1 });
});

app.get("/api/brand/rules/:id/history", (req, res) => {
  res.json(db.prepare("SELECT h.*, u.name changed_by_name FROM rule_history h LEFT JOIN users u ON u.id=h.changed_by WHERE rule_id=? ORDER BY id DESC").all(req.params.id)
    .map((h) => ({ ...h, before: j(h.before, {}) })));
});

app.post("/api/brand/facts", need("admin"), (req, res) => {
  const f = req.body || {};
  if (!f.statement) throw httpError(400, "statement required");
  const id = f.id || `F-${Math.floor(Math.random() * 900 + 100)}`;
  db.prepare(`INSERT INTO facts(id,statement,value,keywords,superseded_values,source,valid_from,valid_until,required_disclaimer,confidential,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET statement=excluded.statement, value=excluded.value, keywords=excluded.keywords, superseded_values=excluded.superseded_values, source=excluded.source,
    valid_from=excluded.valid_from, valid_until=excluded.valid_until, required_disclaimer=excluded.required_disclaimer, confidential=excluded.confidential, updated_at=excluded.updated_at`)
    .run(id, f.statement, f.value || null, JSON.stringify(f.keywords || []), JSON.stringify(f.superseded_values || []), f.source || null, f.valid_from || null, f.valid_until || null, f.required_disclaimer || null, f.confidential ? 1 : 0, now());
  logEvent(db, { actor_id: req.user.id, type: "fact_saved", detail: { id } });
  res.json({ id });
});
app.delete("/api/brand/facts/:id", need("admin"), (req, res) => { db.prepare("DELETE FROM facts WHERE id=?").run(req.params.id); logEvent(db, { actor_id: req.user.id, type: "fact_deleted", detail: { id: req.params.id } }); res.json({ ok: true }); });

app.post("/api/brand/assets", need("admin"), (req, res) => {
  const a = req.body || {};
  if (!a.kind || !a.name || !a.value) throw httpError(400, "kind, name and value required");
  if (a.kind === "color" && !/^#[0-9a-f]{6}$/i.test(a.value)) throw httpError(400, "Colours must be #RRGGBB");
  const id = a.id || uid("A-");
  db.prepare(`INSERT INTO assets(id,kind,name,value,usage,confidential,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,value=excluded.value,usage=excluded.usage,confidential=excluded.confidential,updated_at=excluded.updated_at`)
    .run(id, a.kind, a.name, a.value, a.usage || null, a.confidential ? 1 : 0, now());
  res.json({ id });
});
app.delete("/api/brand/assets/:id", need("admin"), (req, res) => { db.prepare("DELETE FROM assets WHERE id=?").run(req.params.id); res.json({ ok: true }); });

app.post("/api/brand/confidential", need("admin"), (req, res) => {
  const { term, reason, until } = req.body || {};
  if (!term?.trim()) throw httpError(400, "term required");
  db.prepare("INSERT INTO confidential_terms(id,term,reason,until) VALUES(?,?,?,?)").run(uid("K-"), term.trim(), reason || null, until || null);
  res.json({ ok: true });
});
app.delete("/api/brand/confidential/:id", need("admin"), (req, res) => { db.prepare("DELETE FROM confidential_terms WHERE id=?").run(req.params.id); res.json({ ok: true }); });

app.post("/api/brand/import", need("admin"), wrap(async (req, res) => {
  const text = (req.body?.text || "").slice(0, 60000);
  if (!text.trim()) throw httpError(400, "Paste your style guide text");
  if (req.body?.ai) {
    if (!aiEnabled(db)) throw httpError(400, "AI is not enabled");
    const r = await aiImportGuidelines(db, text);
    if (!r.ok) throw httpError(502, r.error);
    return res.json({ engine: "ai", proposals: r.rules });
  }
  res.json({ engine: "rules", proposals: importGuidelines(text) });
}));
app.post("/api/brand/import/commit", need("admin"), (req, res) => {
  const ids = [];
  for (const p of req.body?.proposals || []) {
    const id = `IMP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const r = proposalToRule(p, id);
    db.prepare("INSERT INTO rules(id,title,category,type,severity,guideline,rationale,config,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(r.id, r.title, r.category, r.type, r.severity, r.guideline, r.rationale, JSON.stringify(r.config), now(), req.user.id);
    ids.push(id);
  }
  logEvent(db, { actor_id: req.user.id, type: "rules_imported", detail: { ids } });
  res.json({ ids });
});
app.get("/api/brand/export", need("admin"), (req, res) => {
  res.setHeader("Content-Disposition", "attachment; filename=brand-kit.json");
  res.json(loadBrandKit(db));
});

// ------------------------------------------------------------------ insights, AI transparency, settings
app.get("/api/insights", need("insights"), (req, res) => res.json(computeInsights(db)));
// latest accuracy report from `npm run eval` (Improvement 1)
app.get("/api/eval", (req, res) => {
  const f = path.join(here, "..", "eval", "report.json");
  if (!fs.existsSync(f)) return res.json(null);
  const r = j(fs.readFileSync(f, "utf8"), null);
  res.json(r && { date: r.date, overall: r.overall, handwritten: r.handwritten, holdout: r.holdout, generated: r.generated, bySeverity: r.bySeverity, byRule: r.byRule, gate: r.gate, baseline: r.baseline, ai: r.ai, errors: r.errors });
});
app.get("/api/ai-log",(req, res) => res.json(db.prepare("SELECT * FROM ai_log ORDER BY id DESC LIMIT 100").all()));
app.put("/api/settings", need("admin"), (req, res) => {
  if (typeof req.body?.ai_enabled === "boolean") setSetting(db, "ai_enabled", req.body.ai_enabled);
  logEvent(db, { actor_id: req.user.id, type: "settings_changed", detail: req.body });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ role-aware redaction helpers
function redactFinding(user, f) {
  if (user.role === "agency" && f.source?.type === "fact" && f.source.text && f.category === "confidentiality") return { ...f, source: { ...f.source, text: "[withheld]" } };
  return f;
}
function redactForRole(user, r) { return { ...r, findings: r.findings.map((f) => redactFinding(user, f)) }; }

// ------------------------------------------------------------------ static + errors
const dist = path.join(here, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
}
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Something went wrong on our side." : err.message });
});

const PORT = +process.env.PORT || 8787;
if (!process.env.KEEL_NO_LISTEN) app.listen(PORT, () => console.log(`Keel API on http://localhost:${PORT}  (AI ${aiConfigured() ? "configured: " + MODEL : "not configured — rules-only mode"})`));
export default app;
