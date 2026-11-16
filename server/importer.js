// Deterministic style-guide importer: turns common guideline sentences into checkable rules.
// Works offline; the AI importer (ai.js) handles freer prose. Output is always a PROPOSAL
// that a brand admin reviews before anything is saved.
const strip = (s) => s.replace(/^[\s\-*•\d.)]+/, "").trim();
const unq = (s) => s.trim().replace(/^["'“‘]|["'”’.,;]$/g, "").replace(/^["'“‘]|["'”’]$/g, "").trim();
const list = (s) => s.split(/,|\bor\b|\/|;/i).map(unq).filter((x) => x && x.length < 40);

export function importGuidelines(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = strip(raw);
    if (line.length < 4 || /^#/.test(raw.trim())) continue;
    let m;
    if ((m = line.match(/^(?:use|say|write|prefer)\s+(.+?)\s*(?:,\s*)?(?:not|instead of|rather than|\(not)\s+(.+?)\)?\.?$/i))) {
      rules.push({ title: `Say "${unq(m[1])}"`, category: "terminology", type: "term_replace", severity: "minor", guideline: line, preferred: unq(m[1]), avoid: list(m[2]) });
    } else if ((m = line.match(/^(.+?)\s+instead of\s+(.+?)\.?$/i))) {
      rules.push({ title: `Say "${unq(m[1])}"`, category: "terminology", type: "term_replace", severity: "minor", guideline: line, preferred: unq(m[1]), avoid: list(m[2]) });
    } else if ((m = line.match(/^(?:avoid|never say|never use|don'?t say|don'?t use|do not use|banned(?: words)?)\s*:?\s*(.+?)\.?$/i))) {
      rules.push({ title: `Avoid ${list(m[1]).slice(0, 2).map((x) => `"${x}"`).join(", ")}`, category: "tone", type: "banned_phrase", severity: "minor", guideline: line, preferred: "", avoid: list(m[1]) });
    } else if (line.split(" ").length >= 5) {
      rules.push({ title: line.length > 48 ? line.slice(0, 45) + "…" : line, category: /tone|voice|friendly|warm|formal/i.test(line) ? "tone" : "messaging", type: "ai", severity: "minor", guideline: line, preferred: "", avoid: [] });
    }
  }
  return rules;
}

/** Convert an imported proposal into a stored rule row config. */
export function proposalToRule(p, id) {
  const config =
    p.type === "term_replace" ? { preferred: p.preferred, variants: p.avoid, replacements: {} }
    : p.type === "banned_phrase" ? { phrases: p.avoid.map((t) => ({ text: t, advice: "Rephrase per the style guide." })) }
    : {};
  return { id, title: p.title, category: p.category, type: p.type, severity: p.severity, guideline: p.guideline, rationale: "Imported from style guide", config };
}
