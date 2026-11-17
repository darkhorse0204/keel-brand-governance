# Round 2 submission answers: Grinders

Only the team leader (Shivani) submits. Before submitting, open every link in a private/incognito window.

---

**Working project link**
(paste your Render link, e.g. https://keel-brand-governance.onrender.com)

**Source-code repository link**
(paste your public GitHub link)

**Updated project PDF**
(paste the Google Drive link to Grinders-Keel-Round2.pdf, shared as "Anyone with the link → Viewer")

---

**List of completed features**

1. Sign-in screen with four demo people (writer, agency, reviewer, brand admin), a 3-minute guide, and a "Reset demo data" button. No sign-up needed.
2. Brand kit: rules with versions and change history, approved facts (source, valid dates, old values, required warning text), colours, fonts, logos, standard text, and a list of secret terms. Admins can import a style guide as suggested rules.
3. Content intake: paste text, Markdown or HTML, or upload Word (.docx), PDF, PowerPoint (.pptx) and images. Text inside images can be read with OCR.
4. Live check while typing, and a full check on save.
5. 17 rule checks: preferred words, brand spelling, jargon and hype, exclamation marks, capitals, numbers against approved facts (out of date, expired, wrong, no source), promises like "risk-free", missing warning text, secret terms, reading level, image descriptions, link text, heading order, colour contrast, brand colours and channel length.
6. Optional AI checks with Google Gemini (gemini-3.1-flash-lite by default, about 500 free requests a day, with fallback models): tone, key messages, call to action, hidden claims, image review and rewrites that keep the meaning. Secret words are hidden first, and AI findings that don't quote the real text or name a real rule are thrown away.
7. Every finding shows what is wrong, why, the exact rule or fact (with ID and version), a suggested fix, rule or AI, confidence, and the page or slide.
8. Apply a fix, edit it first, or reject it with a reason. Only reviewers can override blockers, with a written reason. Decisions carry over to new versions.
9. Approval flow: Draft → In review → Changes requested → Approved → Published, with comments, version comparison and an audit log. Writers can't approve their own work. Editing approved content sends it back to review.
10. Claim list: every number and claim checked against approved facts.
11. Insights: trends, top mistakes, coaching, unclear rules, "clarify this guideline" with before/after results, and measured accuracy.
12. AI and privacy page: plain explanation, AI on/off switch, and a log of every AI call.
13. Accuracy test set of 126 labelled drafts, run automatically on every code change with a quality gate.

**Technology and implementation details**

React 18 + Vite (frontend), Node.js 24 + Express (backend), SQLite built into Node.js (database), Google Gemini via the @google/genai SDK with JSON-schema answers checked by zod (optional AI), mammoth / pdf.js / jszip (Word, PDF, PowerPoint), Tesseract OCR running on our server (text in images), node:test + a headless-browser test + a labelled accuracy set (testing), GitHub Actions (CI) and Render (hosting).

How it works: a rule engine checks content against the brand kit and always gives the same answer, offline. Each finding is built from a stored rule or fact, so it always shows its source. Markup and page markers are blanked out with spaces of the same length before checking, so highlights and fixes land on the exact words in any format. The optional AI layer hides secret words before sending, and our server keeps an AI finding only if it names a real rule and quotes the real text. Findings have stable IDs, so decisions carry across versions. Facts have valid dates and old values, so Keel can say "out of date: use 120,000+". Every finding records the rule version, so we can measure whether clarifying a rule reduced dismissals. 48 automated tests and an 18-step browser test pass. Every AI feature was also run against the live Gemini API.

**Explanation of changes made to the original plan**

- AI: we switched the AI provider to Google Gemini, because our team has Gemini access. The safety design is the same.
- The three improvements we planned for Rounds 2 and 3 (accuracy test set, guideline clarification loop, PDF/PowerPoint/OCR) are all finished in Round 2, so we chose three new ones for Round 3.
- For text in images we used OCR on our own server instead of AI vision, so images stay private and it works without an AI key.
- We added a set of test drafts never used for tuning, after our tuned score reached 100%, which we didn't trust. On those new drafts the score is 57% precision and 57% recall: our honest number.
- The user interviews planned for Round 2 are moved to Round 3; we spent Round 2 making the product work end to end.
- We added a guide on the sign-in screen, a "Try this" box for each role, a draft waiting for the reviewer and a reset button, so judges can use it without help.
- Hosting uses Render's Node.js service instead of a Docker container; it is simpler on the free plan.

**Three major improvements we will complete in Round 3**

1. Alerts when an approved fact changes: when a fact is updated or expires, Keel finds every approved or published piece that uses the old fact, opens a re-review task with the fix filled in, and shows how much live content is out of date.
2. Checks where people write: a Chrome/Edge extension that checks the text box you are typing in (email, LinkedIn, website editors) against the same brand kit, and a pre-publish API with access keys so a website or CMS can block publishing until Keel approves.
3. Learning from reviewer decisions: when people keep rejecting or overriding a rule for the same reason, Keel drafts a rule exception or clearer rule from those decisions (with Gemini), the admin approves it, and the accuracy test set checks it before it goes live. We will also grow the untouched test set to 50+ real drafts from user interviews and fix the gaps it finds.
