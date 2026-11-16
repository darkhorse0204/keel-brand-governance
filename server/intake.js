// Document intake beyond plain text: PDF, PowerPoint (.pptx) and text inside images (OCR).
//
// Every document becomes ordinary text with page markers like  <!-- page: Slide 3 -->
// The rule engine masks those markers (same-length blanking), so they are never checked as
// prose, but the UI uses them to group findings by page/slide. Because the markers live in the
// text itself, they stay correct when someone edits the document.
//
// OCR runs locally with tesseract.js and the bundled English model, so images are not sent
// to any outside service for text extraction.
import { createRequire } from "node:module";
import JSZip from "jszip";

const require = createRequire(import.meta.url);
export const PAGE_MARKER_RE = /^<!-- page: (.+?) -->$/gm;
export const marker = (label) => `<!-- page: ${label} -->`;

/** Split a body into pages using its markers. Returns [{label, start, end}]. */
export function pageRanges(body) {
  const out = [];
  const re = new RegExp(PAGE_MARKER_RE.source, "gm");
  let m;
  while ((m = re.exec(body))) out.push({ label: m[1], start: m.index, end: body.length });
  for (let i = 0; i < out.length - 1; i++) out[i].end = out[i + 1].start;
  return out;
}

const tidy = (s) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

// ---------------------------------------------------------------- PDF
export async function parsePdf(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const parts = [], empty = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let text = "";
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      text += it.str + (it.hasEOL ? "\n" : "");
    }
    // rejoin lines the PDF layout wrapped mid-sentence, so sentence-level checks see whole sentences
    text = tidy(text).replace(/(\w)-\n(\w)/g, "$1-$2").replace(/([^\n.!?:])\n(?=[a-z0-9(])/g, "$1 ");
    if (!text) empty.push(p);
    parts.push(`${marker(`Page ${p}`)}\n${text || "(no text layer on this page)"}`);
  }
  await task.destroy();
  return {
    format: "text", body: parts.join("\n\n"), pages: doc.numPages,
    note: `Read ${doc.numPages} page(s) from PDF` + (empty.length ? `. Page(s) ${empty.join(", ")} have no text layer (scanned?). Export those pages as images and use "Read text (OCR)".` : ""),
  };
}

// ---------------------------------------------------------------- PowerPoint
const xmlText = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
function slideParagraphs(xml) {
  const paras = [];
  for (const p of xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) || []) {
    const runs = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => xmlText(m[1]));
    const line = runs.join("").trim();
    if (line) paras.push(line);
  }
  return paras;
}
export async function parsePptx(buf, { ocr = false, maxImages = 8 } = {}) {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => +a.match(/(\d+)\.xml$/)[1] - +b.match(/(\d+)\.xml$/)[1]);
  if (!slideFiles.length) throw new Error("No slides found in this .pptx file");
  const parts = [];
  let ocrCount = 0;
  for (const [i, f] of slideFiles.entries()) {
    const n = i + 1;
    const xml = await zip.file(f).async("string");
    let text = slideParagraphs(xml).join("\n");
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${f.match(/(\d+)\.xml$/)[1]}.xml`);
    if (ocr && ocrCount < maxImages) {
      const rels = zip.file(f.replace("slides/", "slides/_rels/") + ".rels");
      const media = rels ? [...(await rels.async("string")).matchAll(/Target="\.\.\/media\/([^"]+\.(?:png|jpe?g))"/gi)].map((m) => m[1]) : [];
      for (const name of media) {
        if (ocrCount >= maxImages) break;
        const img = await zip.file(`ppt/media/${name}`)?.async("nodebuffer");
        if (!img) continue;
        ocrCount++;
        const r = await ocrImage(img);
        if (r.text) text += `\n[Text in image ${name}]\n${r.text}`;
      }
    }
    parts.push(`${marker(`Slide ${n}`)}\n${tidy(text) || "(no text on this slide)"}`);
    void notesFile; // speaker notes are internal; we deliberately don't check them as published copy
  }
  return { format: "text", body: parts.join("\n\n"), pages: slideFiles.length,
    note: `Read ${slideFiles.length} slide(s) from PowerPoint${ocr ? `; read text inside ${ocrCount} image(s) with OCR` : ""}` };
}

// ---------------------------------------------------------------- OCR
let workerP = null;
async function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import("tesseract.js");
      const eng = require("@tesseract.js-data/eng");
      return createWorker("eng", 1, { langPath: eng.langPath, gzip: eng.gzip, cacheMethod: "none", logger: () => {} });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}
// serialise jobs on the single worker
let queue = Promise.resolve();
export function ocrImage(buf) {
  const job = queue.then(async () => {
    const w = await getWorker();
    const { data } = await w.recognize(buf);
    const text = tidy((data.text || "").replace(/[|]/g, "I"));
    return { text, confidence: Math.round(data.confidence || 0) };
  });
  queue = job.catch(() => {});
  return job;
}
export async function stopOcr() { if (workerP) { const w = await workerP; await w.terminate(); workerP = null; } }

export function dataUrlToBuffer(dataUrl) {
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Unsupported image");
  return Buffer.from(m[2], "base64");
}
