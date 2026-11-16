import React, { useEffect, useState, createContext, useContext, useCallback } from "react";
import { api, setToken, hasToken } from "./api.js";
import Queue from "./pages/Queue.jsx";
import NewSubmission from "./pages/NewSubmission.jsx";
import Submission from "./pages/Submission.jsx";
import BrandKit from "./pages/BrandKit.jsx";
import Insights from "./pages/Insights.jsx";
import Transparency from "./pages/Transparency.jsx";

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const ROLE_LABEL = { creator: "Creator", agency: "Agency partner", reviewer: "Reviewer", brand_admin: "Brand admin" };
export const roleLabel = (r) => ROLE_LABEL[r] || r;

function useHash() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => { const f = () => setHash(location.hash || "#/"); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return hash.slice(1);
}
export const go = (p) => { location.hash = p; };

export default function App() {
  const [me, setMe] = useState(null);
  const [meta, setMeta] = useState(null);
  const [toast, setToast] = useState(null);
  const [ready, setReady] = useState(false);
  const route = useHash();

  const notify = useCallback((msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), err ? 6000 : 3000); }, []);
  const refreshMeta = useCallback(() => api("/meta").then(setMeta).catch(() => {}), []);

  useEffect(() => {
    const out = () => { setMe(null); };
    addEventListener("keel:logout", out);
    if (hasToken()) Promise.all([api("/me"), api("/meta")]).then(([u, m]) => { setMe(u); setMeta(m); }).catch(() => {}).finally(() => setReady(true));
    else setReady(true);
    return () => removeEventListener("keel:logout", out);
  }, []);

  if (!ready) return null;
  if (!me) return <Login onIn={(u) => { setMe(u); refreshMeta(); go("/"); }} />;

  const [, page, id] = route.split("/");
  let view;
  if (!page) view = <Queue />;
  else if (page === "new") view = <NewSubmission />;
  else if (page === "s" && id) view = <Submission id={id} key={id} />;
  else if (page === "brand") view = <BrandKit />;
  else if (page === "insights") view = <Insights />;
  else if (page === "ai") view = <Transparency />;
  else view = <div className="empty">Page not found</div>;

  const navs = [
    ["/", "Content queue", ""],
    ["/new", "New submission", "new"],
    ["/brand", "Brand kit", "brand"],
    ...(me.role !== "agency" ? [["/insights", "Insights", "insights"]] : []),
    ["/ai", "AI & privacy", "ai"],
  ];

  return (
    <Ctx.Provider value={{ me, meta, notify, refreshMeta }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="logo"><Mark /> <div>Keel<small>Brand governance</small></div></div>
          <nav className="nav" aria-label="Main">
            {navs.map(([href, label, key]) => (
              <a key={href} href={"#" + href} className={(page || "") === key ? "active" : ""}>{label}</a>
            ))}
          </nav>
          <div className="me">
            <b>{me.name}</b>{roleLabel(me.role)} · {me.team}
            <div className="small" style={{ color: "#9fb6cc", marginTop: 4 }}>Workspace: {meta?.brandName} (demo)</div>
            <button onClick={() => { setToken(null); setMe(null); }}>Switch user</button>
          </div>
        </aside>
        <main>{view}</main>
      </div>
      {toast && <div className={"toast" + (toast.err ? " err" : "")} role="status">{toast.msg}</div>}
    </Ctx.Provider>
  );
}

function Mark() {
  return <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0f2a45" /><path d="M8 10h16l-8 13z" fill="#7fd1c7" /></svg>;
}

function Login({ onIn }) {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => { api("/users").then(setUsers).catch((e) => setErr(e.message)); }, []);
  const DESC = {
    creator: "Writes campaign content. Sees own work, gets explained findings and fixes.",
    agency: "External partner. Can't see confidential facts or the confidential register.",
    reviewer: "Approves or requests changes. Can override blockers with a written justification.",
    brand_admin: "Owns the brand kit, rules and facts. Sees governance insights.",
  };
  return (
    <div className="login">
      <div className="panel">
        <div className="row" style={{ marginBottom: 6 }}><Mark /><h1>Keel</h1></div>
        <p className="muted" style={{ marginTop: 0 }}>Catch off-brand content before it ships. Every finding shows the rule or approved fact behind it, and a person makes the final call.</p>
        <div className="banner" style={{ margin: "12px 0 12px" }}>Demo workspace for <b>Fernway</b>, a made-up savings app. No sign-up needed: pick a person below to sign in as them.</div>
        <div className="card pad small" style={{ boxShadow: "none", marginBottom: 14 }}>
          <b>Try Keel in 3 minutes</b>
          <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li><b>Aditi (writer):</b> open <i>Diwali savings push</i>. Each problem is underlined and shows the rule it breaks and a fix. Click <i>Apply fix</i> on a few, then <i>Submit for review</i>.</li>
            <li><b>Priya (reviewer):</b> open <i>Diwali referral SMS</i>. <i>Approve</i> stays locked while a blocker is open: override it with a written reason, or request changes.</li>
            <li><b>Sam (brand admin):</b> open <i>Insights</i> to clarify an unclear guideline and see measured accuracy, or <i>Brand kit</i> to edit the rules and approved facts.</li>
            <li><b>Your own content:</b> as anyone, click <i>New submission</i> and paste text, or upload a PDF, PowerPoint, Word file or image.</li>
          </ol>
          <div className="muted" style={{ marginTop: 6 }}>Everyone shares this demo. <button className="btn sm ghost" style={{ padding: "0 4px" }} onClick={async () => {
            if (!window.confirm("Put the demo back to its starting state? This removes everyone's changes.")) return;
            try { await api("/demo/reset", { method: "POST" }); setErr(null); alert("Demo data reset."); location.reload(); } catch (e) { setErr(e.message); }
          }}>Reset demo data</button></div>
        </div>
        {err && <p className="gate bad">{err}</p>}
        <div className="grid2">
          {users.map((u) => (
            <button key={u.id} className="persona" onClick={() => api("/login", { method: "POST", body: { user_id: u.id } }).then((r) => { setToken(r.token); onIn(r.user); }).catch((e) => setErr(e.message))}>
              <div className="row spread"><b>{u.name}</b><span className="chip outline">{roleLabel(u.role)}</span></div>
              <div className="small muted">{u.title} · {u.team}</div>
              <div className="small" style={{ marginTop: 6 }}>{DESC[u.role]}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
