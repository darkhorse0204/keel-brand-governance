import React, { useMemo } from "react";

export const SEV_ORDER = { blocker: 0, major: 1, minor: 2, info: 3 };
export const SEV_LABEL = { blocker: "Blocker", major: "Major", minor: "Minor", info: "Info" };
export const STATUS_LABEL = { draft: "Draft", in_review: "In review", changes_requested: "Changes requested", approved: "Approved", published: "Published" };
export const CHANNELS = [
  ["email", "Email"], ["blog", "Blog"], ["web", "Web page"], ["x", "X (Twitter)"], ["instagram", "Instagram"], ["linkedin", "LinkedIn"],
  ["sms", "SMS"], ["push", "Push notification"], ["press", "Press release"], ["ad", "Paid ad"], ["general", "Other"],
];
export const channelLabel = (c) => (CHANNELS.find((x) => x[0] === c) || [c, c])[1];

export const SevChip = ({ s }) => <span className={`chip sev-${s}`}>{SEV_LABEL[s] || s}</span>;
export const StatusChip = ({ s }) => <span className={`chip st-${s}`}>{STATUS_LABEL[s] || s}</span>;
export const EngineChip = ({ f }) => f.engine === "ai"
  ? <span className="chip ai" title="Raised by the AI reviewer. Grounded: it cites a rule and quotes your text exactly.">AI · {Math.round(f.confidence * 100)}% confidence</span>
  : <span className="chip rules" title="Raised by the deterministic rule engine. Same input, same result, every time.">Rule engine</span>;

export function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Page markers added by PDF / PowerPoint intake and OCR (see server/intake.js).
const MARKER_RE = /<!-- page: (.+?) -->/g;
/** [{label, start, end}] for each page/slide in the body; [] if the content has no pages. */
export function pageRanges(body) {
  const out = [];
  for (const m of (body || "").matchAll(new RegExp(MARKER_RE.source, "g"))) out.push({ label: m[1], start: m.index, end: body.length });
  for (let i = 0; i < out.length - 1; i++) out[i].end = out[i + 1].start;
  return out;
}
export const pageOf = (pages, pos) => (pos == null ? null : pages.find((p) => pos >= p.start && pos < p.end)?.label || null);

/** Plain text with page markers drawn as dividers. */
function withPages(s, key) {
  if (!s.includes("<!-- page: ")) return <React.Fragment key={key}>{s}</React.Fragment>;
  const parts = [];
  let last = 0, k = 0;
  for (const m of s.matchAll(new RegExp(MARKER_RE.source, "g"))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    parts.push(<span key={`p${k++}`} className="pagebreak" aria-label={m[1]}>{m[1]}</span>);
    last = m.index + m[0].length;
    if (s[last] === "\n") last++;
  }
  parts.push(s.slice(last));
  return <React.Fragment key={key}>{parts}</React.Fragment>;
}

/** Render text with findings highlighted in place; overlapping spans show the most severe. */
export function Highlighter({ text, findings, selected, onSelect, mono }) {
  const segs = useMemo(() => {
    const spans = findings.filter((f) => f.start_pos != null && f.end_pos > f.start_pos && f.status === "open");
    const cuts = new Set([0, text.length]);
    spans.forEach((f) => { cuts.add(Math.max(0, f.start_pos)); cuts.add(Math.min(text.length, f.end_pos)); });
    const pts = [...cuts].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const cover = spans.filter((f) => f.start_pos <= a && f.end_pos >= b).sort((x, y) => SEV_ORDER[x.severity] - SEV_ORDER[y.severity]);
      out.push({ a, b, cover });
    }
    return out;
  }, [text, findings]);
  return (
    <div className={"doc" + (mono ? " mono" : "")}>
      {segs.map(({ a, b, cover }) => cover.length ? (
        <mark key={a} className={`hl ${cover[0].severity}${cover.some((f) => f.id === selected) ? " sel" : ""}`}
          title={cover.map((f) => `${SEV_LABEL[f.severity]}: ${f.message}`).join("\n")}
          onClick={() => onSelect(cover.find((f) => f.id === selected) ? cover[(cover.findIndex((f) => f.id === selected) + 1) % cover.length].id : cover[0].id)}>
          {text.slice(a, b)}
        </mark>
      ) : withPages(text.slice(a, b), a))}
      {!text && <span className="muted">(no text — image-only submission)</span>}
    </div>
  );
}

/** Word-level diff (LCS) between two strings. */
export function WordDiff({ before, after }) {
  const parts = useMemo(() => {
    const A = before.split(/(\s+)/), B = after.split(/(\s+)/);
    if (A.length * B.length > 4e6) return [{ t: "=", s: after }];
    const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    const push = (t, s) => { if (out.length && out[out.length - 1].t === t) out[out.length - 1].s += s; else out.push({ t, s }); };
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { push("=", A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) push("-", A[i++]);
      else push("+", B[j++]);
    }
    while (i < A.length) push("-", A[i++]);
    while (j < B.length) push("+", B[j++]);
    return out;
  }, [before, after]);
  return (
    <div className="doc diffline" style={{ maxHeight: 420 }}>
      {parts.map((p, k) => p.t === "=" ? <span key={k}>{p.s}</span> : p.t === "-" ? <del key={k}>{p.s}</del> : <ins key={k}>{p.s}</ins>)}
    </div>
  );
}

/** Downscale an image and extract its dominant colours in the browser (nothing is uploaded for this). */
export async function processImage(file) {
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const max = 1200, scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
  const out = file.type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.85);
  // palette: quantise to 4 bits/channel and count
  const s = document.createElement("canvas"); s.width = 64; s.height = Math.max(1, Math.round(64 * c.height / c.width));
  s.getContext("2d").drawImage(c, 0, 0, s.width, s.height);
  const px = s.getContext("2d").getImageData(0, 0, s.width, s.height).data;
  const buckets = {}; let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const k = [px[i] >> 4, px[i + 1] >> 4, px[i + 2] >> 4].join(",");
    (buckets[k] ||= { n: 0, r: 0, g: 0, b: 0 }); const bk = buckets[k];
    bk.n++; bk.r += px[i]; bk.g += px[i + 1]; bk.b += px[i + 2]; total++;
  }
  const hex = (v) => Math.round(v).toString(16).padStart(2, "0");
  const palette = Object.values(buckets).sort((a, b) => b.n - a.n).slice(0, 6)
    .map((bk) => ({ hex: "#" + hex(bk.r / bk.n) + hex(bk.g / bk.n) + hex(bk.b / bk.n), share: Math.round((bk.n / total) * 100) / 100 }));
  return { name: file.name, dataUrl: out, width: c.width, height: c.height, palette, alt: "", kind: "graphic", decorative: false };
}

export function ImageList({ images, onChange, readOnly, onAiReview, aiBusy, onOcr, ocrBusy }) {
  const upd = (i, patch) => onChange(images.map((im, k) => (k === i ? { ...im, ...patch } : im)));
  return (
    <div className="stack">
      {images.map((im, i) => (
        <div key={i} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <img className="thumb" src={im.dataUrl} alt={im.alt || ""} />
          <div className="grow stack" style={{ minWidth: 220 }}>
            <div className="row spread"><b className="small">{im.name}</b>
              <span className="row" style={{ gap: 3 }}>{(im.palette || []).slice(0, 5).map((p) => <span key={p.hex} className="swatch" style={{ background: p.hex }} title={`${p.hex} · ${Math.round(p.share * 100)}%`} />)}</span>
            </div>
            {readOnly ? (
              <div className="small">{im.decorative ? <i>Decorative image</i> : im.alt ? <>Alt text: “{im.alt}”</> : <span style={{ color: "var(--blocker)" }}>No alt text</span>} · {im.kind === "photo" ? "Photo" : "Graphic"}</div>
            ) : (
              <>
                <input className="input" placeholder="Alt text: describe what the image shows and why" value={im.alt} onChange={(e) => upd(i, { alt: e.target.value })} aria-label={`Alt text for ${im.name}`} />
                <div className="row small">
                  <label className="row"><input type="checkbox" checked={im.decorative} onChange={(e) => upd(i, { decorative: e.target.checked })} /> Decorative</label>
                  <select className="input" style={{ width: "auto", padding: "3px 6px" }} value={im.kind} onChange={(e) => upd(i, { kind: e.target.value })} aria-label="Image type">
                    <option value="graphic">Graphic / illustration (palette checked)</option><option value="photo">Photograph</option>
                  </select>
                  <button className="btn sm ghost danger" onClick={() => onChange(images.filter((_, k) => k !== i))}>Remove</button>
                </div>
              </>
            )}
            {(onAiReview || onOcr) && <div className="row">
              {onOcr && <button className="btn sm" disabled={ocrBusy} title="Reads the text inside the image on this server (nothing is sent outside) and adds it to the content, so the same rules check it." onClick={() => onOcr(i)}>{ocrBusy ? "Reading text…" : "Read text in image (OCR)"}</button>}
              {onAiReview && <button className="btn sm ai" disabled={aiBusy} onClick={() => onAiReview(i)}>{aiBusy ? "Reviewing…" : "AI visual review"}</button>}
            </div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Bars({ data, valueKey, labelKey, format = (v) => v, tip }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  return (
    <div className="bars" role="img" aria-label={data.map((d) => `${d[labelKey]}: ${format(d[valueKey])}`).join(", ")}>
      {data.map((d) => (
        <div className="col" key={d[labelKey]} title={tip ? tip(d) : `${d[labelKey]}: ${format(d[valueKey])}`}>
          <span className="val">{format(d[valueKey])}</span>
          <div className="b" style={{ height: `${(d[valueKey] / max) * 100}%` }} />
          <span className="lab">{d[labelKey]}</span>
        </div>
      ))}
    </div>
  );
}

export function HBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div className="hbar" key={r.label} title={r.tip || `${r.label}: ${r.value}`}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="small" style={{ textAlign: "right" }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
