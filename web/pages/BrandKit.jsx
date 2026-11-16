import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { SevChip } from "../components/ui.jsx";

const TYPE_LABEL = { term_replace: "Terminology", canonical_spelling: "Spelling", banned_phrase: "Banned phrases", max_count: "Frequency limit", conditional_required: "Required wording", builtin: "Built-in check", ai: "AI judgement" };

export default function BrandKit() {
  const { me, notify } = useApp();
  const admin = me.role === "brand_admin";
  const [kit, setKit] = useState(null);
  const [tab, setTab] = useState("rules");
  const load = () => api("/brand").then(setKit).catch((e) => notify(e.message, true));
  useEffect(() => { load(); }, []);
  if (!kit) return <div className="empty">Loading…</div>;
  return (
    <>
      <div className="page-head">
        <div><h1>Brand kit</h1><p>The single source of truth Keel checks against: guidelines, approved facts, assets and the confidential register. Every finding links back to an entry here.</p></div>
        {admin && <a className="btn" href="/api/brand/export" onClick={async (e) => { e.preventDefault(); const r = await api("/brand/export"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" })); a.download = "brand-kit.json"; a.click(); }}>Export JSON</a>}
      </div>
      {kit.hidden && <div className="banner" style={{ marginBottom: 12 }}>🔒 {kit.hidden}</div>}
      <div className="tabs">
        {[["rules", `Guidelines (${kit.rules.length})`], ["facts", `Approved facts (${kit.facts.length})`], ["assets", `Assets (${kit.assets.length})`], ...(kit.hidden ? [] : [["confidential", `Confidential (${kit.confidential.length})`]]), ...(admin ? [["import", "Import style guide"]] : [])]
          .map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "rules" && <Rules kit={kit} admin={admin} reload={load} />}
      {tab === "facts" && <Facts kit={kit} admin={admin} reload={load} />}
      {tab === "assets" && <Assets kit={kit} admin={admin} reload={load} />}
      {tab === "confidential" && <Confidential kit={kit} admin={admin} reload={load} />}
      {tab === "import" && <Import reload={load} goRules={() => setTab("rules")} />}
    </>
  );
}

function RuleHistory({ id }) {
  const [h, setH] = useState(null);
  useEffect(() => { api(`/brand/rules/${id}/history`).then(setH).catch(() => setH([])); }, [id]);
  if (!h?.length) return null;
  return (
    <div className="small">
      <b>History</b>
      {h.map((x) => (
        <div key={x.id} style={{ padding: "4px 0", borderTop: "1px solid var(--border)" }}>
          v{x.from_version} → v{x.to_version} · {x.kind === "clarification" ? <span className="chip outline">clarification</span> : "edit"} · {x.changed_by_name || x.changed_by} · {new Date(x.changed_at).toLocaleDateString()}
          {x.note && <> · {x.note}</>}
          {x.before?.guideline && <div className="muted">Before: “{x.before.guideline}”</div>}
        </div>
      ))}
    </div>
  );
}

function Rules({ kit, admin, reload }) {
  const { notify } = useApp();
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState("");
  const rows = kit.rules.filter((r) => !q || (r.id + r.title + r.guideline + r.category).toLowerCase().includes(q.toLowerCase()));
  const save = async () => {
    try { await api(`/brand/rules/${edit.id}`, { method: "PUT", body: { ...edit, config: typeof edit.configText === "string" ? JSON.parse(edit.configText) : edit.config } }); notify("Rule saved. Version bumped."); setEdit(null); reload(); }
    catch (e) { notify(e.message.includes("JSON") ? "Config must be valid JSON" : e.message, true); }
  };
  return (
    <div className="card">
      <div className="card-head"><input className="input" style={{ maxWidth: 320 }} placeholder="Search guidelines" value={q} onChange={(e) => setQ(e.target.value)} /><span className="small muted">Rules are stored as data. Change a rule here and every future check uses it, no deploy needed.</span></div>
      <div style={{ overflowX: "auto" }}>
        <table className="t">
          <thead><tr><th>ID</th><th>Guideline</th><th>Check</th><th>Severity</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => edit?.id === r.id ? (
              <tr key={r.id}><td colSpan={5}>
                <div className="stack">
                  <div className="grid3">
                    <label className="field"><span>Title</span><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
                    <label className="field"><span>Severity</span><select className="input" value={edit.severity} onChange={(e) => setEdit({ ...edit, severity: e.target.value })}>{["blocker", "major", "minor", "info"].map((s) => <option key={s}>{s}</option>)}</select></label>
                    <label className="field"><span>Enabled</span><select className="input" value={edit.enabled ? "1" : "0"} onChange={(e) => setEdit({ ...edit, enabled: e.target.value === "1" })}><option value="1">Enabled</option><option value="0">Disabled</option></select></label>
                  </div>
                  <label className="field"><span>Guideline (shown to creators as the reason)</span><textarea className="input" rows={2} value={edit.guideline} onChange={(e) => setEdit({ ...edit, guideline: e.target.value })} /></label>
                  <label className="field"><span>Rationale</span><input className="input" value={edit.rationale || ""} onChange={(e) => setEdit({ ...edit, rationale: e.target.value })} /></label>
                  <div className="grid2">
                    <label className="field"><span>Example to avoid</span><input className="input" value={edit.example_bad || ""} onChange={(e) => setEdit({ ...edit, example_bad: e.target.value })} /></label>
                    <label className="field"><span>Example to follow</span><input className="input" value={edit.example_good || ""} onChange={(e) => setEdit({ ...edit, example_good: e.target.value })} /></label>
                  </div>
                  <label className="field"><span>Check configuration (JSON)</span><textarea className="input mono" rows={6} value={edit.configText} onChange={(e) => setEdit({ ...edit, configText: e.target.value })} /></label>
                  <label className="field"><span>What changed? (kept in the rule's history)</span><input className="input" value={edit.change_note || ""} onChange={(e) => setEdit({ ...edit, change_note: e.target.value })} placeholder="e.g. Said that the rule doesn't apply to in-app UI labels" /></label>
                  <label className="row small"><input type="checkbox" checked={!!edit.clarification} onChange={(e) => setEdit({ ...edit, clarification: e.target.checked })} /> This change clarifies the guideline. Track whether people dismiss it less afterwards (shown on Insights).</label>
                  <div className="row"><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
                  <RuleHistory id={edit.id} />
                </div>
              </td></tr>
            ) : (
              <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                <td className="mono small">{r.id}<div className="muted">v{r.version}</div></td>
                <td><b>{r.title}</b><div className="small">{r.guideline}</div>{r.rationale && <div className="small muted">Why: {r.rationale}</div>}</td>
                <td><span className={"chip " + (r.type === "ai" ? "ai" : "rules")}>{TYPE_LABEL[r.type]}</span><div className="small muted">{r.category}</div></td>
                <td><SevChip s={r.severity} /></td>
                <td>{admin && <button className="btn sm" onClick={() => setEdit({ ...r, enabled: !!r.enabled, configText: JSON.stringify(r.config, null, 2) })}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Facts({ kit, admin, reload }) {
  const { notify } = useApp();
  const blank = { statement: "", value: "", keywords: "", superseded_values: "", source: "", valid_from: "", valid_until: "", required_disclaimer: "", confidential: false };
  const [f, setF] = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const save = async () => {
    try {
      await api("/brand/facts", { method: "POST", body: { ...f, keywords: split(f.keywords), superseded_values: split(f.superseded_values) } });
      notify("Fact saved"); setF(null); reload();
    } catch (e) { notify(e.message, true); }
  };
  return (
    <div className="stack">
      {admin && !f && <button className="btn primary" onClick={() => setF(blank)}>+ Add approved fact</button>}
      {f && (
        <div className="card pad stack">
          <label className="field"><span>Statement (exact approved wording)</span><input className="input" value={f.statement} onChange={(e) => setF({ ...f, statement: e.target.value })} /></label>
          <div className="grid3">
            <label className="field"><span>Key figure</span><input className="input" value={f.value || ""} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="e.g. 120,000+" /></label>
            <label className="field"><span>Keywords (comma-separated)</span><input className="input" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} /></label>
            <label className="field"><span>Superseded figures</span><input className="input" value={f.superseded_values} onChange={(e) => setF({ ...f, superseded_values: e.target.value })} placeholder="old values to flag as outdated" /></label>
            <label className="field"><span>Source</span><input className="input" value={f.source || ""} onChange={(e) => setF({ ...f, source: e.target.value })} /></label>
            <label className="field"><span>Valid from</span><input type="date" className="input" value={f.valid_from || ""} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></label>
            <label className="field"><span>Valid until</span><input type="date" className="input" value={f.valid_until || ""} onChange={(e) => setF({ ...f, valid_until: e.target.value })} /></label>
          </div>
          <label className="field"><span>Required disclaimer</span><input className="input" value={f.required_disclaimer || ""} onChange={(e) => setF({ ...f, required_disclaimer: e.target.value })} /></label>
          <label className="row small"><input type="checkbox" checked={!!f.confidential} onChange={(e) => setF({ ...f, confidential: e.target.checked })} /> Confidential: never publish, never send to AI, hide from agency accounts</label>
          <div className="row"><button className="btn primary" onClick={save}>Save fact</button><button className="btn" onClick={() => setF(null)}>Cancel</button></div>
        </div>
      )}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="t">
          <thead><tr><th>ID</th><th>Approved statement</th><th>Figure</th><th>Validity</th><th></th></tr></thead>
          <tbody>
            {kit.facts.map((x) => {
              const expired = x.valid_until && x.valid_until < today;
              return (
                <tr key={x.id}>
                  <td className="mono small">{x.id}</td>
                  <td>{x.confidential ? <span className="chip sev-blocker">🔒 confidential</span> : null} {x.statement}
                    <div className="small muted">{x.source}</div>
                    {x.required_disclaimer && <div className="small">Disclaimer: “{x.required_disclaimer}”</div>}
                    {x.superseded_values?.length > 0 && <div className="small muted">Outdated figures flagged: {x.superseded_values.join(", ")}</div>}</td>
                  <td>{x.value || "—"}</td>
                  <td className="small">{expired ? <span className="chip sev-major">Expired {x.valid_until}</span> : x.valid_until ? `until ${x.valid_until}` : "no expiry"}</td>
                  <td>{admin && <div className="row"><button className="btn sm" onClick={() => setF({ ...x, keywords: x.keywords.join(", "), superseded_values: x.superseded_values.join(", ") })}>Edit</button>
                    <button className="btn sm ghost danger" onClick={async () => { if (confirm(`Delete fact ${x.id}?`)) { await api(`/brand/facts/${x.id}`, { method: "DELETE" }); reload(); } }}>Delete</button></div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
const split = (s) => (Array.isArray(s) ? s : (s || "").split(",").map((x) => x.trim()).filter(Boolean));

function Assets({ kit, admin, reload }) {
  const { notify } = useApp();
  const [a, setA] = useState(null);
  const groups = kit.assets.reduce((g, x) => ((g[x.kind] ||= []).push(x), g), {});
  return (
    <div className="stack">
      {admin && !a && <button className="btn primary" onClick={() => setA({ kind: "color", name: "", value: "", usage: "" })}>+ Add asset</button>}
      {a && (
        <div className="card pad">
          <div className="grid4">
            <label className="field"><span>Kind</span><select className="input" value={a.kind} onChange={(e) => setA({ ...a, kind: e.target.value })}>{["color", "font", "logo", "boilerplate"].map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="field"><span>Name</span><input className="input" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></label>
            <label className="field"><span>Value</span><input className="input" value={a.value} onChange={(e) => setA({ ...a, value: e.target.value })} placeholder={a.kind === "color" ? "#1F6F4A" : ""} /></label>
            <label className="field"><span>Usage rule</span><input className="input" value={a.usage} onChange={(e) => setA({ ...a, usage: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={async () => { try { await api("/brand/assets", { method: "POST", body: a }); setA(null); reload(); } catch (e) { notify(e.message, true); } }}>Save</button><button className="btn" onClick={() => setA(null)}>Cancel</button></div>
        </div>
      )}
      <div className="grid2">
        {Object.entries(groups).map(([kind, xs]) => (
          <div key={kind} className="card">
            <div className="card-head"><h3 style={{ textTransform: "capitalize" }}>{kind === "color" ? "Palette" : kind + "s"}</h3></div>
            <div style={{ padding: 12 }} className="stack">
              {xs.map((x) => (
                <div key={x.id} className="row" style={{ alignItems: "flex-start" }}>
                  {kind === "color" && <span className="swatch" style={{ background: x.value, width: 34, height: 34 }} />}
                  <div className="grow"><b>{x.name}</b> <span className="mono small muted">{kind === "boilerplate" ? "" : x.value}</span>{x.confidential ? <span className="chip sev-blocker" style={{ marginLeft: 6 }}>🔒 confidential</span> : null}
                    {kind === "boilerplate" && <div className="small">“{x.value}”</div>}
                    <div className="small muted">{x.usage}</div></div>
                  {admin && <button className="btn sm ghost danger" onClick={async () => { if (confirm(`Delete ${x.name}?`)) { await api(`/brand/assets/${x.id}`, { method: "DELETE" }); reload(); } }}>Delete</button>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Confidential({ kit, admin, reload }) {
  const [t, setT] = useState({ term: "", reason: "", until: "" });
  return (
    <div className="card">
      <div className="card-head"><span className="small">Terms listed here are flagged as <b>blockers</b> in any content, and are <b>replaced with placeholders</b> before any text is sent to an AI service.</span></div>
      <table className="t"><thead><tr><th>Term</th><th>Reason</th><th>Embargo until</th><th></th></tr></thead>
        <tbody>
          {kit.confidential.map((c) => <tr key={c.id}><td><b>{c.term}</b></td><td>{c.reason}</td><td>{c.until || "indefinite"}</td><td>{admin && <button className="btn sm ghost danger" onClick={async () => { await api(`/brand/confidential/${c.id}`, { method: "DELETE" }); reload(); }}>Remove</button>}</td></tr>)}
          {admin && <tr><td><input className="input" placeholder="Codename or term" value={t.term} onChange={(e) => setT({ ...t, term: e.target.value })} /></td><td><input className="input" value={t.reason} onChange={(e) => setT({ ...t, reason: e.target.value })} placeholder="Why it's confidential" /></td>
            <td><input type="date" className="input" value={t.until} onChange={(e) => setT({ ...t, until: e.target.value })} /></td><td><button className="btn primary sm" disabled={!t.term.trim()} onClick={async () => { await api("/brand/confidential", { method: "POST", body: t }); setT({ term: "", reason: "", until: "" }); reload(); }}>Add</button></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const SAMPLE_GUIDE = `# Voice & vocabulary
- Use "savings goal" not "pot" or "jar".
- Say "members" instead of "customers".
- Avoid: crushing it, hustle, FOMO
- Never say "free money".
- Keep a calm, reassuring tone when talking about fees or charges.
- Headlines should lead with the member benefit, not the feature.`;

function Import({ reload, goRules }) {
  const { meta, notify } = useApp();
  const [text, setText] = useState(SAMPLE_GUIDE);
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState({});
  const [busy, setBusy] = useState(false);
  const run = async (ai) => {
    setBusy(true);
    try { const r = await api("/brand/import", { method: "POST", body: { text, ai } }); setRes(r); setPick(Object.fromEntries(r.proposals.map((_, i) => [i, true]))); }
    catch (e) { notify(e.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="grid2">
      <div className="card pad stack">
        <p className="small muted" style={{ margin: 0 }}>Paste an existing style guide. Keel turns it into proposed rules. <b>Nothing is saved until you review and accept them.</b></p>
        <textarea className="input mono" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => run(false)}>Extract rules (offline parser)</button>
          {meta?.aiEnabled && <button className="btn ai" disabled={busy} onClick={() => run(true)}>{busy ? "Working…" : "Extract with AI"}</button>}</div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Proposed rules</h3>{res && <span className="chip outline">{res.engine === "ai" ? "AI extraction" : "Offline parser"}</span>}</div>
        {!res ? <div className="empty">Run an extraction to review proposals.</div> : (
          <div className="findings">
            {res.proposals.map((p, i) => (
              <label key={i} className="finding" style={{ display: "block", cursor: "pointer" }}>
                <div className="row"><input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick({ ...pick, [i]: e.target.checked })} /><b>{p.title}</b><span className={"chip " + (p.type === "ai" ? "ai" : "rules")}>{TYPE_LABEL[p.type]}</span><SevChip s={p.severity} /></div>
                <div className="small" style={{ marginTop: 4 }}>{p.guideline}</div>
                {p.preferred && <div className="small muted">Preferred: “{p.preferred}”</div>}
                {p.avoid?.length > 0 && <div className="small muted">Flag: {p.avoid.map((x) => `“${x}”`).join(", ")}</div>}
              </label>
            ))}
            <button className="btn primary" onClick={async () => { const proposals = res.proposals.filter((_, i) => pick[i]); const r = await api("/brand/import/commit", { method: "POST", body: { proposals } }); notify(`Added ${r.ids.length} rules`); setRes(null); reload(); goRules(); }}>Add selected rules</button>
          </div>
        )}
      </div>
    </div>
  );
}
