// Regenerates the small binary fixtures used by test/intake.test.js.
// Usage: node test/fixtures/make-fixtures.mjs   (needs local Edge or Chrome)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const exe = [process.env.BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"]
  .filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();

// 1) two-page PDF brochure
await page.setContent(`<html><body style="font-family:Arial;font-size:16px">
  <h1>Fernway savings brochure</h1><p>Join 100,000 customers who save with Fernway.</p>
  <div style="break-after:page"></div>
  <h2>Why Fernway</h2><p>Our savings goals offer guaranteed returns and they are completely risk-free.</p>
  </body></html>`);
await page.pdf({ path: path.join(here, "brochure.pdf"), format: "A5" });

// 2) image with text (for OCR) — a banner graphic
await page.setViewport({ width: 900, height: 260 });
await page.setContent(`<html><body style="margin:0;background:#ffffff">
  <div style="width:900px;height:260px;display:flex;align-items:center;justify-content:center;font:bold 54px Arial;color:#111">
  GUARANTEED RETURNS FOR EVERY USER</div></body></html>`);
const png = await page.screenshot({ type: "png" });
fs.writeFileSync(path.join(here, "banner.png"), png);
await browser.close();

// 3) minimal two-slide .pptx with an image on slide 2
const zip = new JSZip();
const slide = (paras) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>
<p:sp><p:txBody>${paras.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/></Types>`);
zip.file("ppt/slides/slide1.xml", slide(["Fernway for families", "Our REVOLUTIONARY app helps you leverage savings pots."]));
zip.file("ppt/slides/slide2.xml", slide(["Join the Fernway Card waitlist &amp; get cashback"]));
zip.file("ppt/slides/_rels/slide2.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`);
zip.file("ppt/media/image1.png", png);
fs.writeFileSync(path.join(here, "deck.pptx"), await zip.generateAsync({ type: "nodebuffer" }));
console.log("Fixtures written to", here);
