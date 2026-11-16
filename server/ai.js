// Optional AI layer (Google Gemini). Keel is fully usable without it; when enabled it adds
// judgement-based checks (tone, messaging, implied claims, imagery) and intent-preserving rewrites.
//
// Guardrails:
//  1. Redaction  — confidential register terms + emails/phone numbers are replaced with
//                  placeholders BEFORE text leaves the server; confidential facts are never sent.
//  2. Grounding  — the model may only cite rule IDs we supplied; each finding must quote text
//                  that exists verbatim in the content. Anything else is discarded and counted.
//  3. Disclosure — every call is logged (purpose, model, characters sent, redactions, kept/discarded).
//  4. Human gate — AI output is a suggestion only; nothing is applied without a person clicking Apply.
import { GoogleGenAI, ApiError } from "@google/genai";
import { z } from "zod";
import { getSetting, now, loadBrandKit } from "./db.js";
import { escapeRe } from "./engine/text.js";

// gemini-2.5-flash answered in about a second in our live tests; newer flash models were often
// overloaded (503). if the main model is busy or missing we try the fallbacks in order.
export const MODEL = process.env.GEMINI_MODEL || process.env.KEEL_MODEL || "gemini-2.5-flash";
// on the free tier each model has its own small daily quota (20 requests in our tests), so a chain
// of models keeps ai working longer. a model that hit its daily limit is skipped until it resets.
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.5-flash,gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash")
  .split(",").map((s) => s.trim()).filter((m) => m && m !== MODEL);
const restingUntil = new Map(); // model -> time (ms) when its quota should be back
export const PROVIDER = "Google Gemini";
const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
let client = null;
// json mode is only available on the v1beta api, so pin it (some keys default to v1)
const getClient = () => (client ||= new GoogleGenAI({ apiKey: apiKey(), apiVersion: "v1beta", httpOptions: { timeout: 90_000 } }));
let lastModel = MODEL; // the model that actually answered the latest call, for the ai log
/** Tests swap in a fake client so the request shaping and guardrails can be checked without a key. */
export function _setClientForTests(c) { client = c; }

export function aiConfigured() {
  return !!(apiKey() || process.env.KEEL_AI === "on");
}
export function aiEnabled(db) {
  return aiConfigured() && getSetting(db, "ai_enabled", true);
}

// ------------------------------------------------------------------ redaction
export function redact(text, confidentialTerms = []) {
  const map = [];
  let out = text;
  const terms = [...confidentialTerms].sort((a, b) => b.length - a.length);
  for (const t of terms) {
    out = out.replace(new RegExp(escapeRe(t), "gi"), (m) => {
      map.push(m);
      return `[REDACTED_${map.length}]`;
    });
  }
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => (map.push(m), `[REDACTED_${map.length}]`));
  out = out.replace(/(?<!\d)(?:\+?\d[\d -]{8,}\d)(?!\d)/g, (m) => (map.push(m), `[REDACTED_${map.length}]`));
  return { text: out, map, count: map.length };
}
export function unredact(text, map) {
  return text.replace(/\[REDACTED_(\d+)\]/g, (m, n) => map[+n - 1] ?? m);
}

function locate(body, quote) {
  if (!quote || quote.length < 3) return null;
  let i = body.indexOf(quote);
  if (i >= 0) return { start: i, end: i + quote.length };
  const re = new RegExp(escapeRe(quote.trim()).replace(/\s+/g, "\\s+"), "i");
  const m = re.exec(body);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

function logAi(db, row) {
  db.prepare(`INSERT INTO ai_log(submission_id,purpose,model,chars_sent,redactions,outcome,kept,discarded,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(row.submission_id ?? null, row.purpose, lastModel, row.chars_sent, row.redactions, row.outcome, row.kept ?? 0, row.discarded ?? 0, now());
}

/** Drop JSON-schema keywords that Gemini's response schema may not accept; zod re-validates anyway. */
function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) if (k !== "additionalProperties") out[k] = geminiSchema(v);
  return out;
}

/**
 * One structured-output (JSON) call. `content` is a string or an array of parts
 * ({ text } or { inlineData: { mimeType, data } }).
 */
async function callJson({ system, content, schema, temperature = 0.2 }) {
  const parts = typeof content === "string" ? [{ text: content }] : content;
  const all = [MODEL, ...FALLBACK_MODELS];
  const awake = all.filter((m) => !(restingUntil.get(m) > Date.now()));
  const models = awake.length ? awake : all; // if everything is resting, try anyway (quotas may have reset)
  let res;
  for (const [i, model] of models.entries()) {
    try {
      res = await getClient().models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { systemInstruction: system, temperature, maxOutputTokens: 16000,
          responseMimeType: "application/json", responseJsonSchema: geminiSchema(schema) },
      });
      lastModel = model;
      break;
    } catch (e) {
      // daily quota used up: rest this model until google says it resets (fallback: an hour)
      if (e?.status === 429 && /PerDay/i.test(String(e.message))) {
        const secs = +(/retryDelay\D+(\d+)s/.exec(String(e.message))?.[1] || 3600);
        restingUntil.set(model, Date.now() + secs * 1000);
      }
      if (e?.status === 404) restingUntil.set(model, Date.now() + 24 * 3600e3); // model not available for this key
      // busy, rate-limited, missing model or a network hiccup: try the next one.
      // anything else (bad key, bad request) stops here.
      const network = !e?.status && /fetch failed|timeout|ECONNRESET|ETIMEDOUT|aborted/i.test(String(e?.message || e?.cause?.code || ""));
      const retry = ([404, 429, 500, 503].includes(e?.status) || network) && i < models.length - 1;
      if (!retry) { lastModel = model; throw e; }
    }
  }
  if (res.promptFeedback?.blockReason) return { refused: true };
  const cand = res.candidates?.[0];
  if (!cand) return { refused: true };
  if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(cand.finishReason)) return { refused: true };
  if (cand.finishReason === "MAX_TOKENS") throw new Error("AI response was truncated");
  const text = res.text || "";
  let data;
  try { data = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")); }
  catch { throw new Error("AI returned invalid JSON"); }
  return { data, usage: res.usageMetadata };
}

function friendlyError(e) {
  if (e instanceof ApiError || typeof e?.status === "number") {
    const st = e.status, msg = String(e.message || "");
    if (st === 401 || st === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) return "AI key rejected — check GEMINI_API_KEY";
    if (st === 429) return "AI rate-limited or out of quota — try again shortly";
    if (st === 404) return `AI model "${MODEL}" not found — set GEMINI_MODEL to a model your key can use`;
    if (st >= 500) return `AI service error (${st}) — try again`;
    return `AI request failed (${st})`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(e?.message || "")) return "Could not reach the AI service";
  return e?.message || String(e);
}

// ------------------------------------------------------------------ review
const SEV = ["blocker", "major", "minor", "info"];
const ReviewSchema = {
  type: "object", additionalProperties: false, required: ["summary", "intent_alignment", "findings"],
  properties: {
    summary: { type: "string" },
    intent_alignment: {
      type: "object", additionalProperties: false, required: ["verdict", "note"],
      properties: { verdict: { type: "string", enum: ["aligned", "partially_aligned", "misaligned"] }, note: { type: "string" } },
    },
    findings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["rule_id", "quote", "issue", "why", "replacement", "severity", "confidence"],
        properties: {
          rule_id: { type: "string" }, quote: { type: "string" }, issue: { type: "string" }, why: { type: "string" },
          replacement: { type: "string" }, severity: { type: "string", enum: SEV }, confidence: { type: "number" },
        },
      },
    },
  },
};
const ReviewZ = z.object({
  summary: z.string(),
  intent_alignment: z.object({ verdict: z.enum(["aligned", "partially_aligned", "misaligned"]), note: z.string() }),
  findings: z.array(z.object({
    rule_id: z.string(), quote: z.string(), issue: z.string(), why: z.string(), replacement: z.string(),
    severity: z.enum(SEV), confidence: z.number(),
  })),
});

const REVIEW_SYSTEM = `You are Keel, a brand-governance reviewer. You check draft content against a brand's approved guidelines BEFORE publication.

How to work:
- Only raise an issue when you can tie it to one of the rule IDs supplied. If no rule applies, do not raise it.
- "quote" must be copied character-for-character from the content (a short span, ideally under 120 characters). Findings whose quote is not found verbatim are automatically discarded.
- A deterministic rule engine has already checked brand-name spelling, preferred terms, banned and hype words, capitals, exclamation marks, figures against the facts library, absolute promises and listed superlatives, alt text, link text, headings and contrast. Do NOT report those again. Focus on what needs judgement: tone and voice, messaging pillars, call-to-action clarity, implied or misleading claims, fear/urgency tactics, and whether the content serves the creator's stated goal.
- "replacement" is a drop-in rewrite of exactly the quoted text that fixes the issue while preserving the creator's purpose, meaning and approximate length. Use "" when the fix needs a human decision.
- Never invent facts or figures. Only use figures that appear in the approved facts list.
- Placeholders like [REDACTED_1] hide confidential text; keep them unchanged if quoted.
- confidence is 0–1: how sure you are that a careful brand reviewer would agree.
- Be precise and sparing: a few high-value findings beat many weak ones. Clean content can have zero findings.`;

export async function aiReview(db, { submission_id, body, channel, format, intent }) {
  const kit = loadBrandKit(db, { includeConfidential: false });
  const terms = db.prepare("SELECT term FROM confidential_terms").all().map((r) => r.term);
  const red = redact(body, terms);
  const guidelines = kit.rules.map((r) => `- ${r.id} [${r.category}, default severity ${r.severity}] ${r.title}: ${r.guideline}`).join("\n");
  const facts = kit.facts.map((f) => `- ${f.id}: ${f.statement}${f.valid_until ? ` (valid until ${f.valid_until})` : ""}`).join("\n");
  const prompt = `<brand>${kit.brandName}</brand>
<guidelines>
${guidelines}
</guidelines>
<approved_facts>
${facts}
</approved_facts>
<creator_intent>
Goal: ${intent?.goal || "(not stated)"}
Audience: ${intent?.audience || "(not stated)"}
Call to action: ${intent?.cta || "(not stated)"}
</creator_intent>
<channel>${channel}</channel> <format>${format}</format>
<content>
${red.text}
</content>
Review the content against the guidelines.`;
  const chars = REVIEW_SYSTEM.length + prompt.length;
  try {
    const out = await callJson({ system: REVIEW_SYSTEM, content: prompt, schema: ReviewSchema });
    if (out.refused) { logAi(db, { submission_id, purpose: "review", chars_sent: chars, redactions: red.count, outcome: "refused" }); return { ok: false, error: "The AI declined to review this content." }; }
    const data = ReviewZ.parse(out.data);
    const { kept, discarded } = groundFindings(data.findings, { body, redactionMap: red.map, rules: kit.rules });
    logAi(db, { submission_id, purpose: "review", chars_sent: chars, redactions: red.count, outcome: "ok", kept: kept.length, discarded: discarded.length });
    return { ok: true, findings: kept, discarded, summary: data.summary, intent: data.intent_alignment };
  } catch (e) {
    logAi(db, { submission_id, purpose: "review", chars_sent: chars, redactions: red.count, outcome: "error: " + friendlyError(e) });
    return { ok: false, error: friendlyError(e) };
  }
}

/**
 * "No receipt, no finding": keep an AI finding only if it cites a supplied rule ID and its
 * quote exists verbatim in the original content. Pure function — unit tested.
 */
export function groundFindings(findings, { body, redactionMap = [], rules, minConfidence = 0.5 }) {
  const ruleIds = new Map(rules.map((r) => [r.id, r]));
  const kept = [], discarded = [];
  for (const f of findings) {
    const rule = ruleIds.get(f.rule_id);
    const quote = unredact(f.quote || "", redactionMap);
    const pos = locate(body, quote);
    const reason = !rule ? "unknown rule" : !pos ? "quote not found" : f.confidence < minConfidence ? "low confidence" : null;
    if (reason) { discarded.push({ ...f, reason }); continue; }
    const replacement = f.replacement ? unredact(f.replacement, redactionMap) : "";
    kept.push({
      rule_id: rule.id, category: rule.category, severity: f.severity, engine: "ai",
      confidence: Math.max(0, Math.min(1, f.confidence)), start: pos.start, end: pos.end,
      excerpt: body.slice(pos.start, pos.end), message: f.issue, why: f.why,
      source: { type: "rule", id: rule.id, title: rule.title, text: rule.guideline, rationale: rule.rationale, version: rule.version },
      suggestion: replacement ? { kind: "replace", replacement, text: `Rewrite: "${replacement}"` } : { kind: "advice", text: "Needs a human decision — see explanation." },
    });
  }
  return { kept, discarded };
}

// ------------------------------------------------------------------ rewrite
const RewriteSchema = {
  type: "object", additionalProperties: false, required: ["rewrite", "rationale"],
  properties: { rewrite: { type: "string" }, rationale: { type: "string" } },
};
export async function aiRewrite(db, { submission_id, body, finding, intent }) {
  const terms = db.prepare("SELECT term FROM confidential_terms").all().map((r) => r.term);
  const red = redact(body, terms);
  const ex = redact(finding.excerpt || "", terms);
  const system = "You rewrite a short passage of marketing content so it complies with a brand guideline while preserving the creator's purpose, facts, call to action and approximate length. Do not add figures or claims that are not already present or listed as approved. Keep [REDACTED_n] placeholders unchanged. Return only the replacement for the passage.";
  const prompt = `<guideline>${finding.source?.text || ""}</guideline>
<issue>${finding.message}. ${finding.why}</issue>
<creator_intent>Goal: ${intent?.goal || "-"}; Audience: ${intent?.audience || "-"}; CTA: ${intent?.cta || "-"}</creator_intent>
<full_content_for_context>
${red.text}
</full_content_for_context>
<passage_to_rewrite>${ex.text}</passage_to_rewrite>`;
  const chars = system.length + prompt.length;
  try {
    const out = await callJson({ system, content: prompt, schema: RewriteSchema, temperature: 0.4 });
    if (out.refused) { logAi(db, { submission_id, purpose: "rewrite", chars_sent: chars, redactions: red.count, outcome: "refused" }); return { ok: false, error: "The AI declined this rewrite." }; }
    logAi(db, { submission_id, purpose: "rewrite", chars_sent: chars, redactions: red.count, outcome: "ok", kept: 1 });
    return { ok: true, rewrite: unredact(out.data.rewrite, [...red.map]), rationale: out.data.rationale };
  } catch (e) {
    logAi(db, { submission_id, purpose: "rewrite", chars_sent: chars, redactions: red.count, outcome: "error: " + friendlyError(e) });
    return { ok: false, error: friendlyError(e) };
  }
}

// ------------------------------------------------------------------ image review
const ImageSchema = {
  type: "object", additionalProperties: false, required: ["findings", "suggested_alt"],
  properties: {
    suggested_alt: { type: "string" },
    findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["rule_id", "issue", "why", "severity", "confidence"],
      properties: { rule_id: { type: "string" }, issue: { type: "string" }, why: { type: "string" }, severity: { type: "string", enum: SEV }, confidence: { type: "number" } } } },
  },
};
export async function aiImageReview(db, { submission_id, image, index }) {
  const kit = loadBrandKit(db, { includeConfidential: false });
  const visual = kit.rules.filter((r) => ["visual", "accessibility"].includes(r.category));
  const palette = kit.assets.filter((a) => a.kind === "color").map((a) => `${a.name} ${a.value} (${a.usage})`).join("; ");
  const m = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/.exec(image.dataUrl || "");
  if (!m) return { ok: false, error: "Unsupported image" };
  const system = "You review a marketing image against brand visual guidelines. Only raise issues tied to a supplied rule ID. Also write concise, purposeful alt text (max 125 characters).";
  const text = `<guidelines>\n${visual.map((r) => `- ${r.id}: ${r.guideline}`).join("\n")}\n</guidelines>\n<palette>${palette}</palette>\n<author_alt_text>${image.alt || "(none)"}</author_alt_text>`;
  const chars = system.length + text.length;
  try {
    const out = await callJson({ system, schema: ImageSchema, content: [
      { inlineData: { mimeType: m[1], data: m[3] } }, { text },
    ] });
    if (out.refused) return { ok: false, error: "The AI declined to review this image." };
    const ids = new Map(visual.map((r) => [r.id, r]));
    const kept = out.data.findings.filter((f) => ids.has(f.rule_id)).map((f) => {
      const rule = ids.get(f.rule_id);
      return { rule_id: rule.id, category: rule.category, severity: f.severity, engine: "ai", confidence: Math.max(0, Math.min(1, f.confidence)),
        start: null, end: null, excerpt: image.name || `Image ${index + 1}`, message: f.issue, why: f.why,
        source: { type: "rule", id: rule.id, title: rule.title, text: rule.guideline, image: index },
        suggestion: { kind: "advice", text: "Update the image and re-upload." } };
    });
    logAi(db, { submission_id, purpose: "image_review", chars_sent: chars, redactions: 0, outcome: "ok", kept: kept.length, discarded: out.data.findings.length - kept.length });
    return { ok: true, findings: kept, suggested_alt: out.data.suggested_alt };
  } catch (e) {
    logAi(db, { submission_id, purpose: "image_review", chars_sent: chars, redactions: 0, outcome: "error: " + friendlyError(e) });
    return { ok: false, error: friendlyError(e) };
  }
}

// ------------------------------------------------------------------ guideline import
const ImportSchema = {
  type: "object", additionalProperties: false, required: ["rules"],
  properties: { rules: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["title", "category", "type", "severity", "guideline", "preferred", "avoid"],
    properties: {
      title: { type: "string" }, category: { type: "string", enum: ["tone", "terminology", "messaging", "claims", "facts", "visual", "accessibility", "confidentiality"] },
      type: { type: "string", enum: ["term_replace", "banned_phrase", "ai"] }, severity: { type: "string", enum: SEV },
      guideline: { type: "string" }, preferred: { type: "string" }, avoid: { type: "array", items: { type: "string" } },
    } } } },
};
export async function aiImportGuidelines(db, text) {
  const system = "Convert a brand style guide into discrete, checkable rules. Use type 'term_replace' for 'say X not Y' terminology (preferred = X, avoid = [Y...]), 'banned_phrase' for words to avoid (avoid = phrases, preferred = ''), and 'ai' for judgement-based guidance (preferred = '', avoid = []). Quote the guide's own wording in 'guideline'. Do not invent rules that the text does not state.";
  const chars = system.length + text.length;
  try {
    const out = await callJson({ system, schema: ImportSchema, content: `<style_guide>\n${text}\n</style_guide>` });
    if (out.refused) return { ok: false, error: "The AI declined to process this text." };
    logAi(db, { purpose: "guideline_import", chars_sent: chars, redactions: 0, outcome: "ok", kept: out.data.rules.length });
    return { ok: true, rules: out.data.rules };
  } catch (e) {
    logAi(db, { purpose: "guideline_import", chars_sent: chars, redactions: 0, outcome: "error: " + friendlyError(e) });
    return { ok: false, error: friendlyError(e) };
  }
}
