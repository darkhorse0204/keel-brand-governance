import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Bars, HBars } from "../components/ui.jsx";

const VERDICT_LABEL = { supported: "Supported", outdated: "Outdated", expired: "Expired source", contradicts: "Contradicts source", unverified: "No source", unsupported: "Unsupported", prohibited: "Prohibited" };

export default function Insights() {
  const { me, notify } = useApp();
  const [d, setD] = useState(null);
  const [ev, setEv] = useState(null);
  const load = () => api("/insights").then(setD).catch((e) => notify(e.message, true));
  useEffect(() => { load(); api("/eval").then(setEv).catch(() => {}); }, []);
  if (!d) return <div className="empty">Loading…</div>;
  const t = d.totals;
  return (
    <>
      <div className="page-head">
        <div><h1>Governance insights</h1><p>Where content goes off-brand, which guidelines confuse people, and who could use coaching. Use it to fix the guidelines, not just the drafts.</p></div>
      </div>
      {t.seeded > 0 && <div className="banner" style={{ marginBottom: 14 }}>Includes {t.seeded} seeded demo submissions (marked “demo history”), so the trends have data on day one.</div>}
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Kpi v={t.submissions} l="Pieces of content checked" />
        <Kpi v={t.findings} l="Issues caught before publication" />
        <Kpi v={t.firstPassRate != null ? t.firstPassRate + "%" : "—"} l="Approved on first revision" />
        <Kpi v={t.medianHoursToApproval != null ? t.medianHoursToApproval + "h" : "—"} l="Median time to approval" />
      </div>

      {d.unclear.length > 0 && (
        <div className="card pad" style={{ marginBottom: 16 }}>
          <h2>Guidelines that may be unclear</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Rules that people often dismiss or override. A high dismissal rate usually means the guideline needs clearer scope or examples, not that people are careless.</p>
          <div className="stack">
            {d.unclear.map((r) => (
              <div key={r.rule_id} className="callout">
                <div className="row spread"><b>{r.rule_id} · {r.title}</b><span className="chip sev-major">{Math.round(r.friction * 100)}% dismissed/overridden ({r.dismissed + r.overridden} of {r.decided})</span></div>
                <div className="small" style={{ marginTop: 4 }}>{r.recommendation}</div>
                {r.examples.map((e, i) => <div key={i} className="small muted" style={{ marginTop: 4 }}>“{e.excerpt}” → <i>{e.note}</i></div>)}
                {me.role === "brand_admin" ? <Clarify rule={r} onDone={load} /> : <div className="small muted" style={{ marginTop: 6 }}>A brand admin can clarify this guideline.</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {d.clarifications?.length > 0 && <Clarifications items={d.clarifications} />}

      {ev && <Accuracy ev={ev} />}

      <div className="grid2" style={{ marginBottom: 16 }}>
        <div className="card pad">
          <h3>Issues per submission, by week</h3>
          <p className="small muted" style={{ margin: "2px 0 0" }}>Lower is better. Hover a bar for details.</p>
          <Bars data={d.weeks} valueKey="perSubmission" labelKey="label" tip={(w) => `Week ending ${w.label}: ${w.issues} issues across ${w.submissions} submissions (${w.blockers} blockers)`} />
        </div>
        <div className="card pad">
          <h3>Issues by category</h3>
          <div style={{ marginTop: 10 }}><HBars rows={Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }))} /></div>
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 16 }}>
        <div className="card pad">
          <h3>Most frequent issues</h3>
          <div style={{ marginTop: 10 }}><HBars rows={d.ruleStats.slice(0, 8).map((r) => ({ label: `${r.rule_id} ${r.title}`, value: r.total, tip: `${r.title}: ${r.total} total · ${r.accepted + r.resolved} fixed · ${r.dismissed} dismissed · ${r.overridden} overridden` }))} /></div>
        </div>
        <div className="card pad">
          <h3>Coaching opportunities</h3>
          <p className="small muted" style={{ margin: "2px 0 8px" }}>The same mistake 3 or more times from one person. Worth a quick conversation or a template.</p>
          {!d.coaching.length ? <div className="empty">No repeated patterns yet.</div> : (
            <table className="t"><tbody>{d.coaching.map((c, i) => <tr key={i}><td><b>{c.author}</b><div className="small muted">{c.role}</div></td><td>{c.title}<div className="small muted">{c.rule_id}</div></td><td><b>{c.count}×</b></td></tr>)}</tbody></table>
          )}
        </div>
      </div>

      <div className="grid3">
        <div className="card pad">
          <h3>Claim ledger</h3>
          <p className="small muted" style={{ margin: "2px 0 8px" }}>Claims and figures checked against approved facts.</p>
          <HBars rows={Object.entries(d.claims).map(([k, v]) => ({ label: VERDICT_LABEL[k] || k, value: v }))} />
        </div>
        <div className="card pad">
          <h3>Channels</h3>
          <table className="t"><thead><tr><th>Channel</th><th>Pieces</th><th>Issues/piece</th></tr></thead><tbody>{d.channels.map((c) => <tr key={c.channel}><td>{c.channel}</td><td>{c.submissions}</td><td>{c.perSubmission}</td></tr>)}</tbody></table>
        </div>
        <div className="card pad">
          <h3>Trust in each check engine</h3>
          <p className="small muted" style={{ margin: "2px 0 8px" }}>How often people accepted each engine's findings. A low rate for AI means its threshold should go up.</p>
          <table className="t"><tbody>{d.engineStats.map((e) => <tr key={e.engine}><td>{e.engine === "ai" ? "AI reviewer" : "Rule engine"}</td><td>{e.total} findings</td><td><b>{e.acceptance != null ? e.acceptance + "% accepted" : "—"}</b></td></tr>)}</tbody></table>
          <div className="small muted" style={{ marginTop: 8 }}>AI calls: {d.aiLog.calls} · kept {d.aiLog.kept} · discarded as ungrounded {d.aiLog.discarded} · redactions {d.aiLog.redactions}</div>
        </div>
      </div>
    </>
  );
}

/** Improvement 2: rewrite an unclear guideline right from the insight, and start tracking its effect. */
function Clarify({ rule, onDone }) {
  const { notify } = useApp();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(null);
  const [f, setF] = useState(null);
  const start = async () => {
    const kit = await api("/brand");
    const r = kit.rules.find((x) => x.id === rule.rule_id);
    setFull(r);
    setF({ guideline: r.guideline, example_bad: r.example_bad || "", example_good: r.example_good || "", change_note: "" });
    setOpen(true);
  };
  const save = async () => {
    try {
      await api(`/brand/rules/${rule.rule_id}`, { method: "PUT", body: { ...full, ...f, clarification: true } });
      notify(`${rule.rule_id} clarified. Keel will now compare dismissals before and after this change.`);
      setOpen(false); onDone();
    } catch (e) { notify(e.message, true); }
  };
  if (!open) return <button className="btn sm" style={{ marginTop: 8 }} onClick={start}>Clarify this guideline</button>;
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <label className="field"><span>Clearer guideline: say where it applies and where it doesn't</span><textarea className="input" rows={3} value={f.guideline} onChange={(e) => setF({ ...f, guideline: e.target.value })} /></label>
      <div className="grid2">
        <label className="field"><span>Example to avoid</span><input className="input" value={f.example_bad} onChange={(e) => setF({ ...f, example_bad: e.target.value })} /></label>
        <label className="field"><span>Example to follow</span><input className="input" value={f.example_good} onChange={(e) => setF({ ...f, example_good: e.target.value })} /></label>
      </div>
      <label className="field"><span>What did you clarify?</span><input className="input" value={f.change_note} onChange={(e) => setF({ ...f, change_note: e.target.value })} placeholder='e.g. "Doesn&#39;t apply to in-app UI labels"' /></label>
      <div className="row"><button className="btn primary sm" onClick={save}>Save clarification</button><button className="btn sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

const VERDICT = {
  improved: ["ok", "Clearer: dismissed much less"], slightly_better: ["outline", "Slightly better"], not_better: ["sev-major", "Not better yet: try again"],
  collecting: ["outline", "Collecting data"], no_baseline: ["outline", "No earlier data to compare"],
};
function Clarifications({ items }) {
  return (
    <div className="card pad" style={{ marginBottom: 16 }}>
      <h2>Did clarifying the guideline help?</h2>
      <p className="small muted" style={{ marginTop: 4 }}>For each guideline that was clarified, how often people dismissed or overrode it before and after the change. Each finding remembers which version of the rule raised it.</p>
      <div className="stack">
        {items.map((c) => {
          const [cls, label] = VERDICT[c.verdict];
          const bar = (v) => <div className="track" style={{ height: 10 }}><div className="fill" style={{ width: `${v ?? 0}%` }} /></div>;
          return (
            <div key={c.rule_id + c.to_version} className="callout">
              <div className="row spread"><b>{c.rule_id} · {c.title}</b><span className={`chip ${cls}`}>{label}</span></div>
              <div className="small muted">v{c.from_version} → v{c.to_version} by {c.changed_by} on {new Date(c.changed_at).toLocaleDateString()}{c.note ? ` · ${c.note}` : ""}</div>
              <div className="grid2" style={{ marginTop: 8, alignItems: "center" }}>
                <div className="small">Before: <b>{c.before.rejectedRate ?? "—"}{c.before.rejectedRate != null && "%"}</b> dismissed <span className="muted">({c.before.decided} decisions)</span>{bar(c.before.rejectedRate)}</div>
                <div className="small">After: <b>{c.after.rejectedRate ?? "—"}{c.after.rejectedRate != null && "%"}</b> dismissed <span className="muted">({c.after.decided} decisions{c.after.decided < c.minAfter ? `; need ${c.minAfter} to judge` : ""})</span>{bar(c.after.rejectedRate)}</div>
              </div>
              {(c.before.decided < 10 || c.after.decided < 10) && <div className="small muted" style={{ marginTop: 6 }}>Small sample: treat this as an early signal, not proof.</div>}
              <details className="small" style={{ marginTop: 6 }}><summary>Compare wording</summary>
                <div className="muted" style={{ marginTop: 4 }}>Before: “{c.guidelineBefore}”</div><div style={{ marginTop: 4 }}>Now: “{c.guidelineNow}”</div></details>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Improvement 1: the latest `npm run eval` result, so accuracy is measured rather than claimed. */
function Accuracy({ ev }) {
  const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const rows = [["Realistic drafts (used for tuning)", ev.handwritten], ["Held-out drafts (never used for tuning)", ev.holdout], ["Generated drafts", ev.generated], ["All", ev.overall]].filter(([, s]) => s);
  return (
    <div className="card pad" style={{ marginBottom: 16 }}>
      <div className="row spread"><h2>Measured accuracy of the rule engine</h2><span className={"chip " + (ev.gate.pass ? "ok" : "sev-blocker")}>Quality gate: {ev.gate.pass ? "pass" : "fail"} ({ev.gate.rule})</span></div>
      <p className="small muted" style={{ marginTop: 4 }}>From the labelled test set in <span className="mono">eval/</span>, run on every code change. Precision: of the things Keel flagged, how many were real problems. Recall: of the real problems, how many Keel flagged. Last run {new Date(ev.date).toLocaleDateString()}.</p>
      <table className="t">
        <thead><tr><th>Test set</th><th>Drafts</th><th>Precision</th><th>Recall</th><th>False alarms</th><th>Missed</th></tr></thead>
        <tbody>{rows.map(([l, s]) => <tr key={l}><td>{l}</td><td>{s.cases}</td><td><b>{pct(s.precision)}</b></td><td><b>{pct(s.recall)}</b></td><td>{s.fp}</td><td>{s.fn}</td></tr>)}</tbody>
      </table>
      {ev.baseline && <div className="small" style={{ marginTop: 6 }}>Before this round's fixes (baseline {new Date(ev.baseline.date).toLocaleDateString()}): precision {pct(ev.baseline.overall.precision)} overall, {pct(ev.baseline.handwritten?.precision)} on realistic drafts.</div>}
      {ev.errors?.length > 0 && <details className="small" style={{ marginTop: 6 }}><summary>Known errors ({ev.errors.length})</summary>
        <table className="t"><tbody>{ev.errors.map((e, i) => <tr key={i}><td className="mono">{e.case}</td><td>{e.type}</td><td>{e.rule}</td><td>“{String(e.text).slice(0, 60)}”</td></tr>)}</tbody></table></details>}
    </div>
  );
}

const Kpi = ({ v, l }) => <div className="card pad kpi"><div className="v">{v}</div><div className="l">{l}</div></div>;
