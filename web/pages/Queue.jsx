import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp, go } from "../App.jsx";
import { StatusChip, timeAgo, channelLabel } from "../components/ui.jsx";

// A short "what to try" list for each role, so a first-time visitor needs no walkthrough.
const TRY = {
  creator: ["Open “Diwali savings push”. Click an underlined phrase to see the rule it breaks and the suggested fix.",
    "Click “Apply fix” on the outdated rate (7.5%). Keel then asks for the rate's required disclaimer.",
    "Click “Submit for review” when you're done. Or start a “New submission” and upload a PDF, PowerPoint or image."],
  agency: ["Open “App rating social post”. Mentioning the unannounced Fernway Card is a blocker.",
    "Open “Brand kit”: confidential facts and the confidential register are hidden from agency accounts."],
  reviewer: ["Open “Diwali referral SMS”: “Approve” is locked while a blocker is open.",
    "Override the blocker with a written reason (it is kept in the audit trail), or “Request changes”.",
    "Approving with major issues still open needs a note acknowledging them."],
  brand_admin: ["Open “Insights”: TERM-02 is often dismissed. Click “Clarify this guideline” and see the before/after card.",
    "“Measured accuracy” shows how often the rule engine is right on a labelled test set.",
    "Open “Brand kit” to edit a rule or an approved fact. The next check uses it straight away."],
};
function TryThis({ role }) {
  const key = "keel.try.hidden." + role;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  if (hidden || !TRY[role]) return null;
  return (
    <div className="callout teal small" style={{ marginBottom: 12 }}>
      <div className="row spread"><b>Try this</b><button className="btn sm ghost" onClick={() => { setHidden(true); try { localStorage.setItem(key, "1"); } catch {} }}>Hide</button></div>
      <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>{TRY[role].map((t) => <li key={t}>{t}</li>)}</ol>
    </div>
  );
}

export default function Queue() {
  const { me, notify } = useApp();
  const reviewer = ["reviewer", "brand_admin"].includes(me.role);
  const [scope, setScope] = useState(reviewer ? "review" : "mine");
  const [history, setHistory] = useState(false);
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    api(`/submissions?scope=${scope}${history ? "" : "&live=1"}`).then(setRows).catch((e) => notify(e.message, true));
  }, [scope, history]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{reviewer ? "Review queue" : "My content"}</h1>
          <p>Each draft is checked against the brand kit as soon as it's created. Open one to see the issues found, the guideline behind each, and suggested fixes.</p>
        </div>
        <button className="btn primary" onClick={() => go("/new")}>+ New submission</button>
      </div>
      <TryThis role={me.role} />
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="seg" role="tablist">
          {reviewer && <button className={scope === "review" ? "on" : ""} onClick={() => setScope("review")}>Needs my review</button>}
          <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>Created by me</button>
          {reviewer && <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>All content</button>}
        </div>
        <label className="row small muted"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Include seeded demo history</label>
      </div>
      <div className="card">
        {!rows ? <div className="empty">Loading…</div> : !rows.length ? (
          <div className="empty">{scope === "review" ? "Nothing is waiting for your review." : "No content yet. Create a submission to run your first brand check."}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="t">
              <thead><tr><th>Title</th><th>Channel</th><th>Author</th><th>Status</th><th>Open issues</th><th>Updated</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="click" onClick={() => go("/s/" + s.id)}>
                    <td><a href={"#/s/" + s.id} onClick={(e) => e.stopPropagation()}><b>{s.title}</b></a>{s.seeded ? <span className="chip outline" style={{ marginLeft: 6 }}>demo history</span> : null}</td>
                    <td>{channelLabel(s.channel)}</td>
                    <td>{s.author_name}</td>
                    <td><StatusChip s={s.status} /></td>
                    <td>{s.open_blockers ? <span className="chip sev-blocker">{s.open_blockers} blocker{s.open_blockers > 1 ? "s" : ""}</span> : null} <span className="muted">{s.open_findings} open</span></td>
                    <td className="muted">{timeAgo(s.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
