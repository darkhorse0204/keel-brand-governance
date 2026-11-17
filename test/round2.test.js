// Round 2 features: PDF / PowerPoint / OCR intake, the Gemini AI layer (with a fake client),
// the guideline-clarification loop, and the false-alarm fixes found by the accuracy test set.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => fs.readFileSync(path.join(here, "fixtures", n));
process.env.KEEL_NO_LISTEN = "1";
process.env.KEEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "keel-r2-"));

const { openDb, loadBrandKit } = await import("../server/db.js");
const { seed } = await import("../server/seed.js");
const { reviewContent } = await import("../server/engine/index.js");
const { parsePdf, parsePptx, ocrImage, pageRanges, stopOcr } = await import("../server/intake.js");
const ai = await import("../server/ai.js");
const { computeInsights } = await import("../server/insights.js");

const db = openDb(":memory:");
await seed(db);
const kit = loadBrandKit(db);
const check = (body, extra = {}) => reviewContent({ body, format: "text", channel: "email", ...extra }, kit, { today: "2026-11-14" }).findings;
after(() => stopOcr());

// ---------------------------------------------------------------- intake
test("PDF: text per page, page markers, wrapped lines rejoined", async () => {
  const r = await parsePdf(fx("brochure.pdf"));
  assert.equal(r.pages, 2);
  const pages = pageRanges(r.body);
  assert.deepEqual(pages.map((p) => p.label), ["Page 1", "Page 2"]);
  assert.match(r.body, /risk-free/, "hyphenated line break is rejoined");
  const fs = check(r.body);
  const onPage = (rule, text) => fs.find((f) => f.rule_id === rule && f.excerpt.includes(text));
  const g = onPage("CLAIM-01", "guaranteed returns");
  assert.ok(g, "absolute promise found on the PDF");
  assert.equal(pages.find((p) => g.start >= p.start && g.start < p.end).label, "Page 2");
  assert.ok(onPage("CLAIM-02", "100,000") && onPage("TERM-02", "customers"));
});

test("page markers are never checked as prose", () => {
  const fs = check("<!-- page: Slide 1 -->\nHello members.\n\n<!-- page: Slide 2 -->\nSet a goal today.");
  assert.deepEqual(fs, []);
});

test("PowerPoint: slide text, slide order, and OCR of slide images", async () => {
  const plain = await parsePptx(fx("deck.pptx"));
  assert.deepEqual(pageRanges(plain.body).map((p) => p.label), ["Slide 1", "Slide 2"]);
  assert.match(plain.body, /Fernway Card waitlist & get cashback/, "XML entities decoded");
  assert.doesNotMatch(plain.body, /GUARANTEED/);
  const withOcr = await parsePptx(fx("deck.pptx"), { ocr: true });
  assert.match(withOcr.body, /GUARANTEED RETURNS/i);
  const rules = new Set(check(withOcr.body).map((f) => f.rule_id));
  for (const r of ["TONE-02", "TONE-01", "TERM-03", "CONF-01", "CLAIM-01"]) assert.ok(rules.has(r), `${r} found in the deck`);
});

test("OCR reads text in an image locally", async () => {
  const r = await ocrImage(fx("banner.png"));
  assert.match(r.text, /GUARANTEED RETURNS FOR\s+EVERY USER/);
  assert.ok(r.confidence > 60);
});

// ---------------------------------------------------------------- false-alarm fixes (from eval)
test("figures that aren't claims: dates, phone numbers, durations, example amounts", () => {
  const nums = (t) => check(t).filter((f) => f.rule_id === "CLAIM-02").map((f) => f.excerpt);
  assert.deepEqual(nums("Offer ends 31 December 2026. Call us on 1800 123 4567."), []);
  assert.deepEqual(nums("Save 500 rupees a week for 10 weeks and you'll have 5,000 rupees."), []);
  assert.deepEqual(nums("Set a goal for 12 months."), []);
  // but money and percentages that ARE claims still need a source
  assert.deepEqual(nums("Members saved ₹5,000 on average last year."), ["₹5,000"]);
  assert.deepEqual(nums("Get 2% cashback on every top-up."), ["2%"]);
});

test("everyday 'best' phrases are not product claims; real superlatives still are", () => {
  const claims = (t) => check(t).filter((f) => f.rule_id === "CLAIM-01").map((f) => f.excerpt.toLowerCase());
  assert.deepEqual(claims("The best way to start is small."), []);
  assert.deepEqual(claims("Make this your best festive season yet."), []);
  assert.deepEqual(claims("Fernway is the best savings app."), ["the best"]);
});

test("one problem, one finding: '100% safe' isn't also flagged as a figure", () => {
  const fs = check("Your deposits are 100% safe.");
  assert.deepEqual(fs.map((f) => f.rule_id), ["CLAIM-01"]);
});

test("brand spelling inside email addresses and SMS keywords in capitals are fine", () => {
  assert.deepEqual(check("Write to help@fernway.example for support."), []);
  assert.deepEqual(check("Payday today. Reply STOP to opt out.", { channel: "sms" }), []);
});

// ---------------------------------------------------------------- Gemini AI layer (fake client)
function fakeGemini(responder) {
  const calls = [];
  ai._setClientForTests({ models: { generateContent: async (req) => { calls.push(req); return responder(req); } } });
  return calls;
}
const jsonResponse = (obj) => ({ text: JSON.stringify(obj), candidates: [{ finishReason: "STOP" }] });

test("AI review: request shape, redaction, and grounding of Gemini's answer", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const body = "Our Fernway Card is coming. Most people your age are already behind on saving. Email priya@fernway.example.";
  const calls = fakeGemini(() => jsonResponse({
    summary: "Fear-based line.", intent_alignment: { verdict: "partially_aligned", note: "ok" },
    findings: [
      { rule_id: "TONE-05", quote: "Most people your age are already behind", issue: "Fear-based", why: "Guilt", replacement: "Lots of people are just starting", severity: "minor", confidence: 0.9 },
      { rule_id: "TONE-05", quote: "text that is not in the draft", issue: "x", why: "x", replacement: "", severity: "minor", confidence: 0.9 },
      { rule_id: "MADE-UP-9", quote: "Our", issue: "x", why: "x", replacement: "", severity: "minor", confidence: 0.9 },
      { rule_id: "MSG-01", quote: "coming", issue: "weak", why: "x", replacement: "", severity: "info", confidence: 0.2 },
    ],
  }));
  const r = await ai.aiReview(db, { submission_id: null, body, channel: "email", format: "text", intent: {} });
  assert.equal(r.ok, true);
  assert.equal(r.findings.length, 1, "only the grounded finding survives");
  assert.equal(r.findings[0].excerpt, "Most people your age are already behind");
  assert.deepEqual(r.discarded.map((d) => d.reason).sort(), ["low confidence", "quote not found", "unknown rule"]);
  const req = calls[0];
  assert.equal(req.model, ai.MODEL);
  assert.equal(req.config.responseMimeType, "application/json");
  assert.ok(req.config.responseJsonSchema && !JSON.stringify(req.config.responseJsonSchema).includes("additionalProperties"));
  const sent = JSON.stringify(req.contents);
  assert.ok(!sent.includes("Fernway Card") && !sent.includes("priya@fernway.example"), "confidential term and email are redacted");
  assert.match(sent, /\[REDACTED_1\]/);
  const log = db.prepare("SELECT * FROM ai_log ORDER BY id DESC LIMIT 1").get();
  assert.equal(log.kept, 1); assert.equal(log.discarded, 3); assert.equal(log.model, ai.MODEL);
});

test("AI review: blocked responses and API errors become plain messages", async () => {
  fakeGemini(() => ({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }));
  let r = await ai.aiReview(db, { submission_id: null, body: "Hello members.", channel: "email", format: "text" });
  assert.equal(r.ok, false); assert.match(r.error, /declined/);
  fakeGemini(() => { const e = new Error("Resource exhausted"); e.status = 429; throw e; });
  r = await ai.aiReview(db, { submission_id: null, body: "Hello members.", channel: "email", format: "text" });
  assert.match(r.error, /rate-limited|quota/);
  fakeGemini(() => { const e = new Error("API key not valid. Please pass a valid API key."); e.status = 400; throw e; });
  r = await ai.aiReview(db, { submission_id: null, body: "Hello members.", channel: "email", format: "text" });
  assert.match(r.error, /GEMINI_API_KEY/);
});

test("AI image review sends the image as inline data", async () => {
  const calls = fakeGemini(() => jsonResponse({ suggested_alt: "Banner reading 'guaranteed returns'", findings: [] }));
  const dataUrl = "data:image/png;base64," + fx("banner.png").toString("base64");
  const r = await ai.aiImageReview(db, { submission_id: null, image: { dataUrl, name: "banner.png" }, index: 0 });
  assert.equal(r.ok, true);
  const parts = calls[0].contents[0].parts;
  assert.equal(parts[0].inlineData.mimeType, "image/png");
  assert.ok(parts[0].inlineData.data.length > 100);
});

// ---------------------------------------------------------------- guideline loop
test("insights: the seeded clarification shows before/after, and the clarified rule stops counting old dismissals", () => {
  const ins = computeInsights(db);
  const c = ins.clarifications.find((x) => x.rule_id === "CLAIM-01");
  assert.ok(c, "CLAIM-01 clarification reported");
  assert.equal(c.from_version, 1); assert.equal(c.to_version, 2);
  assert.ok(c.before.decided > 0 && c.after.decided > 0);
  assert.ok(c.after.rejectedRate < c.before.rejectedRate, "fewer dismissals after the clarification (demo data)");
  assert.ok(ins.unclear.some((u) => u.rule_id === "TERM-02"), "TERM-02 still flagged as unclear");
  assert.ok(!ins.unclear.some((u) => u.rule_id === "CLAIM-01"));
});

test("AI falls back to the next model when the main one is overloaded", async () => {
  const seen = [];
  ai._setClientForTests({ models: { generateContent: async (req) => {
    seen.push(req.model);
    if (seen.length === 1) { const e = new Error("high demand"); e.status = 503; throw e; }
    return jsonResponse({ summary: "ok", intent_alignment: { verdict: "aligned", note: "" }, findings: [] });
  } } });
  const r = await ai.aiReview(db, { submission_id: null, body: "Hello members.", channel: "email", format: "text" });
  assert.equal(r.ok, true);
  assert.equal(seen[0], ai.MODEL);
  assert.notEqual(seen[1], ai.MODEL, "second try used a fallback model");
  assert.equal(db.prepare("SELECT model FROM ai_log ORDER BY id DESC LIMIT 1").get().model, seen[1], "the log records the model that answered");
});

test("AI findings that repeat a rule-engine finding are dropped (one copy per problem)", async () => {
  const { runReview } = await import("../server/review.js");
  const t = new Date().toISOString();
  db.prepare("INSERT INTO submissions(id,title,channel,format,status,author_id,intent,current_revision,created_at,updated_at) VALUES('s_dup','dup','email','text','draft','u_aditi','{}',1,?,?)").run(t, t);
  db.prepare("INSERT INTO revisions(submission_id,number,body,images,author_id,created_at) VALUES('s_dup',1,?,'[]','u_aditi',?)").run("Download the FernWay app. You'll regret it if you wait.", t);
  ai._setClientForTests({ models: { generateContent: async () => jsonResponse({ summary: "", intent_alignment: { verdict: "aligned", note: "" }, findings: [
    { rule_id: "TERM-01", quote: "FernWay", issue: "spelling", why: "x", replacement: "Fernway", severity: "major", confidence: 0.95 },
    { rule_id: "TONE-05", quote: "You'll regret it if you wait", issue: "fear", why: "x", replacement: "Start whenever you're ready", severity: "minor", confidence: 0.9 },
    { rule_id: "CLAIM-01", quote: "FernWay", issue: "same word, different rule", why: "x", replacement: "", severity: "minor", confidence: 0.9 },
  ] }) } });
  const r = await runReview(db, "s_dup", { ai: true });
  assert.equal(r.ai.kept, 1); assert.equal(r.ai.duplicates, 2, "same words under another rule id also count as a duplicate");
  const rows = db.prepare("SELECT rule_id, engine FROM findings WHERE submission_id='s_dup'").all();
  assert.equal(rows.filter((f) => f.rule_id === "TERM-01").length, 1);
  assert.ok(rows.some((f) => f.rule_id === "TONE-05" && f.engine === "ai"));
});

test("a model that used up its daily quota is skipped on the next call", async () => {
  const seen = [];
  ai._setClientForTests({ models: { generateContent: async (req) => {
    seen.push(req.model);
    if (req.model === ai.MODEL) { const e = new Error('{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","retryDelay":"3600s"}'); e.status = 429; throw e; }
    return jsonResponse({ summary: "ok", intent_alignment: { verdict: "aligned", note: "" }, findings: [] });
  } } });
  await ai.aiReview(db, { submission_id: null, body: "Hello members.", channel: "email", format: "text" });
  seen.length = 0;
  const r = await ai.aiReview(db, { submission_id: null, body: "Hello again.", channel: "email", format: "text" });
  assert.equal(r.ok, true);
  assert.ok(!seen.includes(ai.MODEL), "the exhausted model was not called again");
});
