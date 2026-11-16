// Text utilities shared by the review engine. All positions refer to the ORIGINAL body,
// so findings can be highlighted and fixed in place regardless of format.

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-boundary aware, case-insensitive phrase regex. */
export function phraseRe(phrase, flags = "gi") {
  const body = escapeRe(phrase.trim()).replace(/\s+/g, "\\s+");
  const pre = /^[\w]/.test(phrase.trim()) ? "(?<![\\w-])" : "";
  const post = /[\w]$/.test(phrase.trim()) ? "(?![\\w-])" : "";
  return new RegExp(pre + body + post, flags);
}

export function findAll(text, re) {
  const out = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = r.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length, match: m[0], groups: m });
    if (m[0].length === 0) r.lastIndex++;
  }
  return out;
}

/**
 * Replace markup with spaces of identical length so prose checks never match inside
 * tags/URLs, while every index still maps 1:1 onto the original body.
 */
export function maskMarkup(body, format) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  // page markers from PDF / PowerPoint intake (see server/intake.js) are never prose
  let t = body.replace(/^<!-- page: .+? -->$/gm, blank);
  if (format === "html") {
    t = t.replace(/<!--[\s\S]*?-->/g, blank);
    t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, blank);
    t = t.replace(/<[^>]+>/g, blank);
    t = t.replace(/&[a-z#0-9]+;/gi, blank);
  } else if (format === "markdown") {
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, blank); // images entirely
    t = t.replace(/\]\([^)]*\)/g, (m) => "]" + blank(m.slice(1))); // link targets
    t = t.replace(/`{3}[\s\S]*?`{3}/g, blank);
    t = t.replace(/^#{1,6}\s/gm, blank);
    t = t.replace(/[*_]{1,3}(?=\S)|(?<=\S)[*_]{1,3}/g, blank);
    t = t.replace(/[[\]]/g, " ");
  }
  return t;
}

export function plainText(body, format) {
  return maskMarkup(body, format).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

/** Sentences with positions (on masked text). */
const ABBREV = /(?<![\w])(?:p\.a|e\.g|i\.e|etc|approx|vs|incl|T&Cs)\./gi;
export function sentences(input) {
  // hide periods inside common abbreviations (same length, so positions are unchanged)
  const masked = input.replace(ABBREV, (m) => m.replace(/\./g, "․"));
  const out = [];
  // internal periods (7.5, p.a., e.g.) don't end a sentence; terminal punctuation followed by space does
  const re = /(?:[^.!?\n]|[.!?](?![\s]|$))+(?:[.!?]+(?=\s|$))?/g;
  let m;
  while ((m = re.exec(masked))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text.replace(/[^a-z0-9]/gi, "").length < 2) continue;
    const start = m.index + lead;
    out.push({ text: input.slice(start, start + text.length), start, end: start + text.length });
  }
  return out;
}

export const words = (s) => (s.match(/[A-Za-z][A-Za-z'’-]*|\d[\d,.]*/g) || []);

export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const s = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = s.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch–Kincaid grade level. */
export function readability(masked) {
  const sents = sentences(masked);
  const ws = sents.flatMap((s) => words(s.text)).filter((w) => /[a-z]/i.test(w));
  if (!sents.length || !ws.length) return { grade: 0, words: ws.length, sentences: sents.length, avgSentence: 0 };
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  const grade = 0.39 * (ws.length / sents.length) + 11.8 * (syl / ws.length) - 15.59;
  return { grade: Math.round(grade * 10) / 10, words: ws.length, sentences: sents.length, avgSentence: Math.round((ws.length / sents.length) * 10) / 10 };
}

export function matchCase(original, replacement) {
  if (!replacement) return replacement;
  if (original === original.toUpperCase() && /[A-Z]/.test(original) && original.length > 1) return replacement.toUpperCase();
  if (/^[A-Z]/.test(original)) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

export const norm = (s) => (s || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** Parse a human number token like "1,20,000", "120k", "4.7", "7.1%", "1.2 lakh", "2 million". */
export function parseNumber(token) {
  if (!token) return null;
  const t = token.toLowerCase().replace(/,/g, "").trim();
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lac|m|mn|million|cr|crore|bn|billion)?/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const mult = { k: 1e3, thousand: 1e3, lakh: 1e5, lac: 1e5, m: 1e6, mn: 1e6, million: 1e6, cr: 1e7, crore: 1e7, bn: 1e9, billion: 1e9 };
  if (m[2]) v *= mult[m[2]];
  return v;
}

// ---------- colour ----------
export function hexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export function luminance([r, g, b]) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}
function toLab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(lin);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [X, Y, Z] = [f(X), f(Y), f(Z)];
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
/** CIE76 colour difference; < ~10 reads as "the same brand colour". */
export function deltaE(a, b) {
  const [l1, a1, b1] = toLab(a), [l2, a2, b2] = toLab(b);
  return Math.round(Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 10) / 10;
}
