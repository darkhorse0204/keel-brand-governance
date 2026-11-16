# Keel: Round 2 report

Team **Grinders**: Shivani Jogiya (team leader), Ansh Jerath. CodeZen India, Inkloom AI problem statement.

In Round 1 we committed to three improvements. This page shows what we built for each one, how to see it in the app, and what the numbers say, including the parts that are not good yet.

---

## Improvement 1: measured accuracy, not claimed accuracy

**What we built**
- A labelled test set in `eval/` with **126 drafts** and **167 labelled problems**, in three groups:
  - **22 realistic drafts** written and labelled by hand (emails, social posts, SMS, a landing page, press text), including tricky sentences that should *not* be flagged.
  - **14 held-out drafts** written *after* we finished tuning, and never used for tuning. This is the fairest test.
  - **90 generated drafts** built from a bank of clean sentences and known mistakes. They are easier, so we report them separately.
- `npm run eval` scores the rule engine: **precision** (of the things Keel flagged, how many were real problems) and **recall** (of the real problems, how many Keel flagged), per rule and per severity. It writes [eval-report.md](eval-report.md), listing every error.
- A **quality gate**: the build fails if fewer than 90% of blocker flags are correct. It runs in GitHub Actions on every push.
- The latest results appear in the app: **Insights → Measured accuracy**.

**What the numbers say**

| Test set | Precision | Recall |
|---|---|---|
| Realistic drafts, before our fixes (baseline) | 76% | 96% |
| Realistic drafts, after our fixes | 100% | 98% |
| **Held-out drafts (never used for tuning)** | **57%** | **57%** |
| Blocker-level flags, all sets | 100% | 100% |

**What we learned**
- The test set found real false alarms that we then fixed: dates, phone numbers, durations ("12 months") and example amounts ("save ₹500 a week") were being flagged as unsourced statistics; "the best way to start" was flagged as a product claim; the brand name inside an email address was flagged as a misspelling; "Reply STOP" was flagged as shouting.
- The jump to 100% on the realistic set partly reflects that we tuned on it. The **held-out score (57%) is the honest estimate** for new content. It shows four gaps we have **not** fixed yet, on purpose, so the held-out set stays fair:
  - partial codenames ("Canopy" without "Project");
  - hyphenated superlatives ("fastest-growing");
  - a sender name in capitals ("FERNWAY:");
  - a one-time password treated as a statistic.
- Blocker flags (absolute promises, confidential leaks) were correct every time in all sets.

## Improvement 2: closing the guideline loop

**What we built**
- Every rule change is saved in a **rule history** (old wording, new wording, who, when, and why).
- Every finding remembers **which version of the rule** raised it.
- On **Insights**, each "guideline that may be unclear" has a **Clarify this guideline** button. The brand admin rewrites the rule with examples and says what they clarified.
- A new card, **"Did clarifying the guideline help?"**, compares how often people dismissed the rule before and after the change. It waits for at least 5 decisions before giving a verdict, and labels small samples as early signals.
- After a clarification, old dismissals no longer count against the rule, so it leaves the "unclear" list until new evidence builds up.

**Demo data (made up, labelled "demo history")**
- CLAIM-01 was clarified to say when approved member quotes are allowed.
- Dismissals went from **50% (4 decisions) to 17% (6 decisions)**.
- This only shows how the feature works. Real numbers will come from real use.

## Improvement 3: more formats (PDF, PowerPoint, text in images)

**What we built**
- **PDF upload:** text is read page by page. Lines broken by the layout are joined back into sentences.
- **PowerPoint (.pptx) upload:** text is read slide by slide, in slide order. There's an option to also read text inside slide images.
- **Text in images (OCR):** "Read text in image" on any attached image reads the words on a banner or poster and adds them to the content, so the same rules check them.
  - OCR runs **on our server** with Tesseract and a bundled English model, so images are not sent to any outside service.
  - Capital letters in image text are treated as design, not shouting.
- **Findings grouped by page:** page dividers in the content, a page chip on every finding (for example "Page 2" or "Slide 3"), and a page filter.
- Page markers are stored inside the text and ignored by the rules. They stay correct when someone edits the document.

**Limits:** scanned PDFs have no text layer (use "Read text in image" on exported pages). Old .ppt files must be saved as .pptx. OCR is English only.

---

## Other changes in Round 2

- **AI provider:** the optional AI reviewer now uses **Google Gemini** (`@google/genai`) instead of the provider named in our Round 1 plan, because the team has a Gemini API key. The safety design is unchanged:
  - secret words are hidden before sending;
  - every AI finding must quote the real text and name a real rule;
  - every call is logged.
  - Model: `gemini-2.5-flash`, which can be changed with `GEMINI_MODEL`.
- **Tests:** 47 automated tests (up from 28) cover the new formats, OCR, the Gemini request and its safety checks (with a fake Gemini client), model fallbacks, duplicate removal, the clarification loop, and each false-alarm fix. A browser walkthrough clicks through 18 steps across all four roles.
- **Live AI check (18 Nov):** every AI feature was run against the real Gemini API. On the 8 labelled AI cases the AI layer scored 100% precision and 100% recall on the first run, and 100% / 80% on the second (one fear-based line missed, one ungrounded finding thrown away). We fixed three problems this found: JSON output needs the `v1beta` API, busy models now fall back to another model, and AI findings that repeat a rule-engine finding are dropped.
- **Continuous integration:** GitHub Actions runs the tests, the accuracy evaluation and the build on every push.

## Round 3: three new improvements

Our first three improvements are finished, so for Round 3 we commit to three new ones:

1. **Alerts when an approved fact changes.** Find approved or published content that uses an updated or expired fact, open a re-review task with the fix filled in, and show how much live content is out of date.
2. **Checks where people write.** A Chrome/Edge extension for any text box, plus a pre-publish API with access keys, so a CMS can block publishing until Keel approves.
3. **Learning from reviewer decisions.** Draft rule exceptions or clearer rules from repeated rejections (with Gemini), approved by an admin and checked against the accuracy test set before they go live. We will also grow the untouched test set to 50+ real drafts from interviews and fix the four known gaps.

We will also do the user interviews and the hands-on test planned in Round 1, and grow the AI test cases from 8 to 40 or more so the AI score means more.

## How to check our work

```bash
npm install && npm run build && npm start   # app on http://localhost:8787
npm test                                   # 47 tests
npm run eval                               # accuracy report → docs/eval-report.md
```

Screenshots of the new features are in `docs/screenshots/`:
- `14-pdf-by-page.png`
- `15-ocr-image-text.png`
- `16-clarification-impact.png`
- `17-accuracy.png`
- `18-clarify-form.png`

*Disclosure: parts of the code and this report were written with help from an AI coding assistant. All demo data is fictional.*
