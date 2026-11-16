// API integration tests: workflow, permissions and human-control guarantees.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keel-test-"));
process.env.KEEL_DATA_DIR = dir;
process.env.KEEL_NO_LISTEN = "1";
delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;
const { default: app } = await import("../server/index.js");

let server, base;
before(async () => { server = app.listen(0); await new Promise((r) => server.once("listening", r)); base = `http://localhost:${server.address().port}/api`; });
after(async () => { server.close(); const { stopOcr } = await import("../server/intake.js"); await stopOcr(); });

async function as(user) {
  const r = await fetch(base + "/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: user }) }).then((x) => x.json());
  return async (p, method = "GET", body) => {
    const res = await fetch(base + p, { method, headers: { "content-type": "application/json", authorization: "Bearer " + r.token }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
}

test("requests without a session are rejected", async () => {
  assert.equal((await fetch(base + "/submissions")).status, 401);
});

test("full workflow: create → fix → submit → blocked approval → override → approve → edit invalidates", async () => {
  const aditi = await as("u_aditi"), priya = await as("u_priya");
  const c = await aditi("/submissions", "POST", { title: "Test", channel: "email", format: "text", body: "Join 100,000 customers. Guaranteed returns!" });
  assert.equal(c.status, 200);
  let d = (await aditi(`/submissions/${c.body.id}`)).body;
  const term = d.findings.find((f) => f.rule_id === "TERM-02");
  assert.equal((await aditi(`/findings/${term.id}/apply`, "POST", {})).status, 200);
  d = (await aditi(`/submissions/${c.body.id}`)).body;
  assert.equal(d.revision.number, 2);
  assert.match(d.revision.body, /100,000 members/);

  // creators cannot dismiss blockers
  const blocker = d.findings.find((f) => f.severity === "blocker");
  assert.equal((await aditi(`/findings/${blocker.id}/dismiss`, "POST", { reason: "false_positive", note: "nope" })).status, 403);
  // author cannot approve own work
  assert.equal((await aditi(`/submissions/${c.body.id}/transition`, "POST", { action: "submit" })).status, 200);
  assert.equal((await aditi(`/submissions/${c.body.id}/transition`, "POST", { action: "approve" })).status, 403);
  // reviewer blocked by blocker
  const blocked = await priya(`/submissions/${c.body.id}/transition`, "POST", { action: "approve" });
  assert.equal(blocked.status, 409);
  // override needs a justification
  assert.equal((await priya(`/findings/${blocker.id}/override`, "POST", { note: "ok" })).status, 400);
  assert.equal((await priya(`/findings/${blocker.id}/override`, "POST", { note: "Legal approved this exact wording, ref LEG-1" })).status, 200);
  // majors still open → need an acknowledgement note
  assert.equal((await priya(`/submissions/${c.body.id}/transition`, "POST", { action: "approve" })).status, 409);
  const ok = await priya(`/submissions/${c.body.id}/transition`, "POST", { action: "approve", note: "Outdated figure acknowledged; updating next sprint" });
  assert.equal(ok.body.status, "approved");
  // editing approved content sends it back to review
  await aditi(`/submissions/${c.body.id}/content`, "PUT", { body: "Join 120,000+ members." });
  d = (await aditi(`/submissions/${c.body.id}`)).body;
  assert.equal(d.submission.status, "in_review");
  assert.ok(d.events.some((e) => e.type === "approval_invalidated"));
});

test("dismissals stick across revisions", async () => {
  const aditi = await as("u_aditi");
  const c = await aditi("/submissions", "POST", { title: "Sticky", body: "Our customers like it. Nice day." });
  let d = (await aditi(`/submissions/${c.body.id}`)).body;
  const f = d.findings.find((x) => x.rule_id === "TERM-02");
  await aditi(`/findings/${f.id}/dismiss`, "POST", { reason: "guideline_unclear", note: "quote" });
  await aditi(`/submissions/${c.body.id}/content`, "PUT", { body: "Our customers like it. Nice evening." });
  d = (await aditi(`/submissions/${c.body.id}`)).body;
  assert.equal(d.findings.find((x) => x.rule_id === "TERM-02").status, "dismissed");
});

test("role isolation: creators can't read others' work; agency can't see confidential kit", async () => {
  const aditi = await as("u_aditi"), marcus = await as("u_marcus");
  const c = await aditi("/submissions", "POST", { title: "Private", body: "Hello members." });
  assert.equal((await marcus(`/submissions/${c.body.id}`)).status, 403);
  const kit = (await marcus("/brand")).body;
  assert.equal(kit.confidential.length, 0);
  assert.ok(!kit.facts.some((f) => f.confidential));
  assert.ok(!JSON.stringify(kit).includes("Project Canopy"));
  assert.equal((await marcus("/insights")).status, 403);
  assert.equal((await aditi("/brand/rules/TERM-02", "PUT", { severity: "blocker" })).status, 403);
});

test("brand admin edits a rule → version bumps → next check uses it", async () => {
  const sam = await as("u_sam");
  assert.equal((await sam("/brand/rules/TERM-02", "PUT", { severity: "major" })).status, 200);
  const kit = (await sam("/brand")).body;
  const r = kit.rules.find((x) => x.id === "TERM-02");
  assert.equal(r.severity, "major");
  assert.equal(r.version, 2);
  const pre = (await sam("/preflight", "POST", { body: "Our customers" })).body;
  assert.equal(pre.findings.find((f) => f.rule_id === "TERM-02").severity, "major");
});

test("AI endpoints refuse cleanly when AI is not configured", async () => {
  const aditi = await as("u_aditi");
  const c = await aditi("/submissions", "POST", { title: "NoAI", body: "Hello members." });
  const r = await aditi(`/submissions/${c.body.id}/review`, "POST", { ai: true });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not enabled/);
});

test("insights surface the unclear guideline from seeded history", async () => {
  const sam = await as("u_sam");
  const d = (await sam("/insights")).body;
  assert.ok(d.totals.submissions > 30);
  assert.ok(d.unclear.some((u) => u.rule_id === "TERM-02"));
});

// ---------------------------------------------------------------- Round 2
const fixture = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url));

test("upload a PowerPoint deck → slide-by-slide text → checked like any draft", async () => {
  const aditi = await as("u_aditi");
  const p = await aditi("/parse-file", "POST", { filename: "deck.pptx", data: fixture("deck.pptx").toString("base64") });
  assert.equal(p.status, 200);
  assert.equal(p.body.pages, 2);
  assert.match(p.body.body, /<!-- page: Slide 2 -->/);
  const c = await aditi("/submissions", "POST", { title: "Deck", channel: "general", format: p.body.format, body: p.body.body });
  const d = (await aditi(`/submissions/${c.body.id}`)).body;
  const leak = d.findings.find((f) => f.rule_id === "CONF-01");
  assert.ok(leak && leak.start_pos > d.revision.body.indexOf("<!-- page: Slide 2 -->"), "leak is located on slide 2");
  assert.equal((await aditi("/parse-file", "POST", { filename: "old.ppt", data: "AAAA" })).status, 415);
});

test("read text in an attached image → new revision → OCR'd words are checked", async () => {
  const aditi = await as("u_aditi"), marcus = await as("u_marcus");
  const dataUrl = "data:image/png;base64," + fixture("banner.png").toString("base64");
  const c = await aditi("/submissions", "POST", { title: "Banner", channel: "instagram", format: "text", body: "New festive banner for members.", images: [{ name: "banner.png", dataUrl, alt: "Festive banner", kind: "photo", decorative: false, palette: [] }] });
  assert.equal((await marcus(`/submissions/${c.body.id}/images/0/ocr`, "POST")).status, 403, "other people can't edit it");
  const r = await aditi(`/submissions/${c.body.id}/images/0/ocr`, "POST");
  assert.equal(r.status, 200);
  assert.equal(r.body.revision, 2);
  const d = (await aditi(`/submissions/${c.body.id}`)).body;
  assert.match(d.revision.body, /<!-- page: Text in image banner.png -->\nGUARANTEED RETURNS/);
  assert.ok(d.findings.some((f) => f.rule_id === "CLAIM-01" && f.severity === "blocker"), "promise in the image is a blocker");
  assert.equal((await aditi(`/submissions/${c.body.id}/images/0/ocr`, "POST")).status, 409, "not added twice");
});

test("clarify a guideline → history recorded → insights start tracking it", async () => {
  const sam = await as("u_sam"), aditi = await as("u_aditi");
  const rule = (await sam("/brand")).body.rules.find((r) => r.id === "TERM-02");
  assert.equal((await sam("/brand/rules/TERM-02", "PUT", { ...rule, clarification: true, change_note: "" })).status, 400, "a clarification needs a note");
  assert.equal((await aditi("/brand/rules/TERM-02", "PUT", { ...rule, clarification: true, change_note: "nope" })).status, 403);
  const guideline = 'People who save with us are "members". Avoid "customers" and "users" in marketing copy. In-app UI labels may say "user".';
  const r = await sam("/brand/rules/TERM-02", "PUT", { ...rule, guideline, clarification: true, change_note: "Said it doesn't apply to in-app UI labels" });
  assert.equal(r.status, 200);
  const h = (await sam("/brand/rules/TERM-02/history")).body;
  assert.equal(h[0].kind, "clarification");
  assert.equal(h[0].before.guideline, rule.guideline);
  const ins = (await sam("/insights")).body;
  const c = ins.clarifications.find((x) => x.rule_id === "TERM-02");
  assert.equal(c.verdict, "collecting", "no decisions on the new version yet");
  assert.ok(c.before.decided >= 3);
  assert.ok(!ins.unclear.some((u) => u.rule_id === "TERM-02"), "old dismissals no longer flag the clarified rule");
  // new findings remember the new version
  const s = await aditi("/submissions", "POST", { title: "v2", channel: "email", format: "text", body: "Our customers love it." });
  const f = (await aditi(`/submissions/${s.body.id}`)).body.findings.find((x) => x.rule_id === "TERM-02");
  assert.equal(f.source.version, rule.version + 1);
});

test("accuracy report endpoint", async () => {
  const sam = await as("u_sam");
  const r = await sam("/eval");
  assert.equal(r.status, 200);
  if (r.body) { assert.ok(r.body.overall.precision != null); assert.ok("pass" in r.body.gate); }
});

test("public demo: the reviewer has work waiting, and the demo can be reset", async () => {
  const priya = await as("u_priya");
  const q = (await priya("/submissions?scope=review&live=1")).body;
  assert.ok(q.some((s) => s.title === "Diwali referral SMS" && s.open_blockers > 0), "a live submission is waiting for review");
  const r = await fetch(base + "/demo/reset", { method: "POST" });
  assert.equal(r.status, 200);
  assert.equal((await fetch(base + "/demo/reset", { method: "POST" })).status, 429, "rate-limited");
  assert.equal((await priya("/submissions")).status, 401, "old sessions end after a reset");
  const sam = await as("u_sam");
  assert.ok(!(await sam("/brand/rules/TERM-02/history")).body.length, "earlier changes are gone");
});
