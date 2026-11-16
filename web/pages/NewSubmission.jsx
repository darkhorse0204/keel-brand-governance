import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp, go } from "../App.jsx";
import { CHANNELS, ImageList, processImage, SevChip } from "../components/ui.jsx";

const SAMPLE = `Introducing savings goals: the BEST way to grow your money!

Over 100,000 users already trust Fernway. Set a goal, switch on round-ups and watch your savings skyrocket at 7.5% p.a.

[Learn more](https://fernway.example/goals)`;

export default function NewSubmission() {
  const { meta, notify } = useApp();
  const [f, setF] = useState({ title: "", channel: "email", format: "text", body: "", intent: { goal: "", audience: "", cta: "" } });
  const [images, setImages] = useState([]);
  const [pre, setPre] = useState(null);
  const [busy, setBusy] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [deckOcr, setDeckOcr] = useState(false);
  const [loading, setLoading] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const timer = useRef();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setIntent = (k, v) => setF((x) => ({ ...x, intent: { ...x.intent, [k]: v } }));

  // live pre-flight check (rules only, nothing stored)
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!f.body.trim() && !images.length) return setPre(null);
      api("/preflight", { method: "POST", body: { body: f.body, format: f.format, channel: f.channel, images } }).then(setPre).catch(() => {});
    }, 400);
    return () => clearTimeout(timer.current);
  }, [f.body, f.format, f.channel, images]);

  async function onFile(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (file.type.startsWith("image/")) return addImages([file]);
    if (file.size > 10e6) return notify(`${file.name} is over 10 MB`, true);
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
    setLoading(file.name);
    try {
      const r = await api("/parse-file", { method: "POST", body: { filename: file.name, data, ocr: deckOcr } });
      setF((x) => ({ ...x, body: r.body, format: r.format, title: x.title || file.name.replace(/\.\w+$/, "") }));
      notify(r.note || `Loaded ${file.name}`);
    } catch (err) { notify(err.message, true); }
    finally { setLoading(null); }
  }
  // read the text inside an image (on our server, nothing is sent outside) and add it to the content
  async function ocr(i) {
    setOcrBusy(true);
    try {
      const im = images[i];
      const r = await api("/ocr", { method: "POST", body: { dataUrl: im.dataUrl } });
      if (!r.text || r.text.replace(/\W/g, "").length < 3) return notify("No readable text found in this image", true);
      const marker = `<!-- page: Text in image ${im.name || i + 1} -->`;
      if (f.body.includes(marker)) return notify("Text from this image is already in the content");
      setF((x) => ({ ...x, body: `${x.body.replace(/\s*$/, "")}${x.body.trim() ? "\n\n" : ""}${marker}\n${r.text}` }));
      notify(`Added the image's text (${r.confidence}% confidence). Check it reads correctly.`);
    } catch (e) { notify(e.message, true); }
    finally { setOcrBusy(false); }
  }
  async function addImages(files) {
    try {
      const out = [];
      for (const file of files) { if (file.size > 8e6) { notify(`${file.name} is over 8 MB`, true); continue; } out.push(await processImage(file)); }
      setImages((im) => [...im, ...out]);
    } catch { notify("Couldn't read that image", true); }
  }
  async function submit() {
    setBusy(true);
    try {
      const r = await api("/submissions", { method: "POST", body: { ...f, images, ai: useAi } });
      go("/s/" + r.id);
    } catch (e) { notify(e.message, true); setBusy(false); }
  }

  const counts = pre?.stats?.counts || {};
  return (
    <>
      <div className="page-head">
        <div><h1>New submission</h1><p>Paste or upload your draft. Keel checks it as you type. Nothing is stored until you save, and nothing goes to an AI service unless you tick the box.</p></div>
      </div>
      <div className="workspace">
        <div className="card pad stack">
          <label className="field"><span>Title</span><input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Diwali savings email" /></label>
          <div className="grid2">
            <label className="field"><span>Channel</span><select className="input" value={f.channel} onChange={(e) => set("channel", e.target.value)}>{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="field"><span>Format</span><select className="input" value={f.format} onChange={(e) => set("format", e.target.value)}><option value="text">Plain text</option><option value="markdown">Markdown</option><option value="html">HTML</option></select></label>
          </div>
          <fieldset className="card pad" style={{ boxShadow: "none", background: "var(--surface-2)" }}>
            <legend className="small" style={{ fontWeight: 600, padding: "0 4px" }}>Intent: what this piece must achieve (fixes are written to keep it)</legend>
            <div className="grid3">
              <label className="field"><span>Goal</span><input className="input" value={f.intent.goal} onChange={(e) => setIntent("goal", e.target.value)} placeholder="Get members to…" /></label>
              <label className="field"><span>Audience</span><input className="input" value={f.intent.audience} onChange={(e) => setIntent("audience", e.target.value)} placeholder="Who is it for?" /></label>
              <label className="field"><span>Call to action</span><input className="input" value={f.intent.cta} onChange={(e) => setIntent("cta", e.target.value)} placeholder="Create a goal" /></label>
            </div>
          </fieldset>
          <label className="field">
            <span className="row spread">Content
              <span className="row">
                <button type="button" className="btn sm ghost" onClick={() => setF((x) => ({ ...x, body: SAMPLE, format: "markdown", title: x.title || "Savings goals launch" }))}>Insert sample draft</button>
                <label className="btn sm">{loading ? `Reading ${loading}…` : "Upload file"}<input type="file" hidden disabled={!!loading} accept=".pdf,.pptx,.docx,.txt,.md,.markdown,.html,.htm,image/*" onChange={onFile} /></label>
              </span>
            </span>
            <textarea className="input mono" rows={14} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder="Paste your draft here, or upload a PDF, PowerPoint (.pptx), Word (.docx), Markdown, HTML or text file" />
          </label>
          <label className="row small muted"><input type="checkbox" checked={deckOcr} onChange={(e) => setDeckOcr(e.target.checked)} /> For PowerPoint files, also read the text inside slide images (OCR on our server; slower)</label>
          <div>
            <div className="row spread" style={{ marginBottom: 6 }}><b className="small">Images</b>
              <label className="btn sm">Add images<input type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(e) => { addImages([...e.target.files]); e.target.value = ""; }} /></label>
            </div>
            {images.length ? <ImageList images={images} onChange={setImages} onOcr={ocr} ocrBusy={ocrBusy} /> : <div className="dropzone small">PNG/JPG/WebP. Keel checks alt text and, for graphics, whether the colours match the brand palette (worked out in your browser). Use “Read text in image” to check the words on a banner or poster too.</div>}
          </div>
          <div className="row spread">
            <label className="row small" title={meta?.aiConfigured ? "" : "No AI key configured on the server"}>
              <input type="checkbox" disabled={!meta?.aiEnabled} checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
              Also run AI review (tone, messaging, implied claims){!meta?.aiEnabled && " (not configured)"}
            </label>
            <button className="btn primary" disabled={busy || !f.title.trim()} onClick={submit}>{busy ? "Checking…" : "Save draft & run full check"}</button>
          </div>
          {useAi && <p className="small muted" style={{ margin: 0 }}>The text is sent to {meta?.provider} ({meta?.model}) after confidential terms, emails and phone numbers are swapped for placeholders. Every call is recorded on the AI &amp; privacy page.</p>}
        </div>

        <div className="card">
          <div className="card-head"><h3>Live check</h3>{pre && <span className="score">{pre.stats.score}<small>/100 brand fit</small></span>}</div>
          {!pre ? <div className="empty">Start typing to see issues appear.</div> : (
            <div className="findings">
              <div className="row">{["blocker", "major", "minor", "info"].map((s) => counts[s] ? <span key={s} className={`chip sev-${s}`}>{counts[s]} {s}</span> : null)}
                <span className="muted small">Reading grade {pre.stats.grade} · {pre.stats.words} words · {pre.stats.characters} chars</span></div>
              {!pre.findings.length && <div className="gate good">No rule-engine issues found. 🎉</div>}
              {pre.findings.map((x, i) => (
                <div key={i} className={`finding ${x.severity}`}>
                  <div className="row"><SevChip s={x.severity} /><span className="chip outline">{x.rule_id}</span></div>
                  <div className="msg">{x.message}</div>
                  {x.suggestion?.text && <div className="small muted">💡 {x.suggestion.text}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
