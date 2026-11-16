import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewContent } from "../server/engine/index.js";
import { maskMarkup, sentences, contrastRatio, hexToRgb, parseNumber } from "../server/engine/text.js";
import { applySuggestion } from "../server/review.js";
import { redact, unredact } from "../server/ai.js";
import { importGuidelines } from "../server/importer.js";
import * as S from "../server/seed-data.js";

const kit = {
  rules: S.RULES.map((r) => ({ ...r, enabled: 1 })),
  facts: S.FACTS.map((f) => ({ superseded_values: [], keywords: [], ...f, confidential: !!f.confidential })),
  assets: S.ASSETS, confidential: S.CONFIDENTIAL, brandName: "Fernway",
};
const TODAY = { today: "2026-11-14" };
const run = (body, extra = {}) => reviewContent({ body, format: "text", channel: "general", ...extra }, kit, TODAY);
const rules = (r) => r.findings.map((f) => f.rule_id);

test("clean on-brand copy produces no findings", () => {
  const r = run("Fernway helps you build steady savings habits. Set a savings goal in minutes and watch it grow.");
  assert.deepEqual(r.findings, []);
  assert.equal(r.stats.score, 100);
});

test("terminology: preferred term with case preserved", () => {
  const r = run("Customers love it. Our customers agree.");
  const f = r.findings.filter((x) => x.rule_id === "TERM-02");
  assert.equal(f.length, 2);
  assert.equal(f[0].suggestion.replacement, "Members");
  assert.equal(f[1].suggestion.replacement, "members");
});

test("terminology: ignores excluded contexts like 'user interface'", () => {
  assert.ok(!rules(run("The user interface is simple.")).includes("TERM-02"));
});

test("brand name spelling", () => {
  const f = run("Try FernWay today.").findings.find((x) => x.rule_id === "TERM-01");
  assert.equal(f.excerpt, "FernWay");
  assert.equal(f.suggestion.replacement, "Fernway");
});

test("outdated figure links to the current approved fact", () => {
  const f = run("Join 100,000 members today.").findings.find((x) => x.rule_id === "CLAIM-02");
  assert.match(f.message, /out of date/);
  assert.equal(f.source.id, "F-001");
  assert.equal(f.suggestion.replacement, "120,000+");
});

test("supported figure creates a 'supported' claim and requires its disclaimer", () => {
  const r = run("Savings goals earn 7.1% p.a.");
  assert.equal(r.claims[0].verdict, "supported");
  const d = r.findings.find((x) => x.rule_id === "CLAIM-03");
  assert.ok(d, "disclaimer finding expected");
  const ok = run("Savings goals earn 7.1% p.a. Rates are variable and may change.");
  assert.ok(!rules(ok).includes("CLAIM-03"));
});

test("unverified statistic is flagged; small counts are ignored", () => {
  assert.ok(rules(run("Members save 42% faster with streaks.")).includes("CLAIM-02"));
  assert.ok(!rules(run("Follow these 3 steps to start.")).includes("CLAIM-02"));
});

test("absolute promises are blockers", () => {
  const f = run("Guaranteed returns, completely risk-free.").findings.filter((x) => x.rule_id === "CLAIM-01");
  assert.equal(f.length, 2);
  assert.ok(f.every((x) => x.severity === "blocker"));
});

test("expired fact no longer supports a superlative", () => {
  // F-007 'most trusted' expired 2026-10-31
  const f = run("Fernway is the most trusted app for first-time savers.").findings.find((x) => x.rule_id === "CLAIM-01");
  assert.ok(f);
});

test("confidential terms are blockers", () => {
  const f = run("Coming soon: Project Canopy!").findings.find((x) => x.rule_id === "CONF-01");
  assert.equal(f.severity, "blocker");
});

test("accessibility: markdown alt text, link text and heading order", () => {
  const r = reviewContent({ body: "# Title\n\n### Skipped\n\n![](a.png)\n\n[click here](https://x.y)", format: "markdown", channel: "blog" }, kit, TODAY);
  assert.ok(rules(r).includes("A11Y-01"));
  assert.ok(rules(r).includes("A11Y-02"));
  assert.ok(rules(r).includes("A11Y-04"));
});

test("html: contrast and off-palette colours; markup is never checked as prose", () => {
  const body = '<p style="color:#c9a0dc;background:#F7F4EC">Hello members</p><img src="x.png"><div data-x="customers"></div>';
  const r = reviewContent({ body, format: "html", channel: "web" }, kit, TODAY);
  assert.ok(rules(r).includes("A11Y-05"));
  assert.ok(rules(r).includes("VIS-01"));
  assert.ok(rules(r).includes("A11Y-01"));
  assert.ok(!rules(r).includes("TERM-02"), "attribute text must be masked");
});

test("channel length limits", () => {
  assert.ok(rules(reviewContent({ body: "x".repeat(300), format: "text", channel: "x" }, kit, TODAY)).includes("CHAN-01"));
});

test("images: missing alt text and off-brand graphic palette", () => {
  const r = run("Hello", { images: [{ name: "promo.png", alt: "", kind: "graphic", palette: [{ hex: "#ff00ff", share: 0.6 }, { hex: "#00ffff", share: 0.3 }] }] });
  assert.ok(rules(r).includes("A11Y-01"));
  assert.ok(rules(r).includes("VIS-01"));
});

test("findings have receipts: rule/fact source and explanation", () => {
  for (const f of run("FernWay is the best! Join 100,000 customers!!").findings) {
    assert.ok(f.source?.id, "source id");
    assert.ok(f.why?.length > 10, "explanation");
    assert.ok(["blocker", "major", "minor", "info"].includes(f.severity));
  }
});

test("fingerprints are stable across identical runs", () => {
  const a = run("Customers love FernWay.").findings.map((f) => f.fingerprint);
  const b = run("Customers love FernWay.").findings.map((f) => f.fingerprint);
  assert.deepEqual(a, b);
});

test("applySuggestion replaces exactly the flagged span and relocates moved text", () => {
  const body = "Our customers love it.";
  const f = run(body).findings.find((x) => x.rule_id === "TERM-02");
  const finding = { ...f, start_pos: f.start, end_pos: f.end };
  assert.equal(applySuggestion(body, finding), "Our members love it.");
  assert.equal(applySuggestion("Hi! " + body, finding), "Hi! Our members love it.");
  assert.throws(() => applySuggestion("Totally different", finding), /changed/);
});

test("text utilities", () => {
  assert.equal(maskMarkup("<b>hi</b>", "html"), "   hi    ");
  assert.equal(sentences("Rates are 7.5% p.a. today. Next one!").length, 2);
  assert.equal(contrastRatio(hexToRgb("#000000"), hexToRgb("#ffffff")), 21);
  assert.equal(parseNumber("1.2 lakh"), 120000);
  assert.equal(parseNumber("120k"), 120000);
});

test("redaction hides confidential terms, emails and phone numbers, and round-trips", () => {
  const src = "Project Canopy launches soon — email ceo@fernway.example or call +91 98765 43210.";
  const r = redact(src, ["Project Canopy"]);
  assert.ok(!r.text.includes("Canopy") && !r.text.includes("@") && !r.text.includes("98765"));
  assert.equal(r.count, 3);
  assert.equal(unredact(r.text, r.map), src);
});

test("offline style-guide importer", () => {
  const p = importGuidelines('- Use "savings goal" not "pot" or "jar".\n- Avoid: hustle, FOMO\n- Keep a calm tone when discussing fees and charges.');
  assert.equal(p[0].type, "term_replace");
  assert.deepEqual(p[0].avoid, ["pot", "jar"]);
  assert.equal(p[1].type, "banned_phrase");
  assert.equal(p[2].type, "ai");
});

test("AI grounding: unknown rules, invented quotes and low confidence are discarded", async () => {
  const { groundFindings, redact } = await import("../server/ai.js");
  const body = "Don't miss out — Project Canopy is the smart way to save!";
  const red = redact(body, ["Project Canopy"]);
  const mk = (o) => ({ rule_id: "TONE-05", quote: "Don't miss out", issue: "FOMO", why: "fear", replacement: "Start today", severity: "minor", confidence: 0.8, ...o });
  const { kept, discarded } = groundFindings([
    mk({}),
    mk({ rule_id: "MADE-UP-9" }),
    mk({ quote: "text that is not there" }),
    mk({ confidence: 0.2 }),
    mk({ quote: "[REDACTED_1] is the smart way", rule_id: "MSG-01" }),
  ], { body, redactionMap: red.map, rules: kit.rules });
  assert.equal(kept.length, 2);
  assert.deepEqual(discarded.map((d) => d.reason), ["unknown rule", "quote not found", "low confidence"]);
  assert.equal(kept[1].excerpt, "Project Canopy is the smart way", "placeholders map back to the original text");
  assert.equal(body.slice(kept[0].start, kept[0].end), "Don't miss out");
});
