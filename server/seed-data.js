// Demo brand kit for "Fernway" — a FICTIONAL savings app invented for this demo.
// Any resemblance to a real company is unintended.

export const BRAND_NAME = "Fernway";

export const USERS = [
  { id: "u_aditi", name: "Aditi Rao", email: "aditi@fernway.example", role: "creator", team: "Growth Marketing", title: "Content Marketer" },
  { id: "u_marcus", name: "Marcus Lee", email: "marcus@brightside.example", role: "agency", team: "Brightside (agency)", title: "Agency Copywriter" },
  { id: "u_priya", name: "Priya Nair", email: "priya@fernway.example", role: "reviewer", team: "Compliance", title: "Compliance Reviewer" },
  { id: "u_sam", name: "Sam Okafor", email: "sam@fernway.example", role: "brand_admin", team: "Brand", title: "Head of Brand" },
];

export const RULES = [
  { id: "TERM-01", title: "Brand name spelling", category: "terminology", type: "canonical_spelling", severity: "major",
    guideline: 'Always write our name as "Fernway" — one word, capital F, lowercase w.',
    rationale: "Inconsistent spelling of the brand name weakens recognition and looks careless.",
    config: { canonical: "Fernway", variants: ["Fern way", "Fern-way"] }, example_bad: "FernWay", example_good: "Fernway" },
  { id: "TERM-02", title: 'Say "members", not "customers" or "users"', category: "terminology", type: "term_replace", severity: "minor",
    guideline: 'People who save with us are "members". Avoid "customers" and "users".',
    rationale: "Member-first language is a core brand pillar: we serve people, we don't process users.",
    config: { preferred: "members", variants: ["customers", "customer", "users", "user"], replacements: { customer: "member", user: "member", customers: "members", users: "members" }, ignore_after: ["interface", "experience", "name", "id"] },
    example_bad: "Our customers love it", example_good: "Our members love it" },
  { id: "TERM-03", title: 'Say "savings goals", not "pots" or "jars"', category: "terminology", type: "term_replace", severity: "minor",
    guideline: 'The product feature is called "savings goals".',
    rationale: "Feature names must match the app UI so members can find what we describe.",
    config: { preferred: "savings goals", variants: ["pots", "pot", "jars", "jar", "savings pots"], replacements: { pot: "savings goal", jar: "savings goal" } },
    example_bad: "Create a pot", example_good: "Create a savings goal" },
  { id: "TONE-01", title: "Plain words, no jargon", category: "tone", type: "banned_phrase", severity: "minor",
    guideline: "Write like a knowledgeable friend: plain, specific words. Avoid corporate jargon.",
    rationale: "Jargon makes money feel complicated — the opposite of our promise.",
    config: { phrases: [
      { text: "leverage", suggest: "use" }, { text: "utilize", suggest: "use" }, { text: "synergy", advice: "Say what actually works together." },
      { text: "best-in-class", advice: "Name the specific benefit instead." }, { text: "paradigm", advice: "Describe the change plainly." },
      { text: "seamless", suggest: "simple" }, { text: "frictionless", suggest: "easy" }, { text: "empower", suggest: "help" } ] } },
  { id: "TONE-02", title: "Confident, not hype", category: "tone", type: "banned_phrase", severity: "major",
    guideline: "Be confident and calm. No hype words — money decisions deserve a steady voice.",
    rationale: "Hype undermines trust in a financial brand and often sneaks in unsupported claims.",
    config: { phrases: [
      { text: "revolutionary", suggest: "new" }, { text: "game-changing", suggest: "useful" }, { text: "game changer", suggest: "big help" },
      { text: "insane", suggest: "great" }, { text: "mind-blowing", suggest: "impressive" }, { text: "unbelievable", suggest: "remarkable" },
      { text: "skyrocket", suggest: "grow" }, { text: "get rich", advice: "Never imply quick wealth. Talk about steady progress." } ] } },
  { id: "TONE-03", title: "One exclamation mark, max", category: "tone", type: "max_count", severity: "minor",
    guideline: "Use at most one exclamation mark per piece.",
    rationale: "Excess exclamation marks read as shouting and lower credibility.",
    config: { pattern: "!", max: 1, label: "exclamation marks", replacement: "." } },
  { id: "TONE-04", title: "No shouting in capitals", category: "tone", type: "builtin", severity: "minor",
    guideline: "Don't write words in ALL CAPS for emphasis (acronyms are fine).",
    rationale: "Capitals read as shouting and are harder to read for people with dyslexia; screen readers may spell them out.",
    config: { check: "all_caps", allow: ["FERNWAY"] } },
  { id: "TONE-05", title: "Speak to 'you', warmly", category: "tone", type: "ai", severity: "minor",
    guideline: "Address the reader directly as 'you'. Be warm and encouraging, never patronising, fearful or guilt-tripping about money.",
    rationale: "Fear-based money messaging conflicts with our member-first pillar.", config: {} },
  { id: "MSG-01", title: "Key message pillars", category: "messaging", type: "ai", severity: "info",
    guideline: "Where relevant, content should reinforce at least one pillar: 'Simple' (saving made easy), 'Secure' (your money is protected), 'Member-first' (we're on your side). Never contradict a pillar.",
    rationale: "Consistent pillars build a recognisable brand over time.", config: {} },
  { id: "MSG-02", title: "One clear call to action", category: "messaging", type: "ai", severity: "minor",
    guideline: "Campaign content should have exactly one clear, specific call to action that matches the stated goal.",
    rationale: "Competing CTAs reduce conversion and confuse readers.", config: {} },
  { id: "CLAIM-01", title: "No unsupported superlatives or absolute promises", category: "claims", type: "builtin", severity: "major",
    guideline: "Comparative and superlative claims (best, #1, fastest) need an approved source. Absolute promises (guaranteed, risk-free, never lose) are never allowed.",
    rationale: "Unsubstantiated promotional claims are misleading and expose us to regulatory action.",
    config: { check: "claims",
      absolute: [ { text: "guaranteed returns", suggest: "competitive returns" }, { text: "guaranteed", suggest: "designed" }, { text: "risk-free", advice: "Describe the actual protection instead." },
        { text: "100% safe", suggest: "protected" }, { text: "never lose", advice: "Don't promise outcomes." }, { text: "no risk", advice: "Describe the actual protection instead." } ],
      superlative: [ { text: "the best", suggest: "a great" }, { text: "best", suggest: "great", severity: "minor", confidence: 0.6 }, { text: "#1", suggest: "" }, { text: "number one", suggest: "a leading" },
        { text: "fastest", suggest: "fast" }, { text: "most trusted", suggest: "trusted" }, { text: "highest", suggest: "competitive" }, { text: "cheapest", suggest: "low-cost" }, { text: "leading", advice: "Cite the ranking source or remove." } ] } },
  { id: "CLAIM-02", title: "Every figure needs an approved source", category: "facts", type: "builtin", severity: "major",
    guideline: "Statistics, rates, member counts and ratings must match the approved facts library and be current.",
    rationale: "Outdated or invented numbers are the fastest way to lose credibility.", config: { check: "numeric_claims", ignore_below: 10 } },
  { id: "CLAIM-03", title: "Required disclaimers", category: "claims", type: "builtin", severity: "major",
    guideline: "When content uses an approved fact that carries a disclaimer, the disclaimer must appear.",
    rationale: "Regulated claims are only fair with their qualifying information.", config: { check: "fact_disclaimers" } },
  { id: "CONF-01", title: "Protect confidential information", category: "confidentiality", type: "builtin", severity: "blocker",
    guideline: "Never reference unreleased products, codenames or internal-only facts.",
    rationale: "Leaks of embargoed plans harm launches, partners and market disclosure obligations.", config: { check: "confidential" } },
  { id: "A11Y-01", title: "Images need alt text", category: "accessibility", type: "builtin", severity: "major",
    guideline: "Every meaningful image needs alt text that conveys its purpose.", rationale: "WCAG 2.2 SC 1.1.1 — screen-reader users otherwise miss the content.", config: { check: "alt_text" } },
  { id: "A11Y-02", title: "Descriptive link text", category: "accessibility", type: "builtin", severity: "minor",
    guideline: 'Link text must describe the destination. Never "click here" or "read more" on their own.', rationale: "WCAG 2.2 SC 2.4.4 — links are often read out of context.", config: { check: "link_text" } },
  { id: "A11Y-03", title: "Plain-language readability", category: "accessibility", type: "builtin", severity: "minor",
    guideline: "Aim for reading grade 9 or below and sentences of 28 words or fewer.", rationale: "Plain language serves everyone, including people with cognitive disabilities.", config: { check: "readability", max_sentence_words: 28, max_grade: 9 } },
  { id: "A11Y-04", title: "Logical heading order", category: "accessibility", type: "builtin", severity: "minor",
    guideline: "Headings must not skip levels (H2 → H4).", rationale: "WCAG 2.2 SC 1.3.1 — screen-reader users navigate by headings.", config: { check: "heading_order" } },
  { id: "A11Y-05", title: "Text contrast 4.5:1", category: "accessibility", type: "builtin", severity: "major",
    guideline: "Body text must have at least 4.5:1 contrast with its background.", rationale: "WCAG 2.2 SC 1.4.3.", config: { check: "contrast", min_ratio: 4.5 } },
  { id: "VIS-01", title: "Use the brand palette", category: "visual", type: "builtin", severity: "minor",
    guideline: "Use only colours from the brand palette in graphics and HTML.", rationale: "Colour is the most recognisable part of our identity.", config: { check: "palette", tolerance: 12, max_off_brand_share: 0.45 } },
  { id: "VIS-02", title: "Logo and imagery usage", category: "visual", type: "ai", severity: "major",
    guideline: "Never stretch, recolour or add effects to the logo. Imagery shows real, diverse people in everyday moments — no stock-photo cash piles, gold coins or luxury cars.",
    rationale: "Money-pile imagery suggests get-rich-quick, which contradicts our steady, member-first voice.", config: {} },
  { id: "CHAN-01", title: "Channel length limits", category: "messaging", type: "builtin", severity: "major",
    guideline: "Respect channel limits: X 280, SMS 160, push 120 characters.", rationale: "Truncated messages lose the call to action.", config: { check: "channel_length", limits: { x: 280, sms: 160, push: 120 } } },
];

export const FACTS = [
  { id: "F-001", statement: "Fernway has more than 120,000 members.", value: "120,000+", keywords: ["members", "people", "savers", "member", "customers", "users", "join"], superseded_values: ["100,000", "100k", "1 lakh", "90,000"], source: "Member database export, Sep 2026 (Data team)", valid_from: "2026-09-01", valid_until: "2027-03-31" },
  { id: "F-002", statement: "Savings goals earn 7.1% p.a. (variable).", value: "7.1%", keywords: ["interest", "p.a.", "rate", "earn", "savings goal", "savings goals", "returns"], superseded_values: ["7.5%", "7.5", "6.8%"], source: "Rate sheet RS-2026-10, effective 1 Oct 2026", valid_from: "2026-10-01", valid_until: "2027-01-31", required_disclaimer: "Rates are variable and may change." },
  { id: "F-003", statement: "Fernway was founded in 2019.", value: "2019", keywords: ["founded", "since", "established"], source: "Certificate of incorporation" },
  { id: "F-004", statement: "Fernway is rated 4.7/5 on the App Store.", value: "4.7", keywords: ["rated", "rating", "app store", "stars", "reviews"], superseded_values: ["4.8", "4.5"], source: "App Store Connect, 31 Oct 2026", valid_from: "2026-10-31", valid_until: "2027-01-31" },
  { id: "F-005", statement: "Members who set a savings goal saved 18% more in their first six months than members who didn't.", value: "18%", keywords: ["saved", "save more", "more", "savings goal", "first six months"], source: "Fernway Insights study 2026, n=2,400 members", valid_from: "2026-06-01", valid_until: "2027-06-01" },
  { id: "F-006", statement: "Deposits are held with a licensed partner bank and protected under the applicable deposit insurance scheme.", value: null, keywords: ["protected", "safe", "secure", "insured", "insurance"], source: "Partner bank agreement §4.2 (Legal)" },
  { id: "F-007", statement: "Fernway is the most trusted savings app among first-time savers in the 2026 Fernway Member Survey.", value: null, keywords: ["most trusted", "first-time savers"], source: "2026 Member Survey (internal, n=3,100) — approved for use with source line", valid_until: "2026-10-31" },
  { id: "F-900", statement: "Fernway Card (codename Project Canopy) launches in Q1 2027 with 2% cashback.", value: "Q1 2027", keywords: ["card", "cashback", "canopy", "credit card", "debit card"], source: "Product roadmap (internal)", confidential: 1 },
];

export const ASSETS = [
  { id: "C-FERN", kind: "color", name: "Fern Green", value: "#1F6F4A", usage: "Primary. Buttons, headlines, key graphics." },
  { id: "C-MOSS", kind: "color", name: "Moss", value: "#A7D7B8", usage: "Secondary fills and illustrations." },
  { id: "C-INK", kind: "color", name: "Ink", value: "#14211B", usage: "Body text." },
  { id: "C-PAPER", kind: "color", name: "Paper", value: "#F7F4EC", usage: "Backgrounds." },
  { id: "C-SUN", kind: "color", name: "Sunrise", value: "#F2A541", usage: "Accent only — max 10% of a layout. Never for text." },
  { id: "T-HEAD", kind: "font", name: "Headline font", value: "Fraunces", usage: "Headlines only." },
  { id: "T-BODY", kind: "font", name: "Body font", value: "Inter", usage: "Body copy and UI." },
  { id: "L-PRIMARY", kind: "logo", name: "Primary logo", value: "fernway-logo-primary.svg", usage: "Min width 96px. Clear space = height of the 'F'. Never recolour or stretch." },
  { id: "D-BOILER", kind: "boilerplate", name: "About Fernway", value: "Fernway helps people build steady savings habits with simple savings goals. Founded in 2019, Fernway has more than 120,000 members.", usage: "Press releases and partner pages." },
  { id: "D-CANOPY", kind: "boilerplate", name: "Canopy launch messaging (draft)", value: "INTERNAL DRAFT — not for use until launch.", usage: "Embargoed.", confidential: 1 },
];

export const CONFIDENTIAL = [
  { id: "K-1", term: "Project Canopy", reason: "Internal codename for an unreleased product.", until: "2027-03-01" },
  { id: "K-2", term: "Fernway Card", reason: "Unannounced product.", until: "2027-03-01" },
  { id: "K-3", term: "Series B", reason: "Funding round under NDA.", until: null },
];

// --- Demo content -----------------------------------------------------------
export const DEMO_DRAFTS = [
  {
    title: "Diwali savings push — email", channel: "email", format: "markdown", author: "u_aditi",
    intent: { goal: "Get existing members to create a festive savings goal", audience: "Existing members, 25–40", cta: "Create a festive savings goal" },
    body: `# Make this festive season your best one yet!

Join 100,000 customers who already save smarter with FernWay. Our REVOLUTIONARY savings pots earn 7.5% p.a. — guaranteed returns, completely risk-free!

## Why members love it

### Simple
Set a goal in under a minute and we'll leverage smart round-ups to grow it automatically, so that you can reach the things that matter to you and your family this festive season without having to think about it at all.

![](festive-banner.png)

[Click here](https://fernway.example/goals) to start your festive goal today!`,
  },
  {
    title: "App rating social post", channel: "x", format: "text", author: "u_marcus",
    intent: { goal: "Celebrate app rating", audience: "Prospects on X", cta: "Download the app" },
    body: "Fernway is the #1 savings app in India, rated 4.8 by our users. Our new Fernway Card is coming soon with cashback! Download now.",
  },
  {
    // already submitted, so the reviewer has something waiting the moment they sign in
    title: "Diwali referral SMS", channel: "sms", format: "text", author: "u_aditi", status: "in_review", reviewer: "u_priya",
    intent: { goal: "Get members to refer a friend before Diwali", audience: "Existing members", cta: "Refer a friend" },
    body: "Refer a friend this Diwali and you both get a bonus. It's risk-free and the fastest way to grow your savings! T&Cs apply.",
  },
];

// Historical submissions used to populate Insights (clearly marked seeded=1 in the DB).
export const HISTORY_TEMPLATES = [
  { title: "Salary-day reminder push", channel: "push", format: "text", body: "Payday! Move a little into your savings goal today — future you will thank you." },
  { title: "Blog: 5 habits of steady savers", channel: "blog", format: "markdown", body: "## Habit 1\nOur customers who automate saving tend to stick with it. Utilize round-ups to make it seamless." },
  { title: "Partner page copy", channel: "web", format: "html", body: "<h2>Why Fernway</h2><p style=\"color:#9bbfa9;background:#F7F4EC\">The best savings app for families, with 100,000 members.</p><a href=\"/x\">Read more</a>" },
  { title: "Referral SMS", channel: "sms", format: "text", body: "Invite a friend to Fernway and you both get a bonus when they create their first savings goal. T&Cs apply." },
  { title: "Instagram caption — goals", channel: "instagram", format: "text", body: "New year, new pots! Our users are saving MORE than ever!! Insane growth!" },
  { title: "Landing page hero", channel: "web", format: "html", body: "<h1>Save without thinking</h1><h3>Simple. Secure. Yours.</h3><img src=\"hero.png\"><p>Guaranteed growth for every member.</p>" },
  { title: "Press release boilerplate", channel: "press", format: "text", body: "Fernway helps people build steady savings habits with simple savings goals. Founded in 2019, Fernway has more than 120,000 members." },
  { title: "Rate update email", channel: "email", format: "text", body: "Good news: savings goals now earn 7.1% p.a. Rates are variable and may change." },
  { title: "App release notes", channel: "web", format: "text", body: "What's new: users can now rename a savings goal from the home screen." },
  { title: "Member story: Riya", channel: "blog", format: "text", body: "\"Fernway is the best thing I did for my savings this year,\" says Riya, a member since 2024." },
  { title: "Testimonial carousel", channel: "instagram", format: "text", body: "\"The fastest way I've found to save for my sister's wedding,\" says Arjun, a member in Pune." },
];
