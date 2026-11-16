import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { timeAgo } from "../components/ui.jsx";

export default function Transparency() {
  const { me, meta, notify, refreshMeta } = useApp();
  const [log, setLog] = useState([]);
  useEffect(() => { api("/ai-log").then(setLog).catch((e) => notify(e.message, true)); }, []);
  const toggle = async () => { await api("/settings", { method: "PUT", body: { ai_enabled: !meta.aiEnabled } }); await refreshMeta(); notify("AI setting updated"); };
  return (
    <>
      <div className="page-head"><div><h1>AI &amp; privacy</h1><p>What Keel automates, what it sends where, and what stays with people.</p></div></div>
      <div className="grid2" style={{ marginBottom: 16 }}>
        <div className="card pad stack">
          <h2>AI status</h2>
          <div className="row"><span className={"chip " + (meta?.aiEnabled ? "ai" : "rules")}>{meta?.aiEnabled ? `AI on · ${meta.model}` : meta?.aiConfigured ? "AI switched off by admin" : "AI not configured (rules-only mode)"}</span>
            {me.role === "brand_admin" && meta?.aiConfigured && <button className="btn sm" onClick={toggle}>{meta.aiEnabled ? "Turn AI off for this workspace" : "Turn AI on"}</button>}</div>
          <p className="small" style={{ margin: 0 }}>The <b>rule engine</b> runs on this server and needs no external service. It checks terminology, banned phrases, figures against approved facts, confidential terms, accessibility and palette. Same input, same result, every time.</p>
          <p className="small" style={{ margin: 0 }}>The <b>AI reviewer</b> ({meta?.provider || "Google Gemini"}, external API) is optional and only runs when someone clicks an AI button. It adds judgement checks (tone, messaging, implied claims, imagery), rewrites, and style-guide import.</p>
          <p className="small" style={{ margin: 0 }}><b>Reading documents and images</b> stays on this server: PDF and PowerPoint text is extracted here, and text inside images is read with an on-server OCR model (Tesseract). None of that is sent to an outside service. Only “AI visual review” sends an image to the AI provider, and only when someone clicks it.</p>
        </div>
        <div className="card pad stack">
          <h2>Safeguards</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>Redaction before sending:</b> confidential-register terms, emails and phone numbers are swapped for placeholders. Confidential facts and assets are never included.</li>
            <li><b>Grounding:</b> an AI finding is kept only if it cites a real guideline ID and quotes your text exactly. Anything else is discarded and counted below.</li>
            <li><b>Self-check:</b> AI rewrites are re-run through the rule engine before you see them.</li>
            <li><b>Labelled:</b> every AI finding carries an “AI” badge and a confidence score.</li>
            <li><b>Human decision:</b> nothing is applied automatically. Blockers need a reviewer's written override, and authors can't approve their own work.</li>
            <li><b>Audit trail:</b> every edit, dismissal, override and approval is logged with who, when and why.</li>
          </ul>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>AI usage log</h3><span className="small muted">Last 100 calls. Logs metadata only; content is never stored here.</span></div>
        {!log.length ? <div className="empty">No AI calls yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table className="t">
              <thead><tr><th>When</th><th>Purpose</th><th>Model</th><th>Characters sent</th><th>Redactions</th><th>Kept / discarded</th><th>Outcome</th></tr></thead>
              <tbody>{log.map((l) => <tr key={l.id}><td>{timeAgo(l.created_at)}</td><td>{l.purpose.replace("_", " ")}</td><td className="mono small">{l.model}</td><td>{l.chars_sent.toLocaleString()}</td><td>{l.redactions}</td><td>{l.kept} / {l.discarded}</td><td>{l.outcome}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
