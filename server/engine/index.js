// Keel deterministic review engine.
// Pure functions: (content, brandKit) -> { findings, claims, stats }.
// Every finding carries a "receipt": the rule or fact it is grounded in, the exact excerpt,
// a plain-language explanation and (where safe) a suggested fix. No receipt, no finding.
import {
  phraseRe, findAll, maskMarkup, plainText, sentences, readability, matchCase, norm,
  parseNumber, hexToRgb, contrastRatio, deltaE, escapeRe,
} from "./text.js";

const SEVERITY_WEIGHT = { blocker: 25, major: 8, minor: 3, info: 0 };

export function reviewContent(content, kit, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const body = content.body || "";
  const format = content.format || "text";
  const masked = maskMarkup(body, format);
  const ctx = {
    body, format, masked, channel: content.channel || "general", images: content.images || [],
    sents: sentences(masked), kit, today, findings: [], claims: [],
  };

  // checks that depend on the claim ledger run last
  const late = (r) => (r.config?.check === "fact_disclaimers" ? 1 : 0);
  const ordered = [...kit.rules].sort((a, b) => late(a) - late(b));
  for (const rule of ordered) {
    if (!rule.enabled && rule.enabled !== undefined) continue;
    if (rule.config?.channels && !rule.config.channels.includes(ctx.channel)) continue;
    const fn = RULE_TYPES[rule.type] || (rule.type === "builtin" ? BUILTINS[rule.config?.check] : null);
    if (!fn) continue; // "ai" rules are evaluated by the AI layer, not here
    try { fn(ctx, rule); } catch (e) { ctx.findings.push(engineError(rule, e)); }
  }

  const findings = dropFiguresInsideClaims(dedupe(ctx.findings), kit).sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9));
  // stable fingerprints let human decisions (e.g. a dismissal) carry across revisions
  const seen = {};
  for (const f of findings) {
    const key = `${f.rule_id}|${norm(f.excerpt || f.message)}`;
    seen[key] = (seen[key] || 0) + 1;
    f.fingerprint = `${key}|${seen[key]}`;
  }
  const rd = readability(masked);
  const penalty = findings.reduce((a, f) => a + (SEVERITY_WEIGHT[f.severity] || 0), 0);
  return {
    findings,
    claims: ctx.claims,
    stats: {
      words: rd.words, sentences: rd.sentences, grade: rd.grade, avgSentence: rd.avgSentence,
      characters: plainText(body, format).length,
      score: Math.max(0, 100 - penalty),
      counts: countBy(findings, "severity"),
    },
  };
}

function countBy(arr, k) { return arr.reduce((a, x) => ((a[x[k]] = (a[x[k]] || 0) + 1), a), {}); }

function dedupe(fs) {
  const seen = new Set();
  const unique = fs.filter((f) => {
    const k = `${f.rule_id}|${f.start}|${f.end}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // within one rule, overlapping spans ("savings pots" vs "pots") keep only the longest match
  return unique.filter((f) => f.start == null || !unique.some((g) => g !== f && g.rule_id === f.rule_id && g.start != null &&
    g.start <= f.start && g.end >= f.end && (g.end - g.start > f.end - f.start || (g.end - g.start === f.end - f.start && unique.indexOf(g) < unique.indexOf(f)))));
}

/** "100% safe" is one problem (an absolute promise), not two: drop a figure finding inside a claim finding. */
function dropFiguresInsideClaims(fs, kit) {
  const ruleCheck = Object.fromEntries(kit.rules.map((r) => [r.id, r.config?.check]));
  const claimSpans = fs.filter((f) => ruleCheck[f.rule_id] === "claims" && f.start != null);
  return fs.filter((f) => ruleCheck[f.rule_id] !== "numeric_claims" || f.start == null ||
    !claimSpans.some((c) => c.start <= f.start && c.end >= f.end));
}

/** Spans of email addresses and web links in plain text — brand terms inside them are not prose. */
const LINK_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/\S+|\bwww\.\S+/gi;
const inLink = (ctx, m) => (ctx.linkSpans ||= findAll(ctx.masked, LINK_RE)).some((l) => m.start >= l.start && m.end <= l.end);

function engineError(rule, e) {
  return finding(rule, { message: `Rule ${rule.id} could not be evaluated`, why: String(e.message || e), severity: "info", confidence: 0 });
}

function ruleSource(rule) {
  return { type: "rule", id: rule.id, title: rule.title, text: rule.guideline, rationale: rule.rationale || null, version: rule.version || 1 };
}

function finding(rule, f) {
  return {
    rule_id: rule.id, category: rule.category, severity: f.severity || rule.severity, engine: "rules",
    confidence: f.confidence ?? 0.95, start: f.start ?? null, end: f.end ?? null, excerpt: f.excerpt ?? null,
    message: f.message, why: f.why || rule.rationale || rule.guideline,
    source: f.source || ruleSource(rule), suggestion: f.suggestion || null,
  };
}

function sentenceAt(ctx, pos) {
  return ctx.sents.find((s) => pos >= s.start && pos < s.end) || { text: "", start: pos, end: pos };
}

// ---------------------------------------------------------------- generic rule types
const RULE_TYPES = {
  /** Preferred terminology: { preferred, variants: [], replacements: {variant: replacement} } */
  term_replace(ctx, rule) {
    const { preferred, variants = [], replacements = {}, ignore_after = [] } = rule.config;
    for (const v of variants) {
      for (const m of findAll(ctx.masked, phraseRe(v))) {
        if (inLink(ctx, m)) continue;
        const after = ctx.masked.slice(m.end, m.end + 30).toLowerCase();
        if (ignore_after.some((w) => after.trimStart().startsWith(w))) continue;
        const rep = matchCase(m.match, replacements[v.toLowerCase()] ?? preferred);
        ctx.findings.push(finding(rule, {
          start: m.start, end: m.end, excerpt: ctx.body.slice(m.start, m.end),
          message: `Use "${rep}" instead of "${m.match}"`,
          suggestion: { kind: "replace", replacement: rep, text: `Replace with "${rep}"` },
        }));
      }
    }
  },

  /** Exact brand/product spelling: { canonical, variants? } */
  canonical_spelling(ctx, rule) {
    const { canonical, variants = [] } = rule.config;
    const res = [phraseRe(canonical), ...variants.map((v) => phraseRe(v))];
    for (const re of res) {
      for (const m of findAll(ctx.masked, re)) {
        if (m.match === canonical || inLink(ctx, m)) continue;
        ctx.findings.push(finding(rule, {
          start: m.start, end: m.end, excerpt: m.match,
          message: `Write "${canonical}", not "${m.match}"`,
          suggestion: { kind: "replace", replacement: canonical, text: `Replace with "${canonical}"` },
        }));
      }
    }
  },

  /** Banned / discouraged phrases: { phrases: [{ text, suggest? , note? }] } */
  banned_phrase(ctx, rule) {
    for (const p of rule.config.phrases || []) {
      for (const m of findAll(ctx.masked, phraseRe(p.text))) {
        const hasSuggest = typeof p.suggest === "string";
        const rep = hasSuggest ? matchCase(m.match, p.suggest) : null;
        ctx.findings.push(finding(rule, {
          start: m.start, end: m.end, excerpt: ctx.body.slice(m.start, m.end),
          message: `"${m.match}" is off-brand${p.note ? ` — ${p.note}` : ""}`,
          suggestion: hasSuggest
            ? { kind: "replace", replacement: rep, text: rep ? `Replace with "${rep}"` : "Remove this word" }
            : { kind: "advice", text: p.advice || "Rephrase in plain, specific language." },
        }));
      }
    }
  },

  /** Limit a pattern's frequency: { pattern, max, label, replacement? } */
  max_count(ctx, rule) {
    const { pattern, max = 1, label = "occurrences", replacement } = rule.config;
    const hits = findAll(ctx.masked, new RegExp(pattern, "g"));
    hits.slice(max).forEach((m) => ctx.findings.push(finding(rule, {
      start: m.start, end: m.end, excerpt: ctx.body.slice(m.start, m.end),
      message: `Too many ${label} (${hits.length} found, max ${max})`,
      suggestion: replacement != null ? { kind: "replace", replacement, text: `Replace with "${replacement}"` } : null,
    })));
  },

  /** If any trigger appears, a required phrase must too: { triggers: [regex], require, label } */
  conditional_required(ctx, rule) {
    const { triggers = [], require } = rule.config;
    const first = triggers.map((t) => findAll(ctx.masked, new RegExp(t, "gi"))[0]).filter(Boolean).sort((a, b) => a.start - b.start)[0];
    if (!first) return;
    if (norm(ctx.masked).includes(norm(require))) return;
    ctx.findings.push(finding(rule, {
      start: first.start, end: first.end, excerpt: ctx.body.slice(first.start, first.end),
      message: `Missing required wording: "${require}"`,
      suggestion: { kind: "append", replacement: require, text: `Add "${require}"` },
    }));
  },
};

// ---------------------------------------------------------------- built-in checks
const ACRONYMS = new Set(["FAQ", "API", "HTML", "CSS", "USA", "UK", "EU", "UPI", "KYC", "RBI", "SEBI", "AER", "APR", "EMI", "GST", "PDF", "CEO", "CTO", "CFO", "SMS", "OTP", "PIN", "ATM", "NEFT", "IMPS", "AI", "ISO", "SOC", "WCAG"]);

const BUILTINS = {
  all_caps(ctx, rule) {
    const allow = new Set([...(rule.config.allow || []), ...ACRONYMS]);
    // capitals in text read from an image (OCR) are a typography choice in the design, not shouting
    const imageText = [...ctx.body.matchAll(/^<!-- page: Text in image .+? -->$/gm)].map((m) => {
      const next = ctx.body.slice(m.index + m[0].length).search(/^<!-- page: /m);
      return [m.index, next < 0 ? ctx.body.length : m.index + m[0].length + next];
    });
    for (const m of findAll(ctx.masked, /\b[A-Z][A-Z'’]{3,}\b/g)) {
      if (allow.has(m.match)) continue;
      if (imageText.some(([a, b]) => m.start >= a && m.start < b)) continue;
      // SMS keywords ("Reply STOP to opt out") are capitalised by convention
      if (/\b(?:reply|text|send|sms)\s+$/i.test(ctx.masked.slice(Math.max(0, m.start - 12), m.start))) continue;
      const rep = m.match[0] + m.match.slice(1).toLowerCase();
      ctx.findings.push(finding(rule, {
        start: m.start, end: m.end, excerpt: m.match,
        message: `"${m.match}" is written in capitals — it reads as shouting`,
        suggestion: { kind: "replace", replacement: rep, text: `Use "${rep}" (add emphasis with structure, not caps)` },
      }));
    }
  },

  readability(ctx, rule) {
    const { max_sentence_words = 28, max_grade = 9 } = rule.config;
    for (const s of ctx.sents) {
      const n = (s.text.match(/\S+/g) || []).length;
      if (n > max_sentence_words) {
        ctx.findings.push(finding(rule, {
          start: s.start, end: s.end, excerpt: s.text.length > 160 ? s.text.slice(0, 157) + "…" : s.text,
          severity: "minor",
          message: `Long sentence (${n} words; guideline is ${max_sentence_words} or fewer)`,
          suggestion: { kind: "advice", text: "Split this into two sentences, one idea each." },
        }));
      }
    }
    const rd = readability(ctx.masked);
    if (rd.words >= 40 && rd.grade > max_grade) {
      ctx.findings.push(finding(rule, {
        message: `Reading level is grade ${rd.grade} (target: ${max_grade} or below)`,
        why: `${rule.guideline} Plain language helps every reader, including people using assistive technology or reading in a second language.`,
        suggestion: { kind: "advice", text: "Use shorter sentences and everyday words." }, confidence: 0.8,
      }));
    }
  },

  alt_text(ctx, rule) {
    const { body, format } = ctx;
    if (format === "markdown" || format === "text") {
      for (const m of findAll(body, /!\[([^\]]*)\]\(([^)]*)\)/g)) {
        if (m.groups[1].trim().length < 3) ctx.findings.push(finding(rule, {
          start: m.start, end: m.end, excerpt: m.match, message: "Image is missing alt text",
          suggestion: { kind: "advice", text: "Describe what the image shows and why it is there, e.g. ![Member checking a savings goal in the app](…)." },
        }));
      }
    }
    if (format === "html") {
      for (const m of findAll(body, /<img\b[^>]*>/gi)) {
        const alt = m.match.match(/\balt\s*=\s*("([^"]*)"|'([^']*)')/i);
        if (!alt) ctx.findings.push(finding(rule, {
          start: m.start, end: m.end, excerpt: m.match, message: "<img> has no alt attribute",
          suggestion: { kind: "advice", text: 'Add alt="…" describing the image (use alt="" only for purely decorative images).' },
        }));
      }
    }
    ctx.images.forEach((img, i) => {
      if (!img.decorative && (!img.alt || img.alt.trim().length < 3)) ctx.findings.push(finding(rule, {
        excerpt: img.name || `Image ${i + 1}`, message: `Attached image "${img.name || i + 1}" has no alt text`,
        source: { ...ruleSource(rule), image: i },
        suggestion: { kind: "advice", text: "Add alt text in the image panel, or mark the image as decorative." },
      }));
    });
  },

  link_text(ctx, rule) {
    const bad = (rule.config.bad || ["click here", "here", "read more", "learn more", "this link", "link"]).map(norm);
    const re = ctx.format === "html" ? /<a\b[^>]*>([\s\S]*?)<\/a>/gi : /(?<!!)\[([^\]]+)\]\([^)]*\)/g;
    for (const m of findAll(ctx.body, re)) {
      const text = norm(m.groups[1].replace(/<[^>]+>/g, ""));
      if (bad.includes(text)) ctx.findings.push(finding(rule, {
        start: m.start, end: m.end, excerpt: m.match, message: `Link text "${m.groups[1]}" doesn't say where it goes`,
        suggestion: { kind: "advice", text: 'Use descriptive link text, e.g. "See current savings rates".' },
      }));
    }
  },

  heading_order(ctx, rule) {
    const re = ctx.format === "html" ? /<h([1-6])\b[^>]*>/gi : ctx.format === "markdown" ? /^(#{1,6})\s/gm : null;
    if (!re) return;
    let prev = 0;
    for (const m of findAll(ctx.body, re)) {
      const lvl = ctx.format === "html" ? +m.groups[1] : m.groups[1].length;
      if (prev && lvl > prev + 1) ctx.findings.push(finding(rule, {
        start: m.start, end: m.end, excerpt: m.match.trim(), message: `Heading jumps from level ${prev} to ${lvl}`,
        suggestion: { kind: "advice", text: `Use a level-${prev + 1} heading here so screen-reader users can follow the structure.` },
      }));
      prev = lvl;
    }
  },

  contrast(ctx, rule) {
    if (ctx.format !== "html") return;
    const min = rule.config.min_ratio || 4.5;
    for (const m of findAll(ctx.body, /style\s*=\s*"([^"]*)"/gi)) {
      const st = m.groups[1];
      const fg = st.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,6})/i);
      const bg = st.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})/i);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(hexToRgb(fg[1]), hexToRgb(bg[1]));
      if (ratio < min) ctx.findings.push(finding(rule, {
        start: m.start, end: m.end, excerpt: m.match, message: `Text contrast ${ratio}:1 is below ${min}:1 (${fg[1]} on ${bg[1]})`,
        suggestion: { kind: "advice", text: suggestPair(ctx.kit, min) },
      }));
    }
  },

  palette(ctx, rule) {
    const palette = ctx.kit.assets.filter((a) => a.kind === "color").map((a) => ({ ...a, rgb: hexToRgb(a.value) })).filter((a) => a.rgb);
    if (!palette.length) return;
    const tol = rule.config.tolerance || 12;
    const nearest = (rgb) => palette.map((p) => ({ p, d: deltaE(rgb, p.rgb) })).sort((a, b) => a.d - b.d)[0];
    if (ctx.format === "html") {
      for (const m of findAll(ctx.body, /(?:color|background(?:-color)?|border(?:-color)?)\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)) {
        const rgb = hexToRgb(m.groups[1]);
        if (!rgb) continue;
        const n = nearest(rgb);
        if (n.d > tol && !["#fff", "#ffffff", "#000", "#000000"].includes(m.groups[1].toLowerCase())) {
          ctx.findings.push(finding(rule, {
            start: m.start, end: m.end, excerpt: m.match, message: `${m.groups[1]} is not a brand colour`,
            source: { type: "asset", id: n.p.id, title: `Brand palette — closest: ${n.p.name} (${n.p.value})`, text: n.p.usage || rule.guideline },
            suggestion: { kind: "replace", replacement: m.match.replace(m.groups[1], n.p.value), text: `Use ${n.p.name} ${n.p.value}` },
          }));
        }
      }
    }
    ctx.images.forEach((img, i) => {
      if (img.kind === "photo" || !Array.isArray(img.palette) || !img.palette.length) return;
      const dominant = img.palette.slice(0, 4);
      const off = dominant.filter((c) => { const rgb = hexToRgb(c.hex || c); return rgb && nearest(rgb).d > tol * 1.6; });
      const offShare = off.reduce((a, c) => a + (c.share || 0.25), 0);
      if (offShare >= (rule.config.max_off_brand_share || 0.45)) {
        ctx.findings.push(finding(rule, {
          excerpt: img.name || `Image ${i + 1}`,
          message: `Graphic "${img.name || i + 1}" is dominated by off-palette colours (${off.map((c) => c.hex || c).join(", ")})`,
          source: { ...ruleSource(rule), image: i }, confidence: 0.75,
          suggestion: { kind: "advice", text: `Rebuild the graphic using brand colours: ${palette.map((p) => `${p.name} ${p.value}`).join(", ")}.` },
        }));
      }
    });
  },

  channel_length(ctx, rule) {
    const lim = (rule.config.limits || {})[ctx.channel];
    if (!lim) return;
    const len = plainText(ctx.body, ctx.format).length;
    if (len > lim) ctx.findings.push(finding(rule, {
      message: `${len} characters — ${ctx.channel} limit is ${lim}`,
      suggestion: { kind: "advice", text: `Trim ${len - lim} characters; keep the call to action.` },
    }));
  },

  confidential(ctx, rule) {
    for (const t of ctx.kit.confidential || []) {
      for (const m of findAll(ctx.masked, phraseRe(t.term))) {
        ctx.findings.push(finding(rule, {
          start: m.start, end: m.end, excerpt: m.match, severity: "blocker",
          message: `Mentions confidential item "${t.term}"`,
          why: `${t.reason || "Listed in the confidential register."}${t.until ? ` Embargoed until ${t.until}.` : ""} Publishing it could disclose unreleased plans.`,
          source: { type: "confidential", id: t.id, title: "Confidential register", text: t.term },
          suggestion: { kind: "advice", text: "Remove this reference or get written clearance from the brand owner." },
        }));
      }
    }
    for (const f of ctx.kit.facts.filter((x) => x.confidential)) {
      for (const s of ctx.sents) {
        const ns = norm(s.text);
        const hits = f.keywords.filter((k) => ns.includes(norm(k)));
        const valueHit = f.value && ns.includes(norm(f.value));
        const alreadyFlagged = ctx.findings.some((x) => x.rule_id === rule.id && x.start >= s.start && x.end <= s.end);
        if (!alreadyFlagged && (hits.length >= 2 || (valueHit && hits.length >= 1))) {
          ctx.findings.push(finding(rule, {
            start: s.start, end: s.end, excerpt: s.text, severity: "blocker",
            message: "This sentence appears to disclose a confidential fact",
            why: "It matches an internal-only entry in the approved facts library. Internal facts can inform reviewers but must not be published.",
            source: { type: "fact", id: f.id, title: "Confidential fact (internal only)", text: "[content withheld — confidential]" },
            suggestion: { kind: "advice", text: "Remove the sentence, or ask the brand owner whether the information is public yet." },
            confidence: 0.8,
          }));
          break;
        }
      }
    }
  },

  claims: checkClaims,
  numeric_claims: checkNumbers,
  fact_disclaimers(ctx, rule) {
    const used = new Set(ctx.claims.filter((c) => c.verdict === "supported" && c.fact_id).map((c) => c.fact_id));
    for (const f of ctx.kit.facts) {
      if (!f.required_disclaimer || !used.has(f.id)) continue;
      if (norm(ctx.masked).includes(norm(f.required_disclaimer))) continue;
      const c = ctx.claims.find((x) => x.fact_id === f.id);
      ctx.findings.push(finding(rule, {
        start: c.start, end: c.end, excerpt: c.text,
        message: `Claim needs its disclaimer: "${f.required_disclaimer}"`,
        source: { type: "fact", id: f.id, title: "Approved fact", text: f.statement },
        suggestion: { kind: "append", replacement: f.required_disclaimer, text: `Add "${f.required_disclaimer}"` },
      }));
    }
  },
};

function suggestPair(kit, min) {
  const cols = kit.assets.filter((a) => a.kind === "color").map((a) => ({ ...a, rgb: hexToRgb(a.value) })).filter((a) => a.rgb);
  const pairs = [];
  for (const a of cols) for (const b of cols) if (a !== b && contrastRatio(a.rgb, b.rgb) >= min) pairs.push(`${a.name} on ${b.name} (${contrastRatio(a.rgb, b.rgb)}:1)`);
  return pairs.length ? `Use an approved accessible pair, e.g. ${pairs.slice(0, 2).join(" or ")}.` : `Choose colours with at least ${min}:1 contrast.`;
}

// ---------------------------------------------------------------- claims & facts
function validFacts(ctx) {
  return ctx.kit.facts.filter((f) => !f.confidential);
}
function factStatus(f, today) {
  if (f.valid_until && f.valid_until < today) return "expired";
  if (f.valid_from && f.valid_from > today) return "not_yet_valid";
  return "valid";
}
function relatedFacts(ctx, sentence) {
  const ns = norm(sentence);
  return validFacts(ctx)
    .map((f) => ({ f, hits: f.keywords.filter((k) => ns.includes(norm(k))).length }))
    .filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).map((x) => x.f);
}

function checkClaims(ctx, rule) {
  const { absolute = [], superlative = [] } = rule.config;
  const factText = validFacts(ctx).filter((f) => factStatus(f, ctx.today) === "valid").map((f) => norm(f.statement)).join(" | ");
  const covered = [];
  // everyday phrases that contain a superlative word but make no claim about the product
  const notClaims = [...(rule.config.ignore_contexts || DEFAULT_NOT_CLAIMS)]
    .flatMap((p) => findAll(ctx.masked, phraseRe(p)).map((m) => [m.start, m.end]));
  const run = (list, kind) => {
    for (const p of list) {
      for (const m of findAll(ctx.masked, phraseRe(p.text))) {
        if (covered.some(([a, b]) => m.start < b && m.end > a)) continue; // "the best" already caught "best"
        if (kind === "superlative" && notClaims.some(([a, b]) => m.start >= a && m.end <= b)) continue;
        covered.push([m.start, m.end]);
        const s = sentenceAt(ctx, m.start);
        const related = relatedFacts(ctx, s.text);
        const backed = factText.includes(norm(p.text)) && related.length > 0;
        const verdict = backed ? "supported" : kind === "absolute" ? "prohibited" : "unsupported";
        ctx.claims.push({ text: s.text || m.match, start: s.start, end: s.end, verdict, fact_id: backed ? related[0].id : null, note: `${kind} claim: "${m.match}"` });
        if (backed) continue;
        const rel = related[0];
        ctx.findings.push(finding(rule, {
          start: m.start, end: m.end, excerpt: ctx.body.slice(m.start, m.end),
          severity: kind === "absolute" ? "blocker" : p.severity || rule.severity,
          confidence: p.confidence ?? (kind === "absolute" ? 0.95 : 0.85),
          message: kind === "absolute"
            ? `"${m.match}" is an absolute promise we can't substantiate`
            : `"${m.match}" is a comparative claim with no approved source`,
          why: `${rule.guideline} No entry in the approved facts library supports "${m.match}".${kind === "absolute" ? " Absolute promises in financial promotions can be misleading and are treated as blockers." : ""}`,
          suggestion: p.suggest != null
            ? { kind: "replace", replacement: matchCase(m.match, p.suggest), text: p.suggest ? `Soften to "${matchCase(m.match, p.suggest)}"${rel ? ` or cite: "${rel.statement}"` : ""}` : "Remove this word" }
            : { kind: "advice", text: rel ? `Replace with the approved fact: "${rel.statement}"` : "Remove the claim or add a source to the facts library for review." },
        }));
      }
    }
  };
  run(absolute, "absolute");
  run(superlative, "superlative");
}

const DEFAULT_NOT_CLAIMS = ["your best", "the best way to", "the best time to", "the best part", "all the best", "best wishes",
  "do your best", "best regards", "at best", "make the best of", "make the most of", "leading up to", "your highest"];

// Numbers that are not claims: phone numbers, dates, durations and example amounts.
const PHONE_RE = /(?<![\w.,])\+?\d[\d -]{7,}\d(?!\w|[.,]\d)/g;
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_RE = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b(?:,?\\s+\\d{4})?|\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?|\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b`, "gi");
const UNIT_AFTER_RE = /^\s*(?:am|pm|mins?|minutes?|hours?|hrs?|days?|weeks?|months?|years?|steps?|taps?|times)\b/i;
const MONEY_AFTER_RE = /^\s*(?:rupees?|rs\b\.?|inr\b|dollars?|pounds?|euros?)/i;
const CLAIM_CUE_RE = /\b(?:average|members?|customers?|users?|people|savers?|saved|earn(?:s|ed)?|returns?|interest|rates?|cashback|bonus|rewards?|paid out|helped|growth|grew)\b/i;

const NUM_RE =/(?:₹|\$|£|€|rs\.?\s?)?\d[\d,]*(?:\.\d+)?\s*(?:%|\+|k\b|lakh\b|million\b|mn\b|cr\b|crore\b|bn\b|billion\b|\/\s?5|x\b)?(?:\s*p\.a\.)?/gi;

function checkNumbers(ctx, rule) {
  const ignoreSmall = rule.config.ignore_below ?? 10;
  const notFigures = [...findAll(ctx.masked, PHONE_RE), ...findAll(ctx.masked, DATE_RE)];
  for (const m of findAll(ctx.masked, NUM_RE)) {
    const token = m.match.trim();
    if (!token) continue;
    if (notFigures.some((x) => m.start >= x.start && m.start < x.end)) continue;
    const after = ctx.masked.slice(m.start + token.length, m.start + token.length + 12);
    if (!/%/.test(token) && UNIT_AFTER_RE.test(after)) continue; // "10 weeks", "12 months"
    const isMoney = /^(?:₹|\$|£|€|rs)/i.test(token) || MONEY_AFTER_RE.test(after);
    if (isMoney && !CLAIM_CUE_RE.test(sentenceAt(ctx, m.start).text)) continue; // "save ₹500 a week" is an example, not a claim
    const s = sentenceAt(ctx, m.start);
    const value = parseNumber(token.replace(/[₹$£€]|rs\.?/gi, ""));
    if (value == null) continue;
    const isPct = /%/.test(token), isPlus = /\+/.test(token), isRating = /\/\s?5/.test(token);
    const isYear = /^(19|20)\d\d$/.test(token);
    const around = ctx.masked.slice(Math.max(0, m.start - 25), m.end + 25).toLowerCase();
    if (isYear && !/since|founded|established|launched/.test(around)) continue;
    const isDecimal = /\d\.\d/.test(token);
    if (!isPct && !isPlus && !isRating && !isYear && !isDecimal && value < ignoreSmall) continue;
    if (/\d\s*(am|pm|min|minutes|hours|days|steps|step)\b/i.test(ctx.masked.slice(m.start, m.end + 8))) continue;

    const related = relatedFacts(ctx, s.text);
    const eq = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-9;
    const tokenVal = value;
    let verdict = "unverified", fact = null, superseded = null;
    for (const f of related) {
      const fv = parseNumber(f.value);
      if (eq(fv, tokenVal)) { fact = f; verdict = factStatus(f, ctx.today) === "expired" ? "expired" : "supported"; break; }
      const old = (f.superseded_values || []).find((sv) => eq(parseNumber(sv), tokenVal));
      if (old) { fact = f; superseded = old; verdict = "outdated"; break; }
    }
    if (verdict === "unverified" && related.length) { fact = related[0]; verdict = "contradicts"; }

    const excerpt = ctx.body.slice(m.start, m.end).trim();
    const end = m.start + excerpt.length;
    ctx.claims.push({ text: s.text || token, start: s.start, end: s.end, verdict, fact_id: fact?.id || null, note: `figure: ${token}` });
    if (verdict === "supported") continue;

    const factSource = fact ? { type: "fact", id: fact.id, title: "Approved fact", text: fact.statement, source: fact.source, valid_until: fact.valid_until } : null;
    const replacement = fact?.value ? reformat(excerpt, fact.value) : null;
    const msgs = {
      outdated: [`"${excerpt}" is out of date — the approved figure is ${fact?.value}`, `This figure was superseded. Current approved fact: "${fact?.statement}"${fact?.valid_from ? ` (from ${fact.valid_from})` : ""}.`, "major"],
      expired: [`"${excerpt}" relies on an expired fact`, `The approved fact "${fact?.statement}" expired on ${fact?.valid_until}. Ask the fact owner to re-verify it before use.`, "major"],
      contradicts: [`"${excerpt}" doesn't match the approved figure (${fact?.value})`, `The facts library says: "${fact?.statement}". Numbers that differ from approved sources erode trust and may be misleading.`, "major"],
      unverified: [`"${excerpt}" — no approved source for this figure`, `${rule.guideline} Every statistic needs an approved source in the facts library before publication.`, rule.severity],
    }[verdict];
    ctx.findings.push(finding(rule, {
      start: m.start, end, excerpt, message: msgs[0], why: msgs[1], severity: msgs[2],
      rule_id: rule.id, source: factSource || ruleSource(rule),
      suggestion: replacement && verdict !== "expired"
        ? { kind: "replace", replacement, text: `Use the approved figure "${replacement}"` }
        : { kind: "advice", text: verdict === "unverified" ? "Remove the figure, or submit it with a source so the brand team can add it to the facts library." : "Hold this claim until the fact is re-verified." },
    }));
  }
}

/** Keep the author's formatting (%, +, p.a.) when swapping in the approved value. */
function reformat(original, approved) {
  let out = approved.trim();
  if (/\+\s*$/.test(original) && !/\+/.test(out)) out += "+";
  if (/%/.test(original) && !/%/.test(out)) out += "%";
  if (/p\.a\./i.test(original) && !/p\.a\./i.test(out)) out += " p.a.";
  return out;
}

export { SEVERITY_WEIGHT, escapeRe };
