// Labelled evaluation set for Keel's rule engine (Improvement 1: "measured accuracy, not claimed accuracy").
//
// Two parts, reported separately so the easier part can't hide problems in the harder one:
//   1. HANDWRITTEN — realistic drafts written by the team, labelled by hand (what a careful
//      brand reviewer SHOULD flag), including tricky sentences that should NOT be flagged.
//   2. GENERATED   — drafts assembled from a bank of clean sentences and known violations.
//      Labels come from the bank. They test coverage and interactions between rules, but because
//      the bank was written by people who know the rules, they are easier than real content.
//
// A label is { rule, text, n? }: the rule that should fire and the exact text it should point at
// (n = which occurrence, default 1). A prediction counts as correct when it has the same rule and
// its highlighted span overlaps the labelled text. Everything else is a false alarm or a miss.
//
// Brand: the fictional "Fernway" demo kit in server/seed-data.js. Evaluation date: 2026-11-14.

export const EVAL_DATE = "2026-11-14";

// ---------------------------------------------------------------- 1. handwritten
export const HANDWRITTEN = [
  { id: "H01", title: "Diwali email (the demo draft)", format: "markdown", channel: "email",
    body: `# Make this festive season your best one yet!

Join 100,000 customers who already save smarter with FernWay. Our REVOLUTIONARY savings pots earn 7.5% p.a. — guaranteed returns, completely risk-free!

## Why members love it

### Simple
Set a goal in under a minute and we'll leverage smart round-ups to grow it automatically, so that you can reach the things that matter to you and your family this festive season without having to think about it at all.

![](festive-banner.png)

[Click here](https://fernway.example/goals) to start your festive goal today!`,
    expect: [
      { rule: "CLAIM-02", text: "100,000" }, { rule: "TERM-02", text: "customers" },
      { rule: "TERM-01", text: "FernWay" }, { rule: "TONE-02", text: "REVOLUTIONARY" }, { rule: "TONE-04", text: "REVOLUTIONARY" },
      { rule: "TERM-03", text: "savings pots" }, { rule: "CLAIM-02", text: "7.5%" }, { rule: "CLAIM-01", text: "guaranteed returns" },
      { rule: "CLAIM-01", text: "risk-free" }, { rule: "TONE-03", text: "!", n: 2 }, { rule: "TONE-03", text: "!", n: 4 }, { rule: "TONE-01", text: "leverage" },
      { rule: "A11Y-03", text: "Set a goal in under a minute" },
      { rule: "A11Y-01", text: "![](festive-banner.png)" }, { rule: "A11Y-02", text: "Click here" },
    ] },
  { id: "H02", title: "Agency social post with a leak", format: "text", channel: "x",
    body: "Fernway is the #1 savings app in India, rated 4.8 by our users. Our new Fernway Card is coming soon with cashback! Download now.",
    expect: [ { rule: "CLAIM-01", text: "#1" }, { rule: "CLAIM-02", text: "4.8" }, { rule: "TERM-02", text: "users" }, { rule: "CONF-01", text: "Fernway Card" } ] },
  { id: "H03", title: "Clean rate-update email", format: "text", channel: "email",
    body: "Good news: savings goals now earn 7.1% p.a. Rates are variable and may change. Open the app to see your new rate.", expect: [] },
  { id: "H04", title: "Press boilerplate (clean)", format: "text", channel: "press",
    body: "Fernway helps people build steady savings habits with simple savings goals. Founded in 2019, Fernway has more than 120,000 members.", expect: [] },
  { id: "H05", title: "Onboarding tips with example amounts", format: "markdown", channel: "blog",
    body: `## Start small

Save 500 rupees a week for 10 weeks and you'll have 5,000 rupees for the holidays. Set a goal for 12 months if you want a bigger cushion.

## Stay on track

Turn on payday reminders in the app. You can pause a goal at any time.`,
    expect: [] },
  { id: "H06", title: "Support footer with date and phone", format: "text", channel: "email",
    body: "Offer ends 31 December 2026. Questions? Call us on 1800 123 4567 or write to help@fernway.example.", expect: [] },
  { id: "H07", title: "Push notification, too long and hype-y", format: "text", channel: "push",
    body: "Your savings are about to skyrocket! Top up your festive goal today and watch it grow faster than ever before, it only takes a minute in the app.",
    expect: [ { rule: "TONE-02", text: "skyrocket" }, { rule: "CLAIM-01", text: "faster than ever" }, { rule: "CHAN-01", text: "Your savings are about to skyrocket! Top up your festive goal today and watch it grow faster than ever before, it only takes a minute in the app." } ] },
  { id: "H08", title: "SMS within limits (clean)", format: "text", channel: "sms",
    body: "Payday today. Move a little into your savings goal in the Fernway app. Reply STOP to opt out.", expect: [] },
  { id: "H09", title: "Landing page HTML with contrast and palette problems", format: "html", channel: "web",
    body: `<h1>Save without thinking</h1><h3>Simple. Secure. Yours.</h3><img src="hero.png"><p style="color:#c9a0dc;background:#F7F4EC">Guaranteed growth for every member.</p><a href="/start">Read more</a>`,
    expect: [ { rule: "A11Y-04", text: "<h3>" }, { rule: "A11Y-01", text: '<img src="hero.png">' }, { rule: "A11Y-05", text: "color:#c9a0dc;background:#F7F4EC" },
      { rule: "VIS-01", text: "#c9a0dc" }, { rule: "CLAIM-01", text: "Guaranteed" }, { rule: "A11Y-02", text: "Read more" } ] },
  { id: "H10", title: "Product help article (clean, tricky words)", format: "markdown", channel: "blog",
    body: `## Changing your user name

Go to Settings, then Profile. Your user interface language can be changed in the same place. Members who use the web app see the same options.`,
    expect: [] },
  { id: "H11", title: "Study result with source (clean)", format: "text", channel: "blog",
    body: "In our 2026 study, members who set a savings goal saved 18% more in their first six months than members who didn't.", expect: [] },
  { id: "H12", title: "Study result with a wrong figure", format: "text", channel: "blog",
    body: "Members who set a savings goal saved 25% more in their first six months.", expect: [ { rule: "CLAIM-02", text: "25%" } ] },
  { id: "H13", title: "Trust claim after the source expired", format: "text", channel: "web",
    body: "Fernway is the most trusted savings app among first-time savers.", expect: [ { rule: "CLAIM-01", text: "most trusted" } ] },
  { id: "H14", title: "Investor news leak", format: "text", channel: "linkedin",
    body: "Big week for the team: our Series B is almost done and Project Canopy is on track for next year.",
    expect: [ { rule: "CONF-01", text: "Series B" }, { rule: "CONF-01", text: "Project Canopy" } ] },
  { id: "H15", title: "Friendly how-to with 'best'", format: "text", channel: "blog",
    body: "The best way to start is small: pick one goal and add a little every payday.", expect: [] },
  { id: "H16", title: "Safety message done right (clean)", format: "text", channel: "web",
    body: "Your money is held with a licensed partner bank and protected under the applicable deposit insurance scheme.", expect: [] },
  { id: "H17", title: "Safety message overpromising", format: "text", channel: "web",
    body: "Your deposits are 100% safe and you will never lose a rupee.",
    expect: [ { rule: "CLAIM-01", text: "100% safe" }, { rule: "CLAIM-01", text: "never lose" } ] },
  { id: "H18", title: "Instagram caption", format: "text", channel: "instagram",
    body: "New year, new pots! Our users are saving MORE than ever!! Insane growth!",
    expect: [ { rule: "TERM-03", text: "pots" }, { rule: "TERM-02", text: "users" }, { rule: "TONE-04", text: "MORE" }, { rule: "TONE-03", text: "!", n: 2 }, { rule: "TONE-03", text: "!", n: 3 }, { rule: "TONE-03", text: "!", n: 4 }, { rule: "TONE-02", text: "Insane" } ] },
  { id: "H19", title: "Referral SMS (clean)", format: "text", channel: "sms",
    body: "Invite a friend to Fernway and you both get a bonus when they create their first savings goal. T&Cs apply.", expect: [] },
  { id: "H20", title: "Rating post, current figure (clean)", format: "text", channel: "x",
    body: "Thank you! Fernway is rated 4.7/5 on the App Store. Tell us what to build next.", expect: [] },
  { id: "H21", title: "Jargon-heavy partner pitch", format: "text", channel: "web",
    body: "Partner with Fernway to unlock synergy and a best-in-class, frictionless savings experience that will empower your employees.",
    expect: [ { rule: "TONE-01", text: "synergy" }, { rule: "TONE-01", text: "best-in-class" }, { rule: "TONE-01", text: "frictionless" }, { rule: "TONE-01", text: "empower" } ] },
  { id: "H22", title: "Rate without its disclaimer", format: "text", channel: "email",
    body: "Your festive goal now earns 7.1% p.a. Top up before Diwali.", expect: [ { rule: "CLAIM-03", text: "7.1% p.a." } ] },
];

// ---------------------------------------------------------------- 1b. held out
// Written AFTER the engine fixes of 17 Nov 2026 and never used for tuning. If the fixes only
// memorised the handwritten set, it shows up here.
export const HOLDOUT = [
  { id: "X01", title: "Personal goal progress email", format: "text", channel: "email",
    body: "Hi Neha, your goal 'Goa trip' is 80% complete. Add ₹2,000 more by 15 March to get there on time.", expect: [] },
  { id: "X02", title: "Thank-you post with Indian number format", format: "text", channel: "instagram",
    body: "Over 1.2 lakh members now save with Fernway. Thank you for trusting us!", expect: [] },
  { id: "X03", title: "Rate ad overclaiming", format: "text", channel: "ad",
    body: "Earn up to 8% p.a. on your savings goals — the highest rate in India.",
    expect: [{ rule: "CLAIM-02", text: "8%" }, { rule: "CLAIM-01", text: "highest" }] },
  { id: "X04", title: "Vague but harmless", format: "text", channel: "blog",
    body: "We've helped thousands of families save for weddings, school fees and emergencies.", expect: [] },
  { id: "X05", title: "Short push", format: "text", channel: "push", body: "Your Diwali goal is ready. Tap to top up.", expect: [] },
  { id: "X06", title: "Partial codename leak", format: "text", channel: "email",
    body: "Fernway's new Canopy features are coming soon.", expect: [{ rule: "CONF-01", text: "Canopy" }] },
  { id: "X07", title: "Wrong member count, Indian format", format: "text", channel: "web",
    body: "Join 1,50,000 happy savers.", expect: [{ rule: "CLAIM-02", text: "1,50,000" }] },
  { id: "X08", title: "Help link done right", format: "html", channel: "email",
    body: '<p>Questions? Visit <a href="https://fernway.example/help">our help centre</a>.</p>', expect: [] },
  { id: "X09", title: "One-time password SMS", format: "text", channel: "sms",
    body: "FERNWAY: Your OTP is 482913. Do not share it with anyone.", expect: [] },
  { id: "X10", title: "Award claim with hyphen", format: "text", channel: "linkedin",
    body: "Proud to share that Fernway was named one of the fastest-growing fintechs of 2026 by an industry magazine.",
    expect: [{ rule: "CLAIM-01", text: "fastest-growing" }] },
  { id: "X11", title: "Disclaimer before the rate (clean)", format: "text", channel: "email",
    body: "Rates are variable and may change. Your savings goal now earns 7.1% p.a.", expect: [] },
  { id: "X12", title: "Unsourced 'most members'", format: "text", channel: "blog",
    body: "Most of our members save a little every week, and that's the best part.", expect: [{ rule: "CLAIM-02", text: "Most of our members" }] },
  { id: "X13", title: "Rating mention (clean)", format: "text", channel: "web",
    body: "Download the Fernway app – rated 4.7 by members on the App Store.", expect: [] },
  { id: "X14", title: "Old feature name", format: "text", channel: "instagram",
    body: "Our savings pots now come in 3 colours!", expect: [{ rule: "TERM-03", text: "savings pots" }] },
];

// ---------------------------------------------------------------- 2. generated
// Sentences that should produce no findings on their own.
const CLEAN = [
  "Set up a savings goal in a few taps.", "You choose how much to put aside each week.", "Your money is held with a licensed partner bank.",
  "Founded in 2019, Fernway helps people build steady savings habits.", "Members can pause or change a goal at any time.",
  "Open the app to see how close you are to your goal.", "Small, regular amounts add up over time.",
  "Round-ups move spare change into your goal automatically.", "Start your festive goal in the Fernway app.",
  "Turn on reminders so you never miss a payday top-up.", "Invite a friend and save together.", "Your goals, your pace.",
  "More than 120,000 members already save with Fernway.", "Fernway is rated 4.7/5 on the App Store.",
  "Savings goals earn 7.1% p.a. Rates are variable and may change.", "Questions? Our team replies within one working day.",
];
// Known violations and what should be flagged.
const VIOLATIONS = [
  { s: "Join 100,000 customers today.", e: [["CLAIM-02", "100,000"], ["TERM-02", "customers"]] },
  { s: "Our app is rated 4.8 on the App Store.", e: [["CLAIM-02", "4.8"]] },
  { s: "Fernway is the most trusted savings app for first-time savers.", e: [["CLAIM-01", "most trusted"]] },
  { s: "Get guaranteed returns with no risk.", e: [["CLAIM-01", "guaranteed returns"], ["CLAIM-01", "no risk"]] },
  { s: "Members saved 23% more last year.", e: [["CLAIM-02", "23%"]] },
  { s: "We leverage seamless tech to help you save.", e: [["TONE-01", "leverage"], ["TONE-01", "seamless"]] },
  { s: "This is a game changer for your savings.", e: [["TONE-02", "game changer"]] },
  { s: "Watch your savings skyrocket.", e: [["TONE-02", "skyrocket"]] },
  { s: "Project Canopy is coming soon.", e: [["CONF-01", "Project Canopy"]] },
  { s: "Ask us about the Fernway Card.", e: [["CONF-01", "Fernway Card"]] },
  { s: "Saving is SO EASY with Fernway.", e: [["TONE-04", "SO EASY"]] },
  { s: "Create a pot for your holiday.", e: [["TERM-03", "pot"]] },
  { s: "Download the FernWay app.", e: [["TERM-01", "FernWay"]] },
  { s: "We are the #1 savings app.", e: [["CLAIM-01", "#1"]] },
  { s: "It is the fastest way to grow your savings.", e: [["CLAIM-01", "fastest"]] },
  { s: "Your deposits are 100% safe.", e: [["CLAIM-01", "100% safe"]] },
  { s: "Savings goals earn 7.5% p.a.", e: [["CLAIM-02", "7.5%"]] },
  { s: "Our users love the app.", e: [["TERM-02", "users"]] },
  { s: "Utilize round-ups to save more.", e: [["TONE-01", "Utilize"]] },
  { s: "It's a revolutionary way to save.", e: [["TONE-02", "revolutionary"]] },
  { s: "Your festive goal earns 7.1% p.a.", e: [["CLAIM-03", "7.1% p.a."]] },
  { s: "You will never lose a rupee.", e: [["CLAIM-01", "never lose"]] },
  { s: "Join over 1 lakh members.", e: [["CLAIM-02", "1 lakh"]] },
  { s: "Save in jars for every goal.", e: [["TERM-03", "jars"]] },
  { s: "Fernway is the cheapest way to save.", e: [["CLAIM-01", "cheapest"]] },
  { s: "Start today! It only takes a minute!", e: [["TONE-03", "!", 2]] },
  { s: "Get 2% cashback on every top-up.", e: [["CLAIM-02", "2%"]] },
  { s: "[Click here](https://fernway.example/goals) to start.", md: true, e: [["A11Y-02", "Click here"]] },
  { s: "![](goal-banner.png)", md: true, e: [["A11Y-01", "![](goal-banner.png)"]] },
];

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); }

export function generated(count = 90, seed = 7) {
  const rand = rng(seed);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const out = [];
  for (let i = 0; i < count; i++) {
    const nViol = rand() < 0.15 ? 0 : rand() < 0.6 ? 1 : 2;
    const parts = [pick(CLEAN), pick(CLEAN)].filter((x, k, a) => a.indexOf(x) === k).map((s) => ({ s, e: [] }));
    const used = new Set();
    for (let k = 0; k < nViol; k++) {
      let v; do v = pick(VIOLATIONS); while (used.has(v.s));
      used.add(v.s);
      parts.splice(Math.floor(rand() * (parts.length + 1)), 0, { ...v, e: [...v.e] });
    }
    const md = parts.some((p) => p.md);
    // the clean rate sentence carries the disclaimer, which satisfies CLAIM-03 for the whole draft
    const hasDisclaimer = parts.some((p) => p.s.includes("Rates are variable"));
    if (hasDisclaimer) for (const p of parts) p.e = p.e.filter(([rule]) => rule !== "CLAIM-03");
    const body = parts.map((p) => p.s).join(md ? "\n\n" : " ");
    out.push({ id: `G${String(i + 1).padStart(3, "0")}`, title: `Generated draft ${i + 1}`, format: md ? "markdown" : "text", channel: "email", body,
      expect: parts.flatMap((p) => p.e.map(([rule, text, n]) => ({ rule, text, n }))) });
  }
  return out;
}
