// Governance insights: recurring mistakes, guideline friction (rules people keep
// dismissing = possibly unclear guidelines), coaching opportunities and AI trust.
import { j } from "./db.js";

export function computeInsights(db) {
  const subs = db.prepare("SELECT * FROM submissions").all();
  // count each issue once: skip rows that were carried forward into a newer revision
  const fs = db.prepare("SELECT f.*, s.author_id, s.channel FROM findings f JOIN submissions s ON s.id=f.submission_id WHERE f.status != 'carried'").all();
  const users = Object.fromEntries(db.prepare("SELECT id,name,role FROM users").all().map((u) => [u.id, u]));
  const rules = Object.fromEntries(db.prepare("SELECT id,title,category,guideline FROM rules").all().map((r) => [r.id, r]));

  const byCategory = tally(fs, (f) => f.category);
  const bySeverity = tally(fs, (f) => f.severity);

  // guideline changes marked as clarifications, and the version each one introduced
  const history = db.prepare("SELECT h.*, u.name changed_by_name FROM rule_history h LEFT JOIN users u ON u.id=h.changed_by WHERE kind='clarification' ORDER BY changed_at").all();
  const clarifiedFrom = {};
  for (const h of history) clarifiedFrom[h.rule_id] = Math.max(clarifiedFrom[h.rule_id] || 0, h.to_version);
  const ver = (f) => f.rule_version ?? 1;

  // rule friction (for a clarified rule, only decisions made on the clarified version count)
  const perRule = {};
  for (const f of fs) {
    if (clarifiedFrom[f.rule_id] && ver(f) < clarifiedFrom[f.rule_id]) continue;
    const r = (perRule[f.rule_id] ||= { rule_id: f.rule_id, title: rules[f.rule_id]?.title || f.rule_id, category: f.category, total: 0, accepted: 0, resolved: 0, dismissed: 0, overridden: 0, open: 0, reasons: {}, examples: [] });
    r.total++;
    r[f.status] = (r[f.status] || 0) + 1;
    if (f.status === "dismissed" || f.status === "overridden") {
      const reason = (f.resolution_note || "unspecified").split(":")[0];
      r.reasons[reason] = (r.reasons[reason] || 0) + 1;
      if (r.examples.length < 3 && f.resolution_note && !r.examples.some((e) => e.note === f.resolution_note)) r.examples.push({ excerpt: f.excerpt, note: f.resolution_note });
    }
  }
  const ruleStats = Object.values(perRule).map((r) => {
    const decided = r.accepted + r.resolved + r.dismissed + r.overridden;
    const friction = decided ? (r.dismissed + r.overridden) / decided : 0;
    return { ...r, decided, friction: Math.round(friction * 100) / 100 };
  }).sort((a, b) => b.total - a.total);
  const unclear = ruleStats.filter((r) => r.decided >= 3 && r.friction >= 0.4).sort((a, b) => b.friction - a.friction)
    .map((r) => ({ ...r, recommendation: recommend(r) }));

  // did clarifying a guideline help? compare the dismissal rate before and after the change
  const MIN_AFTER = 5;
  const DECIDED = ["accepted", "resolved", "dismissed", "overridden"];
  const rejected = (x) => x.status === "dismissed" || x.status === "overridden";
  const clarifications = history.slice().reverse().map((h) => {
    const rows = fs.filter((f) => f.rule_id === h.rule_id && DECIDED.includes(f.status));
    const before = rows.filter((f) => ver(f) <= h.from_version), after = rows.filter((f) => ver(f) >= h.to_version);
    const rate = (xs) => (xs.length ? Math.round((xs.filter(rejected).length / xs.length) * 100) : null);
    const b = rate(before), a = rate(after);
    const verdict = after.length < MIN_AFTER ? "collecting" : b == null ? "no_baseline" : a <= b - 15 ? "improved" : a < b ? "slightly_better" : "not_better";
    return { rule_id: h.rule_id, title: rules[h.rule_id]?.title || h.rule_id, changed_at: h.changed_at, changed_by: h.changed_by_name, note: h.note,
      from_version: h.from_version, to_version: h.to_version, before: { decided: before.length, rejectedRate: b }, after: { decided: after.length, rejectedRate: a },
      verdict, minAfter: MIN_AFTER, guidelineBefore: j(h.before, {}).guideline, guidelineNow: rules[h.rule_id]?.guideline };
  });

  // coaching: repeated mistakes per author
  const coaching = [];
  const byAuthorRule = tally(fs.filter((f) => ["accepted", "resolved", "open"].includes(f.status)), (f) => `${f.author_id}|${f.rule_id}`);
  for (const [k, n] of Object.entries(byAuthorRule)) {
    const [a, r] = k.split("|");
    if (n >= 3) coaching.push({ author: users[a]?.name || a, role: users[a]?.role, rule_id: r, title: rules[r]?.title || r, count: n });
  }
  coaching.sort((a, b) => b.count - a.count);

  // weekly trend (last 8 weeks) of issues per submission
  const weeks = [];
  const nowMs = Date.now();
  for (let w = 7; w >= 0; w--) {
    const from = nowMs - (w + 1) * 7 * 864e5, to = nowMs - w * 7 * 864e5;
    const s = subs.filter((x) => { const t = Date.parse(x.created_at); return t >= from && t < to; });
    const ids = new Set(s.map((x) => x.id));
    const f = fs.filter((x) => ids.has(x.submission_id));
    weeks.push({ label: new Date(to).toISOString().slice(5, 10), submissions: s.length, issues: f.length, perSubmission: s.length ? Math.round((f.length / s.length) * 10) / 10 : 0,
      blockers: f.filter((x) => x.severity === "blocker").length });
  }

  // workflow health
  const approved = subs.filter((s) => s.approved_at);
  const hours = approved.map((s) => (Date.parse(s.approved_at) - Date.parse(s.created_at)) / 36e5).sort((a, b) => a - b);
  const median = hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null;
  const firstPass = approved.filter((s) => s.current_revision === 1).length;

  // AI trust calibration
  const engineStats = ["rules", "ai"].map((e) => {
    const x = fs.filter((f) => f.engine === e);
    const decided = x.filter((f) => f.status !== "open");
    const acc = decided.filter((f) => ["accepted", "resolved"].includes(f.status)).length;
    return { engine: e, total: x.length, decided: decided.length, acceptance: decided.length ? Math.round((acc / decided.length) * 100) : null };
  });
  const aiLog = db.prepare("SELECT COUNT(*) calls, COALESCE(SUM(kept),0) kept, COALESCE(SUM(discarded),0) discarded, COALESCE(SUM(redactions),0) redactions FROM ai_log").get();

  const claims = tally(db.prepare("SELECT verdict FROM claims").all(), (c) => c.verdict);
  const channels = Object.entries(tally(subs, (s) => s.channel)).map(([channel, n]) => ({
    channel, submissions: n, issues: fs.filter((f) => f.channel === channel).length,
  })).map((c) => ({ ...c, perSubmission: Math.round((c.issues / c.submissions) * 10) / 10 })).sort((a, b) => b.perSubmission - a.perSubmission);

  return {
    totals: {
      submissions: subs.length, seeded: subs.filter((s) => s.seeded).length, findings: fs.length, approved: approved.length,
      inReview: subs.filter((s) => s.status === "in_review").length, medianHoursToApproval: median,
      firstPassRate: approved.length ? Math.round((firstPass / approved.length) * 100) : null,
    },
    byCategory, bySeverity, ruleStats: ruleStats.slice(0, 12), unclear, clarifications, coaching: coaching.slice(0, 8), weeks, engineStats, aiLog, claims, channels,
  };
}

function recommend(r) {
  const top = Object.entries(r.reasons).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top === "guideline_unclear") return `Reviewers dismiss "${r.title}" ${Math.round(r.friction * 100)}% of the time, most often as "guideline unclear". Clarify scope (where does it apply, and where not?) and add examples.`;
  if (top === "false_positive") return `Frequent false positives. Narrow the rule's pattern or add documented exceptions.`;
  if (top === "intentional_exception") return `People keep making approved exceptions. Consider writing the exception into the guideline.`;
  return `High dismissal rate. Review whether this rule still reflects how the brand wants to write.`;
}

function tally(arr, fn) { return arr.reduce((a, x) => { const k = fn(x); a[k] = (a[k] || 0) + 1; return a; }, {}); }
export { j };
