# Keel: brand governance before publication

Keel checks marketing content against an organisation's approved guidelines, facts and assets **before** it is published. Each finding cites the rule or fact behind it, comes with a fix that keeps the writer's intent, and goes through a human approval step.

Built by team **Grinders** (Shivani Jogiya, Ansh Jerath) for the Inkloom AI problem statement at CodeZen India. The demo brand **"Fernway"** is a fictional savings app; all demo data is invented.

**Round 2 additions** (the three improvements committed in our Round 1 plan) are summarised in [docs/ROUND2.md](docs/ROUND2.md).

---

## Quick start

```bash
npm install
npm run build      # builds the React app into dist/
npm start          # http://localhost:8787  (seeds a demo workspace on first run)
```

Development with hot reload: `npm run dev` (API on :8787, UI on :5173).
Reset demo data: `npm run seed`.
Docker: `docker build -t keel . && docker run -p 8787:8787 -v keel-data:/data -e GEMINI_API_KEY=... keel`

**AI is optional.** Without a key, Keel runs in rules-only mode and every core workflow works. To turn on the AI reviewer (Google Gemini):

```bash
cp .env.example .env        # then put your key in .env: GEMINI_API_KEY=...
npm start                   # npm start / dev / eval read .env automatically
```

Get a key at https://aistudio.google.com/apikey. The default model is `gemini-3.1-flash-lite`. If it is busy, out of quota or missing, Keel falls back to `gemini-3.5-flash-lite`, `gemini-2.5-flash` and `gemini-3.5-flash` in turn (change with `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS`). On Google's free tier the Flash-Lite models allow about 500 requests a day each and the Flash models only about 20; a model that hits its daily limit is skipped until it resets.

### Demo accounts (pick on the sign-in screen)

| Person | Role | Try this |
|---|---|---|
| Aditi Rao | Creator | Open **Diwali savings push**. Apply fixes and watch the required-disclaimer finding appear after you use the approved rate. Upload `test/fixtures/brochure.pdf` or `deck.pptx` on **New submission** to see findings grouped by page. |
| Marcus Lee | Agency partner | Open **App rating social post**: the unannounced "Fernway Card" is blocked. Check the Brand kit: confidential items are hidden. |
| Priya Nair | Reviewer | Try to approve Aditi's submission: blocked until blockers are fixed or overridden with a justification. |
| Sam Okafor | Brand admin | **Insights**: "Guidelines that may be unclear" → **Clarify this guideline**; "Did clarifying the guideline help?"; "Measured accuracy". |

---

## What it does

- **Brand kit as data:** versioned rules (terminology, spelling, banned phrases, frequency limits, required wording, built-in checks, AI-judged guidelines) with a change history; approved facts with source, validity window, superseded figures and required disclaimers; palette, fonts, logos, boilerplate; a confidential register. Style-guide import (offline parser or AI) produces *proposals* that an admin accepts.
- **Formats:** plain text, Markdown, HTML (sandboxed preview), Word `.docx`, **PDF**, **PowerPoint `.pptx`** (findings grouped by page or slide), and images (alt text, palette analysis in the browser, and **text inside images read with OCR** and checked by the same rules).
- **Rule engine** (offline, same result every time): terminology, brand-name spelling, jargon and hype words, exclamation limits, ALL-CAPS, figures vs facts (supported / outdated / expired / contradicts / unsourced), absolute promises and superlatives, required disclaimers, confidential leaks, alt text, link text, heading order, contrast (WCAG 4.5:1), palette (CIE ΔE), reading level, channel length.
- **AI reviewer** (optional, Google Gemini): tone, message pillars, CTA clarity, implied claims and intent alignment; image review with suggested alt text; rewrites that keep intent, re-checked by the rule engine before they're shown.
- **Explained findings:** highlighted in place, with what / why / source (ID, exact wording, version) / before→after fix / engine / confidence / page.
- **Human control:** apply, edit-then-apply, or dismiss with a reason. Only reviewers can override blockers, with a written justification. Authors can't approve their own work. Editing approved content sends it back to review. Decisions carry across revisions.
- **Workflow:** Draft → In review → (Changes requested) → Approved → Published, with comments, revision diffs and an audit trail.
- **Insights:** issues per submission over time, issues by category, top issues, coaching opportunities, *unclear guidelines* (high dismissal rate plus the reasons people gave), **clarify a guideline and see whether dismissals drop afterwards**, **measured accuracy** from the labelled test set, claim ledger, channel comparison, rule-vs-AI acceptance.
- **AI & privacy page:** plain-language disclosure, workspace AI switch, and a log of every AI call (metadata only).

## Architecture

```
React (Vite)  ──►  Express API (role checks on the server)
                    ├── engine/        deterministic checks (pure functions)
                    ├── intake.js      PDF (pdf.js), PowerPoint (zip + XML), OCR (Tesseract, on-server)
                    ├── ai.js          redact → Gemini (JSON schema output) → ground → log
                    ├── review.js      orchestration, fingerprints, carry decisions, apply fixes
                    ├── insights.js    governance analytics, clarification before/after
                    └── db.js          SQLite (node:sqlite): brand kit + rule history, submissions,
                                       revisions, findings (with rule version), claims, events, ai_log
eval/              labelled test set + runner (precision/recall, quality gate) — runs in CI
```

### Key technical decisions

1. **Deterministic first, AI second.** Most governance rules can be stated exactly, so they are code plus data: fast, free, explainable and usable offline. AI handles only what needs judgement, and the product still works when AI is off or unavailable.
2. **"No receipt, no finding."** The model gets the list of rule IDs and must return `rule_id` plus a verbatim `quote`. `groundFindings()` drops anything citing an unknown rule, quoting text that isn't present, or below a confidence floor. Discards are counted and shown. (Unit tested, including against a fake Gemini client.)
3. **Same-length markup masking.** HTML tags, Markdown link targets and page markers are replaced with spaces of identical length before prose checks. Rules never match inside markup, and positions map 1:1 onto the original text, which makes highlighting and one-click fixes safe in every format.
4. **Pages live in the text.** PDF and PowerPoint text is stored with markers like `<!-- page: Slide 3 -->`. The engine ignores them; the UI turns them into dividers and page chips. Because they are part of the text, they stay correct when someone edits the document.
5. **Stable fingerprints** (`rule | normalised excerpt | occurrence`) carry dismissals and overrides across revisions, and mark disappeared issues as *resolved*.
6. **Facts have a lifecycle.** Validity dates and superseded figures let Keel say "outdated: use 120,000+" instead of a generic "unsupported".
7. **Rules have a history.** Every rule edit is recorded, and every finding stores the rule version that raised it, so a clarified rule can be judged on before vs after.
8. **Redaction before any external call:** confidential-register terms, emails and phone numbers become `[REDACTED_n]` and are restored afterwards. Confidential facts and assets are never sent. OCR and document parsing run on our server.
9. **SQLite via `node:sqlite`:** no native build step and no database server; one file to back up. Additive migrations run on start-up.

### AI usage details

- SDK: `@google/genai`. Model: `gemini-3.1-flash-lite` by default, with Flash-Lite and Flash fallbacks (override with `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS`).
- Structured output: `responseMimeType: "application/json"` with `responseJsonSchema`, then validated again with `zod`.
- Blocked prompts or safety stops are reported as "the AI declined"; API errors (bad key, quota, missing model, outage) become plain messages. The rule engine is never blocked by AI failures.
- **Tested both ways.** Automated tests use a fake Gemini client (request shape, redaction, grounding, fallbacks, quota handling, error handling). We also ran every AI feature against the live Gemini API on 17 Nov 2026: AI review, rewrite, image review and style-guide import all worked. With the default model (gemini-3.1-flash-lite), the AI layer found all 5 labelled problems in every one of 4 runs on our 8 AI test cases (100% recall). Precision was 83%, 83%, 100% and 100%: in two runs it raised one extra flag on the "one clear call to action" rule. The slower gemini-2.5-flash scored 100% / 100% and 100% / 80% on two earlier runs. Eight cases is a small sample.
- Live testing found and fixed four things: the SDK must use the `v1beta` API for JSON output, busy or exhausted models need fallbacks (the free tier allows only about 20 Flash requests a day, about 500 for Flash-Lite), and the AI sometimes repeated problems the rule engine had already flagged, sometimes under a different rule. Those repeats are now dropped.

## Testing and accuracy

```bash
npm test                   # 48 unit + API tests (node:test), including PDF/PowerPoint/OCR fixtures
npm run eval               # accuracy on the labelled test set → docs/eval-report.md (fails if blocker precision < 90%)
npm run eval -- --ai       # also score the AI layer (needs GEMINI_API_KEY)
npm start & npm run e2e    # headless Edge/Chrome walkthrough (18 steps), writes docs/screenshots/*.png
```

GitHub Actions (`.github/workflows/ci.yml`) runs the tests, the accuracy evaluation and the build on every push.

Latest accuracy (rule engine): see [docs/eval-report.md](docs/eval-report.md). On drafts **never used for tuning** it is currently 57% precision and 57% recall (14 drafts), which is the honest number to quote. On the sets used during development it is 98–100%.

## Libraries and services

React 18, Vite 6, Express 4, `@google/genai`, zod, mammoth (docx), pdfjs-dist (PDF), jszip (PowerPoint), tesseract.js + `@tesseract.js-data/eng` (OCR, English model bundled), concurrently (dev), puppeteer-core (tests, fixtures and PDF rendering only). External service: Google Gemini API (optional). No third-party datasets; demo data is fictional and labelled "demo history" in the UI.

## Known limitations

- **Demo sign-in** (pick a user, no password). Production needs SSO/OIDC, expiring hashed tokens and rate limiting.
- English only (rules and OCR). The number parser understands Indian formats (lakh/crore).
- Scanned PDFs have no text layer; export those pages as images and use "Read text in image". Old `.ppt` files must be saved as `.pptx`.
- Known rule-engine misses on new content (from the held-out set): partial codenames ("Canopy" without "Project"), hyphenated superlatives ("fastest-growing"), sender IDs in capitals, one-time-password numbers.
- Tone and messaging checks need the AI layer; in rules-only mode those guidelines are shown but not evaluated.
- The guideline before/after comparison needs at least 5 decisions on the new version, and small samples are labelled as early signals.
- Single workspace and single SQLite file; no multi-tenant isolation yet.

## Project provenance and disclosures

- Development started on **14 Nov 2026**; Round 2 work on **17 Nov 2026**. Significant parts of the code and documents were written with help from an AI coding assistant. The team reviews the code and records its own contributions.
- The AI provider inside the product changed to **Google Gemini** in Round 2 (the Round 1 plan named a different provider), because the team has access to the Gemini API.
- Templates and boilerplate: none beyond standard Vite/Express setup.
- **Team Grinders:** Shivani Jogiya (team leader: frontend, UX, research, testing, documentation) and Ansh Jerath (backend, rule engine, AI integration, deployment).

## Repository map

```
server/          API, engine, intake (PDF/PowerPoint/OCR), AI layer, seed data
web/             React UI (pages/, components/)
eval/            labelled accuracy test set and runner
test/            unit, integration and e2e tests; fixtures/
docs/            Round 2 report (HTML, Word, PDF), accuracy report, screenshots
.github/         CI workflow
Dockerfile, render.yaml
```
