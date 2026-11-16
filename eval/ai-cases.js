// Cases for the AI layer (judgement rules the rule engine can't check). Only scored with
// `npm run eval -- --ai` and a GEMINI_API_KEY. `scope` lists the rule IDs being judged in the case;
// AI findings for other rules are ignored here (the rule engine set covers those).
export const AI_CASES = [
  { id: "A01", title: "Fear-based money message", format: "text", channel: "email", scope: ["TONE-05"],
    body: "Most people your age are already behind. If you don't start saving today, you'll regret it when an emergency hits.",
    expect: [{ rule: "TONE-05", text: "Most people your age are already behind" }] },
  { id: "A02", title: "Warm, direct message (clean)", format: "text", channel: "email", scope: ["TONE-05"],
    body: "You can start with any amount. Set a small goal today and watch it grow at your own pace.", expect: [] },
  { id: "A03", title: "Guilt-tripping push", format: "text", channel: "push", scope: ["TONE-05"],
    body: "Still spending on takeaway? Your future self is disappointed.",
    expect: [{ rule: "TONE-05", text: "Your future self is disappointed" }] },
  { id: "A04", title: "Two competing calls to action", format: "text", channel: "email", scope: ["MSG-02"],
    intent: { goal: "Get members to create a festive goal", cta: "Create a festive goal" },
    body: "Create a festive goal today. Also, follow us on Instagram, rate us on the App Store and refer three friends this week.",
    expect: [{ rule: "MSG-02", text: "follow us on Instagram, rate us on the App Store and refer three friends this week" }] },
  { id: "A05", title: "One clear call to action (clean)", format: "text", channel: "email", scope: ["MSG-02"],
    intent: { goal: "Get members to create a festive goal", cta: "Create a festive goal" },
    body: "Diwali is three weeks away. Create a festive goal in the app and add a little each payday.", expect: [] },
  { id: "A06", title: "Patronising tone", format: "text", channel: "blog", scope: ["TONE-05"],
    body: "Saving is really not that hard, even for people who are bad with money like you.",
    expect: [{ rule: "TONE-05", text: "even for people who are bad with money like you" }] },
  { id: "A07", title: "Contradicts the 'Secure' pillar", format: "text", channel: "web", scope: ["MSG-01"],
    body: "We move fast and sometimes break things, so keep a backup of your savings somewhere else.",
    expect: [{ rule: "MSG-01", text: "keep a backup of your savings somewhere else" }] },
  { id: "A08", title: "Supports the pillars (clean)", format: "text", channel: "web", scope: ["MSG-01", "TONE-05"],
    body: "Saving made simple: your money is held with a licensed partner bank, and you're always in control of your goals.", expect: [] },
];
