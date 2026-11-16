// End-to-end UI walkthrough using the locally installed Edge/Chrome (puppeteer-core).
// Usage: start the app (npm start), then: node test/e2e/ui-walkthrough.mjs [outDir]
// Takes screenshots of each core step and fails loudly if a step breaks.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.KEEL_URL || "http://localhost:8787";
const OUT = process.argv[2] || "docs/screenshots";
fs.mkdirSync(OUT, { recursive: true });
const CANDIDATES = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error("No Chrome/Edge found; set BROWSER=/path/to/chrome");

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = async (name) => { await new Promise((r) => setTimeout(r, 350)); await page.screenshot({ path: path.join(OUT, name + ".png") }); console.log("✓", name); };
const clickText = async (sel, text) => {
  const ok = await page.evaluate((sel, text) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text)); if (el) { el.click(); return true; } return false; }, sel, text);
  if (!ok) throw new Error(`Could not find ${sel} containing "${text}"`);
  await new Promise((r) => setTimeout(r, 500));
};
const login = async (name) => {
  await page.goto(BASE + "/#/", { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("button.persona");
  await clickText("button.persona", name);
  await page.waitForSelector(".sidebar");
};

try {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await shot("01-login");

  // Creator: open the seeded Diwali draft
  await login("Aditi Rao");
  await shot("02-queue-creator");
  await clickText("a", "Diwali savings push");
  await page.waitForSelector(".finding");
  await shot("03-review-workspace");

  // apply the outdated-rate fix -> disclaimer finding appears
  await page.evaluate(() => { const c = [...document.querySelectorAll(".finding")].find((x) => x.textContent.includes("7.5% p.a.")); c.querySelector("button.accent").click(); });
  await new Promise((r) => setTimeout(r, 900));
  const hasDisclaimer = await page.evaluate(() => document.body.textContent.includes("Claim needs its disclaimer"));
  if (!hasDisclaimer) throw new Error("Expected the required-disclaimer finding after using the approved rate");
  await shot("04-after-fix-disclaimer");

  await clickText(".tabs button", "Claim ledger");
  await shot("05-claim-ledger");
  await clickText(".tabs button", "Revisions");
  await shot("06-revision-diff");
  await clickText(".tabs button", "Findings");
  await clickText("button", "Submit for review");
  await shot("07-submitted");

  // Reviewer: approval is gated by blockers
  await login("Priya Nair");
  await clickText("a", "Diwali savings push");
  await page.waitForSelector(".finding");
  const approveDisabled = await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Approve")?.disabled);
  if (!approveDisabled) throw new Error("Approve should be disabled while blockers are open");
  await clickText("button", "Override…");
  await page.type("textarea.input", "Legal confirmed this wording for the festive campaign (ticket LEG-142).");
  await shot("08-override");

  // Admin: insights + brand kit
  await login("Sam Okafor");
  await page.goto(BASE + "/#/insights", { waitUntil: "networkidle0" });
  await page.waitForSelector(".kpi");
  await shot("09-insights");
  await page.goto(BASE + "/#/brand", { waitUntil: "networkidle0" });
  await page.waitForSelector("table.t");
  await shot("10-brand-kit");
  await page.goto(BASE + "/#/new", { waitUntil: "networkidle0" });
  await clickText("button", "Insert sample draft");
  await page.waitForSelector(".findings .finding");
  await shot("11-new-submission-live-check");
  await page.goto(BASE + "/#/ai", { waitUntil: "networkidle0" });
  await shot("12-ai-privacy");

  // ---- Round 2 -------------------------------------------------------------
  const cardShot = async (heading, name) => {
    const el = await page.evaluateHandle((h) => [...document.querySelectorAll(".card")].find((c) => c.querySelector("h2,h3")?.textContent.includes(h)), heading);
    if (!el.asElement()) throw new Error(`No card titled "${heading}"`);
    await el.asElement().scrollIntoView();
    await new Promise((r) => setTimeout(r, 300));
    await el.asElement().screenshot({ path: path.join(OUT, name + ".png") });
    console.log("✓", name);
  };
  // Improvement 1 + 2 on the Insights page (admin)
  await page.goto(BASE + "/#/insights", { waitUntil: "networkidle0" });
  await page.waitForSelector(".kpi");
  await cardShot("Did clarifying the guideline help?", "16-clarification-impact");
  await cardShot("Measured accuracy", "17-accuracy");
  await clickText("button", "Clarify this guideline");
  await page.waitForSelector("textarea");
  await page.evaluate(() => { const t = document.querySelector(".callout textarea"); t.focus(); });
  await page.keyboard.press("End");
  await page.keyboard.type(' This applies to marketing copy. In-app UI labels may say "user".');
  await page.type('input[placeholder^="e.g."]', "Said it doesn't apply to in-app UI labels");
  await cardShot("Guidelines that may be unclear", "18-clarify-form");
  await clickText("button", "Save clarification");
  await page.waitForFunction(() => document.body.textContent.includes("TERM-02") && document.body.textContent.includes("Collecting data"), { timeout: 5000 });

  // Improvement 3: upload a PDF, findings grouped by page (creator)
  await login("Aditi Rao");
  await page.goto(BASE + "/#/new", { waitUntil: "networkidle0" });
  const fileInput = await page.$('input[type=file][accept*=".pdf"]');
  await fileInput.uploadFile(path.resolve("test/fixtures/brochure.pdf"));
  await page.waitForFunction(() => document.querySelector("textarea.mono")?.value.includes("<!-- page: Page 2 -->"), { timeout: 15000 });
  await page.$eval('input[placeholder^="e.g. Diwali"]', (el) => { el.value = ""; });
  await page.type('input[placeholder^="e.g. Diwali"]', "Savings brochure (PDF)");
  await clickText("button", "Save draft & run full check");
  await page.waitForSelector(".pagebreak");
  await page.waitForSelector(".chip.page");
  await shot("14-pdf-by-page");

  // OCR: read the words on a banner image and check them
  await page.goto(BASE + "/#/new", { waitUntil: "networkidle0" });
  await page.type('input[placeholder^="e.g. Diwali"]', "Festive banner");
  await page.type("textarea.mono", "New festive banner for members.");
  const imgInput = await page.$('input[type=file][accept^="image/png"]');
  await imgInput.uploadFile(path.resolve("test/fixtures/banner.png"));
  await page.waitForSelector("img.thumb");
  await clickText("button", "Read text in image (OCR)");
  await page.waitForFunction(() => document.querySelector("textarea.mono")?.value.includes("GUARANTEED"), { timeout: 30000 });
  await page.waitForFunction(() => document.body.textContent.includes("absolute promise"), { timeout: 5000 });
  await shot("15-ocr-image-text");

  // Agency: confidential material hidden
  await login("Marcus Lee");
  await page.goto(BASE + "/#/brand", { waitUntil: "networkidle0" });
  await page.waitForSelector("table.t");
  const leaks = await page.evaluate(() => document.body.textContent.includes("Project Canopy") || document.body.textContent.includes("2% cashback"));
  if (leaks) throw new Error("Agency user can see confidential material");
  await shot("13-agency-brand-kit");

  if (errors.length) throw new Error("Page errors: " + errors.join(" | "));
  console.log("\nAll UI walkthrough steps passed.");
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "FAILED.png") }).catch(() => {});
  console.error("✗", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
