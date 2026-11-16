import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../api.js";
import { useApp, go, roleLabel } from "../App.jsx";
import { Highlighter, WordDiff, SevChip, StatusChip, EngineChip, ImageList, timeAgo, channelLabel, pageRanges, pageOf, SEV_ORDER, STATUS_LABEL } from "../components/ui.jsx";

const VERDICT = {
  supported: ["ok", "Supported"], outdated: ["sev-major", "Outdated"], expired: ["sev-major", "Expired source"], contradicts: ["sev-major", "Contradicts source"],
  unverified: ["sev-major", "No source"], unsupported: ["sev-major", "Unsupported"], prohibited: ["sev-blocker", "Prohibited"],
};
const STEPS = ["draft", "in_review", "approved", "published"];

export default function Submission({ id }) {
  const { me, meta, notify } = useApp();
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState("findings");
  const [show, setShow] = useState("open");
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null);
  const [page, setPage] = useState("");

  const load = useCallback(() => api(`/submissions/${id}`).then(setD).catch((e) => notify(e.message, true)), [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (key, fn, okMsg) => {
    setBusy(key);
    try { const r = await fn(); if (okMsg) notify(typeof okMsg === "function" ? okMsg(r) : okMsg); await load(); return r; }
    catch (e) { notify(e.message, true); }
    finally { setBusy(null); }
  };

  const findings = d?.findings || [];
  const pages = useMemo(() => pageRanges(d?.revision?.body), [d]);
  const open = findings.filter((f) => f.status === "open");
  const visible = useMemo(() => (show === "open" ? open : findings.filter((f) => f.status !== "open"))
    .filter((f) => !page || pageOf(pages, f.start_pos) === page)
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.start_pos ?? 1e9) - (b.start_pos ?? 1e9)), [findings, show, page, pages]);

  if (!d) return <div className="empty">Loading…</div>;
  const { submission: s, revision: rev, permissions: p, stats } = d;
  const openBlockers = open.filter((f) => f.severity === "blocker").length;
  const openMajors = open.filter((f) => f.severity === "major").length;

  const select = (fid) => { setSel(fid); setTab("findings"); const f = findings.find((x) => x.id === fid); if (f && f.status !== "open") setShow("done"); else setShow("open");
    setTimeout(() => document.getElementById("f-" + fid)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30); };

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/" className="small">← Queue</a>
          <h1 style={{ marginTop: 4 }}>{s.title}</h1>
          <div className="row small muted" style={{ marginTop: 6 }}>
            <StatusChip s={s.status} /> {channelLabel(s.channel)} · {s.format} · by {s.author?.name} ({roleLabel(s.author?.role)})
            {s.reviewer && <> · reviewer {s.reviewer.name}</>} · revision {rev.number}
            {s.seeded ? <span className="chip outline">demo history</span> : null}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="score">{stats.score}<small>/100 brand fit</small></div>
          <div className="small muted">grade {stats.grade} reading level · {stats.words} words</div>
        </div>
      </div>

      <Workflow d={d} openBlockers={openBlockers} openMajors={openMajors} busy={busy} act={act} meta={meta} />

      {(s.intent?.goal || s.intent?.cta) && (
        <div className="callout teal small" style={{ margin: "12px 0" }}>
          <b>Creator intent</b>: {s.intent.goal || "—"} · <b>Audience</b>: {s.intent.audience || "—"} · <b>CTA</b>: {s.intent.cta || "—"}
          {d.ai?.ok && d.ai.intent && <> — <b>AI intent check</b>: {d.ai.intent.verdict.replace("_", " ")}. {d.ai.intent.note}</>}
        </div>
      )}

      <div className="workspace" style={{ marginTop: 12 }}>
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Content <span className="muted small">revision {rev.number}{rev.note ? ` · ${rev.note}` : ""}</span></h3>
              <div className="row">
                {p.edit && !editing && <button className="btn sm" onClick={() => setEditing({ body: rev.body, images: rev.images, note: "" })}>Edit</button>}
                <button className="btn sm" disabled={!!busy} onClick={() => act("rerun", () => api(`/submissions/${id}/review`, { method: "POST", body: { ai: false } }), "Rule check re-run")}>Re-check</button>
                {p.runAi && <button className="btn sm ai" disabled={!!busy} onClick={() => act("ai", () => api(`/submissions/${id}/review`, { method: "POST", body: { ai: true } }),
                  (r) => r.ai?.ok ? `AI review: ${r.ai.kept} finding(s) kept, ${r.ai.discarded} discarded as ungrounded` : `AI review failed: ${r.ai?.error}`)}>
                  {busy === "ai" ? "AI reviewing…" : "Run AI review"}</button>}
              </div>
            </div>
            {editing ? (
              <div className="card-head" style={{ display: "block", borderBottom: "none" }}>
                <textarea className="input mono" rows={16} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="Content" />
                <div className="row" style={{ marginTop: 8 }}>
                  <input className="input grow" style={{ width: "auto" }} placeholder="What changed? (shown in revision history)" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
                  <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="btn primary" disabled={!!busy} onClick={async () => { await act("save", () => api(`/submissions/${id}/content`, { method: "PUT", body: editing }), "Saved as a new revision and re-checked"); setEditing(null); }}>Save revision</button>
                </div>
                {s.status === "approved" && <p className="gate warn" style={{ marginTop: 8 }}>This content is approved. Saving an edit sends it back for review, because the approval only covers the version that was reviewed.</p>}
              </div>
            ) : <Highlighter text={rev.body} findings={findings} selected={sel} onSelect={select} mono={s.format !== "text"} />}
          </div>
          {rev.images?.length > 0 && (
            <div className="card pad">
              <h3 style={{ marginBottom: 10 }}>Images</h3>
              <ImageList images={rev.images} readOnly
                onOcr={p.edit ? (i) => act("ocr" + i, () => api(`/submissions/${id}/images/${i}/ocr`, { method: "POST" }), (r) => `Read the text in the image (${r.confidence}% confidence) and added it as a new revision. Re-checked.`) : null}
                ocrBusy={!!busy?.startsWith?.("ocr")} onAiReview={p.runAi ? (i) => act("img" + i, () => api(`/submissions/${id}/images/${i}/ai-review`, { method: "POST" }), (r) => `AI visual review: ${r.findings} finding(s). Suggested alt text: “${r.suggested_alt}”`) : null} aiBusy={!!busy?.startsWith?.("img")} />
            </div>
          )}
          {s.format === "html" && <div className="card"><div className="card-head"><h3>Rendered preview</h3><span className="small muted">sandboxed, scripts disabled</span></div>
            <iframe title="Preview" sandbox="" srcDoc={rev.body} style={{ width: "100%", height: 280, border: 0 }} /></div>}
        </div>

        <div className="card">
          <div className="tabs" style={{ padding: "0 8px", marginBottom: 0 }} role="tablist">
            {[["findings", `Findings (${open.length} open)`], ["claims", `Claim ledger (${d.claims.length})`], ["history", `Revisions (${d.revisions.length})`], ["discussion", `Discussion (${d.comments.length})`]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === "findings" && (
            <>
              <div className="row spread" style={{ padding: "10px 12px 0" }}>
                <div className="seg"><button className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>Open ({open.length})</button><button className={show === "done" ? "on" : ""} onClick={() => setShow("done")}>Handled ({findings.length - open.length})</button></div>
                {pages.length > 1 && <select className="input" style={{ width: "auto", padding: "3px 6px" }} value={page} onChange={(e) => setPage(e.target.value)} aria-label="Filter by page">
                  <option value="">All pages ({pages.length})</option>{pages.map((p) => <option key={p.label} value={p.label}>{p.label} ({open.filter((f) => pageOf(pages, f.start_pos) === p.label).length} open)</option>)}
                </select>}
                {d.ai && <span className="small muted">{d.ai.ok ? `AI reviewed ${timeAgo(d.ai.at)} · ${d.ai.discarded} ungrounded discarded` : `AI: ${d.ai.error}`}</span>}
              </div>
              {d.ai?.ok && d.ai.summary && show === "open" && <div className="small" style={{ padding: "8px 12px 0" }}><span className="chip ai">AI summary</span> {d.ai.summary}</div>}
              <div className="findings">
                {!visible.length && <div className="empty">{show === "open" ? "No open findings. This revision is ready for review." : "Nothing handled yet."}</div>}
                {visible.map((f) => <FindingCard key={f.id} f={f} page={pageOf(pages, f.start_pos)} sel={sel === f.id} onSel={() => setSel(f.id)} perms={p} me={me} meta={meta} busy={busy} act={act} subId={id} author={s.author_id} />)}
              </div>
            </>
          )}
          {tab === "claims" && <Claims claims={d.claims} onSelect={(c) => { const f = findings.find((x) => x.start_pos >= c.start_pos && x.end_pos <= c.end_pos && ["claims", "facts"].includes(x.category)); if (f) select(f.id); }} />}
          {tab === "history" && <History d={d} id={id} />}
          {tab === "discussion" && <Discussion d={d} id={id} act={act} busy={busy} />}
        </div>
      </div>
    </>
  );
}

function Workflow({ d, openBlockers, openMajors, busy, act, meta }) {
  const { submission: s, permissions: p } = d;
  const [note, setNote] = useState("");
  const [reviewer, setReviewer] = useState(s.reviewer_id || "");
  const t = (action) => act(action, () => api(`/submissions/${s.id}/transition`, { method: "POST", body: { action, note, reviewer_id: reviewer || undefined } }), `Status: ${action.replace("_", " ")}`).then(() => setNote(""));
  const idx = s.status === "changes_requested" ? 0 : STEPS.indexOf(s.status);
  const gate = openBlockers ? ["bad", `${openBlockers} blocker${openBlockers > 1 ? "s" : ""} must be fixed (or overridden by a reviewer with a written reason) before approval.`]
    : openMajors ? ["warn", `${openMajors} major issue${openMajors > 1 ? "s" : ""} open. A reviewer can approve only with a note acknowledging them.`]
    : ["good", "No blockers or major issues open. Ready for a human decision."];
  return (
    <div className="card pad">
      <div className="row spread">
        <div className="stepper" aria-label="Workflow">
          {STEPS.map((st, i) => <span key={st} className={"s" + (i === idx ? " on" : i < idx ? " past" : "")}>{STATUS_LABEL[st]}</span>)}
          {s.status === "changes_requested" && <span className="chip st-changes_requested">Changes requested</span>}
        </div>
        <div className={`gate ${gate[0]}`}>{gate[1]}</div>
      </div>
      {(p.submit || p.decide || p.publish || p.withdraw) && (
        <div className="row" style={{ marginTop: 12 }}>
          {(p.decide || p.submit) && <input className="input grow" style={{ width: "auto", minWidth: 220 }} placeholder={p.decide ? "Decision note (required to request changes or to approve with open majors)" : "Note for the reviewer (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />}
          {p.submit && <>
            <select className="input" style={{ width: "auto" }} value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="Reviewer">
              <option value="">Default reviewer</option>{meta?.reviewers?.filter((r) => r.id !== s.author_id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button className="btn primary" disabled={!!busy} onClick={() => t("submit")}>Submit for review</button>
          </>}
          {p.withdraw && <button className="btn" disabled={!!busy} onClick={() => t("withdraw")}>Withdraw to draft</button>}
          {p.decide && <>
            <button className="btn" disabled={!!busy} onClick={() => t("request_changes")}>Request changes</button>
            <button className="btn accent" disabled={!!busy || openBlockers > 0} onClick={() => t("approve")}>Approve</button>
          </>}
          {p.publish && <button className="btn primary" disabled={!!busy} onClick={() => t("publish")}>Mark as published</button>}
        </div>
      )}
    </div>
  );
}

const REASONS = [["false_positive", "False positive: the rule misfired"], ["guideline_unclear", "Guideline is unclear here"], ["intentional_exception", "Intentional, approved exception"], ["not_applicable", "Doesn't apply to this channel/context"]];

function FindingCard({ f, page, sel, onSel, perms, me, meta, busy, act, subId, author }) {
  const [mode, setMode] = useState(null); // dismiss | override | edit | comment
  const [reason, setReason] = useState("false_positive");
  const [note, setNote] = useState("");
  const [rep, setRep] = useState(f.suggestion?.replacement ?? "");
  const [ai, setAi] = useState(null);
  const done = f.status !== "open";
  const canFix = !done && perms.edit && f.suggestion && ["replace", "append"].includes(f.suggestion.kind);
  const isRev = ["reviewer", "brand_admin"].includes(me.role);
  const apply = (replacement) => act("apply" + f.id, () => api(`/findings/${f.id}/apply`, { method: "POST", body: replacement != null ? { replacement } : {} }), "Fix applied as a new revision. Re-checked.");

  return (
    <div id={"f-" + f.id} className={`finding ${f.severity}${sel ? " sel" : ""}${done ? " done" : ""}`} onClick={onSel}>
      <div className="row spread">
        <div className="row"><SevChip s={f.severity} /><span className="chip outline">{f.category}</span><EngineChip f={f} />{page && <span className="chip page">{page}</span>}</div>
        {done && <span className={"chip " + (f.status === "dismissed" || f.status === "overridden" ? "sev-minor" : "ok")}>{f.status}</span>}
      </div>
      <div className="msg">{f.message}</div>
      {f.excerpt && f.start_pos != null && <div className="small mono" style={{ color: "var(--ink-2)" }}>“{f.excerpt.length > 140 ? f.excerpt.slice(0, 137) + "…" : f.excerpt}”</div>}
      <div className="why" style={{ marginTop: 4 }}><b>Why:</b> {f.why}</div>
      <div className="receipt">
        <b>{f.source?.type === "fact" ? "Approved fact" : f.source?.type === "asset" ? "Brand asset" : f.source?.type === "confidential" ? "Confidential register" : "Guideline"} {f.source?.id}</b>
        {f.source?.title && f.source.type === "rule" && <> · {f.source.title}{f.source.version ? ` (v${f.source.version})` : ""}</>}
        <div>“{f.source?.text}”</div>
        {f.source?.source && <div className="muted">Source: {f.source.source}{f.source.valid_until ? ` · valid until ${f.source.valid_until}` : ""}</div>}
      </div>
      {done && f.resolution_note && <div className="small muted" style={{ marginTop: 6 }}>Note: {f.resolution_note}</div>}

      {!done && (
        <div className="fix" onClick={(e) => e.stopPropagation()}>
          {f.suggestion && (
            <div className="small">
              {f.suggestion.kind === "replace" ? (
                <span className="diffline">💡 <del>{f.excerpt}</del> → <ins>{f.suggestion.replacement || "(remove)"}</ins></span>
              ) : f.suggestion.kind === "append" ? <span className="diffline">💡 Add: <ins>{f.suggestion.replacement}</ins></span> : <span>💡 {f.suggestion.text}</span>}
            </div>
          )}
          {ai && (
            <div className="receipt" style={{ borderColor: "#d6c8fb" }}>
              <span className="chip ai">AI rewrite</span> <span className="diffline"><ins>{ai.rewrite}</ins></span>
              <div className="muted">{ai.rationale}</div>
              <div style={{ marginTop: 4 }}>{ai.verification.length ? <span style={{ color: "var(--major)" }}>⚠ Rule re-check found: {ai.verification.join("; ")}</span> : <span style={{ color: "var(--ok)" }}>✓ Passes the rule engine re-check</span>}</div>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn sm accent" disabled={!!busy || !perms.edit} onClick={() => apply(ai.rewrite)}>Use this rewrite</button>
                <button className="btn sm" onClick={() => { setRep(ai.rewrite); setMode("edit"); }}>Edit first</button>
              </div>
            </div>
          )}
          {mode === "edit" && (
            <div className="row"><input className="input grow" style={{ width: "auto" }} value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Replacement text" />
              <button className="btn sm accent" disabled={!!busy} onClick={() => apply(rep)}>Apply edited fix</button><button className="btn sm" onClick={() => setMode(null)}>Cancel</button></div>
          )}
          {mode === "dismiss" && (
            <div className="stack">
              <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input className="input" placeholder={f.severity === "major" ? "Explain why (required for major issues)" : "Optional note"} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row"><button className="btn sm" disabled={!!busy} onClick={() => act("d" + f.id, () => api(`/findings/${f.id}/dismiss`, { method: "POST", body: { reason, note } }), "Dismissed. Your reason feeds the guideline-clarity insights.")}>Confirm dismiss</button><button className="btn sm ghost" onClick={() => setMode(null)}>Cancel</button></div>
            </div>
          )}
          {mode === "override" && (
            <div className="stack">
              <textarea className="input" rows={2} placeholder="Justification (kept in the audit trail)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row"><button className="btn sm danger" disabled={!!busy} onClick={() => act("o" + f.id, () => api(`/findings/${f.id}/override`, { method: "POST", body: { note } }), "Override recorded")}>Override blocker</button><button className="btn sm ghost" onClick={() => setMode(null)}>Cancel</button></div>
            </div>
          )}
          {!mode && (
            <div className="row">
              {canFix && <button className="btn sm accent" disabled={!!busy} onClick={() => apply()}>{busy === "apply" + f.id ? "Applying…" : "Apply fix"}</button>}
              {canFix && f.suggestion.kind === "replace" && <button className="btn sm" onClick={() => setMode("edit")}>Edit fix</button>}
              {perms.runAi && perms.edit && f.start_pos != null && <button className="btn sm ai" disabled={!!busy} onClick={async () => { const r = await act("rw" + f.id, () => api(`/findings/${f.id}/rewrite`, { method: "POST" })); if (r) setAi(r); }}>{busy === "rw" + f.id ? "Rewriting…" : "AI rewrite"}</button>}
              {f.severity !== "blocker" && <button className="btn sm ghost" onClick={() => setMode("dismiss")}>Dismiss…</button>}
              {f.severity === "blocker" && isRev && me.id !== author && <button className="btn sm ghost danger" onClick={() => setMode("override")}>Override…</button>}
              {f.severity === "blocker" && !isRev && <span className="small muted">Blockers can only be overridden by a reviewer.</span>}
            </div>
          )}
        </div>
      )}
      {done && (f.status !== "overridden" || isRev) && f.status !== "resolved" && f.status !== "accepted" && (
        <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={(e) => { e.stopPropagation(); act("r" + f.id, () => api(`/findings/${f.id}/reopen`, { method: "POST" }), "Reopened"); }}>Reopen</button>
      )}
    </div>
  );
}

function Claims({ claims, onSelect }) {
  if (!claims.length) return <div className="empty">No promotional claims or figures detected.</div>;
  return (
    <div className="findings">
      <p className="small muted" style={{ margin: 0 }}>Every claim and figure in this revision, checked against the approved facts library.</p>
      {claims.map((c) => {
        const [cls, label] = VERDICT[c.verdict] || ["outline", c.verdict];
        return (
          <div key={c.id} className="finding" style={{ cursor: "pointer", borderLeftColor: c.verdict === "supported" ? "var(--ok)" : undefined }} onClick={() => onSelect(c)}>
            <div className="row spread"><span className={`chip ${cls}`}>{label}</span><span className="small muted">{c.note}</span></div>
            <div style={{ margin: "6px 0" }}>“{c.text}”</div>
            {c.fact ? <div className="receipt"><b>{c.fact.id}</b>: {c.fact.statement}<div className="muted">{c.fact.source}{c.fact.valid_until ? ` · valid until ${c.fact.valid_until}` : ""}</div></div>
              : <div className="small muted">No matching approved fact.</div>}
          </div>
        );
      })}
    </div>
  );
}

function History({ d, id }) {
  const last = d.revisions.length;
  const [n, setN] = useState(last);
  const [pair, setPair] = useState(null);
  useEffect(() => {
    if (n <= 1) { setPair(null); return; }
    Promise.all([api(`/submissions/${id}/revisions/${n - 1}`), api(`/submissions/${id}/revisions/${n}`)]).then(([a, b]) => setPair([a.body, b.body])).catch(() => {});
  }, [n, id]);
  return (
    <div className="findings">
      <div className="row">{d.revisions.map((r) => <button key={r.number} className={"btn sm" + (r.number === n ? " primary" : "")} onClick={() => setN(r.number)}>r{r.number}</button>)}</div>
      {d.revisions.filter((r) => r.number === n).map((r) => <div key={r.number} className="small"><b>Revision {r.number}</b> by {r.author} · {timeAgo(r.created_at)} · {r.note}</div>)}
      {n > 1 && pair ? <WordDiff before={pair[0]} after={pair[1]} /> : <div className="small muted">Revision 1 is the original draft.</div>}
      <h3 style={{ marginTop: 10 }}>Audit trail</h3>
      <div className="small">
        {d.events.map((e) => (
          <div key={e.id} style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
            <b>{e.actor || "system"}</b> {e.type.replace(/_/g, " ")}{e.detail?.rule ? ` · ${e.detail.rule}` : ""}{e.detail?.reason ? ` (${e.detail.reason})` : ""}{e.detail?.note ? `: “${e.detail.note}”` : ""}
            <span className="muted"> · {timeAgo(e.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Discussion({ d, id, act, busy }) {
  const [body, setBody] = useState("");
  return (
    <div className="findings">
      {!d.comments.length && <div className="empty">No comments yet.</div>}
      {d.comments.map((c) => (
        <div key={c.id} className="finding" style={{ borderLeftColor: "var(--brand)" }}>
          <div className="small"><b>{c.author?.name}</b> <span className="muted">({roleLabel(c.author?.role)}) · {timeAgo(c.created_at)}</span></div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{c.body}</div>
        </div>
      ))}
      <textarea className="input" rows={3} placeholder="Add a comment for the author or reviewer" value={body} onChange={(e) => setBody(e.target.value)} />
      <div><button className="btn primary sm" disabled={!body.trim() || !!busy} onClick={() => act("c", () => api(`/submissions/${id}/comments`, { method: "POST", body: { body } }), "Comment posted").then(() => setBody(""))}>Post comment</button></div>
    </div>
  );
}
