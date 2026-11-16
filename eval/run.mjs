// Runs Keel's rule engine on the labelled evaluation set and reports precision and recall.
//
//   npm run eval                 run, print a summary, write eval/report.json + docs/eval-report.md
//   npm run eval -- --baseline   also save this run as eval/baseline.json (the "before" for comparisons)
//   npm run eval -- --ai         also score the AI layer on the AI-judged cases (needs GEMINI_API_KEY)
//
// Exit code 1 if the quality gate fails: precision on blocker-level flags must be at least 0.90.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.KEEL_NO_LISTEN = "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const { openDb, loadBrandKit } = await import("../server/db.js");
const { seed } = await import("../server/seed.js");
const { reviewContent } = await import("../server/engine/index.js");
const { HANDWRITTEN, HOLDOUT, generated, EVAL_DATE } = await import("./cases.js");
const { AI_CASES } = await import("./ai-cases.js");

const GATE = { blockerPrecision: 0.9 };
const args = new Set(process.argv.slice(2));

const db = openDb(":memory:");
await seed(db);
const kit = loadBrandKit(db);
const ruleSev = Object.fromEntries(kit.rules.map((r) => [r.id, r.severity]));

function locate(body, text, n = 1) {
  let i = -1;
  for (let k = 0; k < n; k++) { i = body.indexOf(text, i + 1); if (i < 0) return null; }
  return { start: i, end: i + text.length };
}
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** Score one case: greedy one-to-one matching on rule + overlapping span. */
export function scoreCase(c, predicted) {
  const exp = c.expect.map((e) => ({ ...e, span: locate(c.body, e.text, e.n || 1) }));
  for (const e of exp) if (!e.span) throw new Error(`Label not found in ${c.id}: ${e.rule} "${e.text}"`);
  const used = new Set();
  const tp = [], fn = [];
  for (const e of exp) {
    const k = predicted.findIndex((p, i) => !used.has(i) && p.rule_id === e.rule && (p.start == null || overlaps({ start: p.start, end: p.end }, e.span)));
    // (findings without a position are about the whole document, e.g. channel length)
    if (k >= 0) { used.add(k); tp.push({ rule: e.rule, severity: predicted[k].severity, text: e.text }); }
    else fn.push({ rule: e.rule, severity: ruleSev[e.rule] || "minor", text: e.text });
  }
  const fp = predicted.filter((_, i) => !used.has(i)).map((p) => ({ rule: p.rule_id, severity: p.severity, text: p.excerpt }));
  return { tp, fp, fn };
}

const pct = (v) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : null);
function summarise(rows) {
  const tp = rows.reduce((n, r) => n + r.tp.length, 0), fp = rows.reduce((n, r) => n + r.fp.length, 0), fn = rows.reduce((n, r) => n + r.fn.length, 0);
  const precision = ratio(tp, tp + fp), recall = ratio(tp, tp + fn);
  const f1 = precision != null && recall != null && precision + recall ? Math.round((2 * precision * recall / (precision + recall)) * 1000) / 1000 : null;
  return { cases: rows.length, tp, fp, fn, precision, recall, f1 };
}
function groupBy(rows, key) {
  const g = {};
  for (const r of rows) for (const kind of ["tp", "fp", "fn"]) for (const x of r[kind]) {
    const k = x[key];
    (g[k] ||= { tp: 0, fp: 0, fn: 0 })[kind]++;
  }
  return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, { ...v, precision: ratio(v.tp, v.tp + v.fp), recall: ratio(v.tp, v.tp + v.fn) }]));
}

function runSet(cases) {
  return cases.map((c) => {
    const r = reviewContent({ body: c.body, format: c.format, channel: c.channel, images: [] }, kit, { today: EVAL_DATE });
    return { id: c.id, title: c.title, ...scoreCase(c, r.findings) };
  });
}

const sets = { handwritten: runSet(HANDWRITTEN), holdout: runSet(HOLDOUT), generated: runSet(generated()) };
const all = [...sets.handwritten, ...sets.holdout, ...sets.generated];
const bySeverity = groupBy(all, "severity");
const report = {
  engine: "rules", date: new Date().toISOString(), evalDate: EVAL_DATE,
  overall: summarise(all), handwritten: summarise(sets.handwritten), holdout: summarise(sets.holdout), generated: summarise(sets.generated),
  byRule: groupBy(all, "rule"), bySeverity,
  errors: all.flatMap((r) => [...r.fp.map((x) => ({ case: r.id, type: "false alarm", ...x })), ...r.fn.map((x) => ({ case: r.id, type: "missed", ...x }))]),
};
const blockerPrecision = bySeverity.blocker?.precision ?? 1;
report.gate = { rule: `blocker precision >= ${GATE.blockerPrecision}`, value: blockerPrecision, pass: blockerPrecision >= GATE.blockerPrecision };

// ---- optional: AI layer on the AI-judged cases
if (args.has("--ai")) {
  const { aiConfigured, aiReview, MODEL } = await import("../server/ai.js");
  if (!aiConfigured()) report.ai = { skipped: "GEMINI_API_KEY is not set" };
  else {
    const rows = [];
    for (const c of AI_CASES) {
      const r = await aiReview(db, { submission_id: null, body: c.body, channel: c.channel, format: c.format, intent: c.intent || {} });
      const preds = r.ok ? r.findings.filter((f) => c.scope.includes(f.rule_id)) : [];
      rows.push({ id: c.id, title: c.title, error: r.ok ? null : r.error, discarded: r.ok ? r.discarded.length : 0, ...scoreCase({ ...c, expect: c.expect }, preds) });
    }
    report.ai = { model: MODEL, ...summarise(rows), byRule: groupBy(rows, "rule"), discardedAsUngrounded: rows.reduce((n, r) => n + r.discarded, 0), errors: rows.filter((r) => r.error).map((r) => ({ case: r.id, error: r.error })) };
  }
}

// ---- compare with baseline
const basePath = path.join(here, "baseline.json");
if (args.has("--baseline")) fs.writeFileSync(basePath, JSON.stringify(report, null, 2));
const base = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, "utf8")) : null;
report.baseline = base && !args.has("--baseline") ? { date: base.date, overall: base.overall, handwritten: base.handwritten, generated: base.generated, bySeverity: base.bySeverity } : null;

fs.writeFileSync(path.join(here, "report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(root, "docs", "eval-report.md"), markdown(report));

console.log(`Keel rule engine: ${report.overall.cases} cases`);
for (const k of ["handwritten", "holdout", "generated", "overall"]) {
  const s = report[k];
  console.log(`  ${k.padEnd(12)} precision ${pct(s.precision).padStart(4)}  recall ${pct(s.recall).padStart(4)}  (correct ${s.tp}, false alarms ${s.fp}, missed ${s.fn})`);
}
if (report.baseline) console.log(`  baseline     precision ${pct(report.baseline.overall.precision)}  recall ${pct(report.baseline.overall.recall)}`);
if (report.ai) console.log("  AI layer:", report.ai.skipped || `precision ${pct(report.ai.precision)} recall ${pct(report.ai.recall)} on ${report.ai.cases} cases`);
console.log(`  gate: ${report.gate.rule} → ${pct(report.gate.value)} ${report.gate.pass ? "PASS" : "FAIL"}`);
console.log("  wrote eval/report.json and docs/eval-report.md");
process.exit(report.gate.pass ? 0 : 1);

function markdown(r) {
  const row = (name, s) => `| ${name} | ${s.cases ?? ""} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.tp} | ${s.fp} | ${s.fn} |`;
  const lines = [
    "# Keel accuracy report", "",
    `Generated by \`npm run eval\` on ${r.date.slice(0, 10)}. Brand kit: the fictional Fernway demo. Evaluation date for facts: ${r.evalDate}.`, "",
    "**Precision** = of the things Keel flagged, how many were real problems. **Recall** = of the real problems, how many Keel flagged.", "",
    `**Quality gate:** ${r.gate.rule}: ${pct(r.gate.value)} → ${r.gate.pass ? "**PASS**" : "**FAIL**"}`, "",
    "## Summary", "", "| Set | Cases | Precision | Recall | Correct | False alarms | Missed |", "|---|---|---|---|---|---|---|",
    row("Handwritten (realistic, used for tuning)", r.handwritten), row("Held out (written after tuning)", r.holdout), row("Generated (from sentence bank)", r.generated), row("**All**", r.overall), "",
  ];
  if (r.baseline) lines.push("## Change since baseline", "", `Baseline run: ${r.baseline.date.slice(0, 10)}`, "",
    "| Set | Precision before | Precision now | Recall before | Recall now |", "|---|---|---|---|---|",
    ...["handwritten", "generated", "overall"].filter((k) => r.baseline[k]).map((k) => `| ${k} | ${pct(r.baseline[k].precision)} | ${pct(r[k].precision)} | ${pct(r.baseline[k].recall)} | ${pct(r[k].recall)} |`), "");
  lines.push("## By severity", "", "| Severity | Precision | Recall | Correct | False alarms | Missed |", "|---|---|---|---|---|---|",
    ...Object.entries(r.bySeverity).map(([k, v]) => `| ${k} | ${pct(v.precision)} | ${pct(v.recall)} | ${v.tp} | ${v.fp} | ${v.fn} |`), "",
    "## By rule", "", "| Rule | Precision | Recall | Correct | False alarms | Missed |", "|---|---|---|---|---|---|",
    ...Object.entries(r.byRule).map(([k, v]) => `| ${k} | ${pct(v.precision)} | ${pct(v.recall)} | ${v.tp} | ${v.fp} | ${v.fn} |`), "");
  if (r.ai) lines.push("## AI layer", "", r.ai.skipped ? `Skipped: ${r.ai.skipped}.` : `Model ${r.ai.model}: precision ${pct(r.ai.precision)}, recall ${pct(r.ai.recall)} on ${r.ai.cases} cases; ${r.ai.discardedAsUngrounded} AI findings discarded as ungrounded.`, "");
  lines.push("## Every error", "", "| Case | Type | Rule | Severity | Text |", "|---|---|---|---|---|",
    ...r.errors.map((e) => `| ${e.case} | ${e.type} | ${e.rule} | ${e.severity} | ${String(e.text || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 90)} |`), "",
    "The held-out set was written after the engine was tuned and is never used for tuning, so it is the fairest estimate of accuracy on new content. Generated cases are built from a bank of sentences written by people who know the rules, so they are easier than real content. ", "");
  return lines.join("\n");
}
