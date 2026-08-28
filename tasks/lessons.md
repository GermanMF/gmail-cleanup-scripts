# 📚 Lessons Log — Gmail Cleanup Scripts

> Append a new entry at the top after each dev session. Format: `## YYYY-MM-DD — <title>`.
> This file is referenced during session wrap-up by the repo-scoped `gmail-cleanup-operations` skill.

---

## 2026-08-27 — Enable reviewed receipt/order archive rollout

### Context

Receipt and order labels were sampled across the exact activation window before
enabling delayed archive. A temporary private rollback boundary preserved both
Inbox membership and original unread state for the bounded first run.

### Verification state

- `ENABLE_DOCUMENT_RECORD_ARCHIVE` is enabled; retention Trash remains disabled.
- The controlled `runInboxRules` execution completed without reported errors.
- Eligible records were archived and marked read while real-attachment records
  remained in Inbox under the runtime protection.
- The hourly trigger inventory was unchanged and no purge trigger was added.
- `npm test -- --runInBand` passed all 158 tests after updating rollout-state assertions.

## 2026-08-27 — Retire catch-all Routine Updates and cover live finance domains

### Context

A complete live review found that `Auto/LowValue/Routine Updates` duplicated
Gmail's Updates category and mixed security, action-required, financial,
document, travel, and developer mail. The lane was retired, explicit rules were
strengthened, and observed `uala.mx` and `mercadopago.com` domains were added.

### Verification state

- `Auto/LowValue/Routine Updates` was removed from 293 conversations and deleted.
- The producer was removed from inbox, backlog, and retention configuration.
- Receipt/order archiving now uses the separate, disabled
  `ENABLE_DOCUMENT_RECORD_ARCHIVE` gate.
- The finance audit found 207 Mercado Pago and 47 Ualá threads missing a child.
- Three label-only batches classified all 254 threads with zero reported
  classification errors and explicitly preserved read/archive state.
- The final audit reports zero missing children for all ten institutions.
- The temporary backfill confirmation token was cleared after completion.

## 2026-08-27 — Retire redundant finance Records lane

### Context

The complete live `Auto/Finance/Records` sample duplicated institution and
subcategory labels and included security/actionable false positives. The user
chose to retire the operational label rather than preserve a cross-institution
archive lane in the visible finance taxonomy.

### Lessons & Patterns

1. **Operational policy should not masquerade as taxonomy.** Institution and
   subcategory labels already describe each financial thread; archive eligibility
   should be derived from explicit categories and safety exclusions.
2. **Broad record words are not sufficient safety evidence.** Phrases such as
   `estado de cuenta` and `retiro` can occur in access alerts and temporary codes.
3. **Retire the producer before deleting its output.** Remove and deploy the rule
   first, then remove the live label without changing read or archive state.

### Verification state

- The complete local suite passes with 145 tests.
- Production no longer contains the `Finance/Records` inbox rule.
- Gmail removed `Auto/Finance/Records` from 26 conversations and deleted the label.
- A final label search returned zero results, while sampled institution/child labels
  and Inbox state remained present.

## 2026-08-27 — Account-specific finance taxonomy consolidation

### Context

A full read-only audit established that the configured BBVA path was empty and
that GBM-origin messages belong to the same institution view as Mercado Pago.
The reviewed label-only consolidation was deployed and executed, followed by
independently gated deletion of empty retired labels and a token-clearing deploy.

### Lessons & Patterns

1. **Account taxonomy overrides a generic institution catalog.** Do not keep an
   empty institution merely because its sender domains are plausible in general.
2. **Consolidation must preserve the full hierarchy.** Migrate each child to the
   same-named Mercado Pago child, add the Mercado Pago parent, and only then
   remove the corresponding GBM label.
3. **Separate migration from deletion.** The deletion entry point refuses to run
   while any retired GBM or BBVA label still has a thread, so an incomplete batch
   cannot destroy its source taxonomy.
4. **Exact repairs should remain exact.** The verified Ualá fix is constrained to
   one normalized subject rather than a broader rule that could move unrelated mail.
5. **An audit must enforce the same evidence gate as its repair.** Subject-only
   counting reported 18 apparent `Otros -> Estados de cuenta` candidates, but the
   repair correctly rejected every one for lacking a current statement document or
   explicit current-document access wording. The audit now applies that same filter.

### Verification state

- The GBM migration completed with 76 label moves for 38 threads and zero errors;
  parent plus same-named child now coexist under Mercado Pago.
- The exact Ualá correction changed one thread with zero errors.
- Four empty retired labels were deleted: BBVA parent, GBM parent, and two GBM children.
- Two newly arrived parent-only threads were backfilled; all 10 institutions report
  zero missing children inside the ten-year lookback.
- Final evidence-aware repair audit reports no candidates and no obsolete assignments.
- All five finance confirmation tokens are empty and were verified live by blocked runs.
- The complete local suite passes with 144 tests.

## 2026-08-24 — Evidence-aware bank statements and production-safe handover

### Context

Audited live Ualá and Santander mail, corrected statement false positives across the shared bank taxonomy, deployed the change, observed controlled repair batches, and created a repository-level handover system for future Codex/LLM instances.

### Lessons & Patterns

1. **A subject keyword is a candidate, not evidence.** `estado de cuenta` appeared in Paperless, consultation, design, education, and password-instruction notices. True statement classification now requires a PDF/XML/ZIP document or explicit current-document access/download wording.
2. **Attachment-only is also too strict.** Mercado Pago mail originating from
   GBM, PayPal, Nu, Hey Banco, Openbank, and some Banamex flows deliver statements
   through a link or app. Validate explicit availability/access language instead
   of assuming all banks attach a file.
3. **Repair old labels separately from preventing new errors.** Incoming resolution validates message evidence; historical repair targets known incorrect statement labels; backfill filters statement candidates before bulk labeling.
4. **One shared taxonomy can still support bank-specific polymorphism.** Ualá keeps the same child names but adds its own vocabulary and evaluates promotions before generic transactions.
5. **Script locks should skip, not overlap.** The first post-deploy scheduled run safely skipped while the hourly classifier held the lock. A later controlled run completed without errors and preserved read/archive state.
6. **Verify the mailbox after the log.** A controlled repair removed the known false positives, but a newly arrived password-instruction notice exposed one more pattern. Add real examples to regression tests and re-sample the live label after every repair.
7. **Separate stable knowledge from changing state.** `KNOWLEDGE.md` holds invariants, `CONTEXT.md` maps architecture, tracked `docs/HANDOVER.md` is public guidance, and ignored `docs/HANDOVER.local.md` carries the private snapshot that future agents must re-verify.
8. **Repository-scoped Codex context is portable.** Root `AGENTS.md` plus `.agents/skills/.../SKILL.md` travels with the repository and avoids reliance on machine-specific memories or personal skill paths.

### Verified production results

- Controlled repairs completed without errors and preserved read/archive state.
- The sampled Santander statement label contained document-backed statements and no known false patterns.
- The configured Ualá sender query matched live mail; historical child-label backfill was still pending at the final snapshot.
- The complete local regression suite passed.

## 2026-06-13 — Stage 3 Migration Audit & Performance Optimization

### Context
Finalized the migration of Drive files to the Stage 3 category-based structure. Created a read-only audit tool (`auditPendingMigration`) to list un-migrated folders, expanded the `CONFIG` aliases and keywords based on real-world logs, and drastically improved migration speed by skipping already valid folders.

### Lessons & Patterns

1. **Read-only audit tools are invaluable for data mapping:** Instead of guessing keywords, `auditPendingMigration()` dumped the exact folder structure of pending files in a copy-paste-friendly format, allowing quick creation of accurate `SENDER_ALIASES`.
2. **Optimize loop iterations in GAS to avoid timeouts:** The `migrateToIntelligentCategories()` script was timing out because it traversed already-migrated category folders. Adding a simple `validCategories.has(topFolderName)` skip drastically reduced iteration time, allowing the script to focus its 4.5-minute execution window exclusively on pending files.
3. **Handle duplicate legacy folder names gracefully:** Real-world archives often contain duplicated sender emails under different Display Names. The `cleanUpAllDuplicates()` function successfully cleaned up files that were correctly merged into the same new category folder but duplicated due to the migration.
4. **Context persistence matters:** Updated the `CONTEXT.md` to reflect the new `Category/FriendlyName/YYYY/` hierarchy so future AI sessions or maintainers understand the target structure immediately.

---

## 2026-06-12 — DRY_RUN Mode + Batch Completion Notification

### Context
Implemented the last two medium-priority backlog items: a `DRY_RUN` config flag that turns all write operations into no-ops, and `sendBatchCompletionNotification()` — a lightweight HTML email sent at the end of each `processGmailAttachments()` run.

### Lessons & Patterns

1. **`DRY_RUN` belongs in CONFIG, not as a function parameter** — passing it through every function call would be noisy and error-prone. A top-level CONFIG flag is readable, togglable in the GAS editor, and accessible in every file without refactoring function signatures.

2. **Separate the "full report" from the "batch notification"** — `sendHtmlCleanupReport()` makes several expensive `countThreads` calls. A post-batch notification only needs the counters the main loop already computed. `sendBatchCompletionNotification()` makes zero extra Gmail queries, keeping well within the 6-minute GAS limit.

3. **DRY_RUN guard placement matters** — the guard must wrap the *write* call, not the *read* that precedes it. `fileExistsInFolder()` should still execute in dry-run (it's a read); only `createFile()` gets skipped. This gives accurate dedup hit logs even during dry runs.

4. **Mode banner at the top of every destructive entry point** — `if (CONFIG.DRY_RUN) { Logger.log('⚠️ DRY RUN...') }` at the very start of `processGmailAttachments` and `migrateToIntelligentCategories` makes the mode unmistakable in the GAS execution log.

5. **DRY RUN banner in the notification email prevents misreading** — when both `DRY_RUN: true` and `ENABLE_BATCH_NOTIFICATION: true`, the subject is prefixed `[DRY RUN]` and the header turns orange. Eliminates risk of treating a dry-run result as a live run.

6. **`src/` reorganization was already complete** — `.clasp.json` already had `rootDir: "src"`, `package.json` already pointed `collectCoverageFrom` and test imports to `src/**`. Always verify before assuming structural work is pending.

---

## 2026-06-07 — Unit-Testable Utility Layer (Jest Integration)


### Context
Extracted 10 pure utility functions from `cleanup-attachments.gs` into a new `utils.gs` file. Set up a local Jest testing environment in Node.js to test these functions independently of the Google Apps Script runtime.

### Lessons & Patterns

1. **Shared Global Scope in GAS** — Multiple `.gs` files in the same GAS project share the same global scope. Functions extracted to `utils.gs` do not need to be explicitly imported into `cleanup-attachments.gs`; they are available automatically at runtime.

2. **Testing GAS Code Locally** — By appending an `if (typeof module !== 'undefined') { module.exports = { ... }; }` block to the end of a `.gs` file, the file remains valid in the GAS environment (which ignores the block since `module` is undefined) while allowing Node.js testing frameworks like Jest to `require()` and test the pure functions locally.

3. **Clasp and Test Files** — Added `__tests__/**` and `coverage/**` to `.claspignore` to prevent pushing local test suites and coverage reports to the Google Apps Script remote project.

4. **IDE Support for Test Frameworks** — Added `"jest"` to the `typeAcquisition.include` array in `jsconfig.json` to ensure the editor provides autocomplete and type checking for Jest globals (`describe`, `test`, `expect`) without needing to explicitly install `@types/jest`.

---

## 2026-06-07 — HTML Report + Spreadsheet Dashboard

### Context
Implemented two low-priority features: a styled HTML email report (`sendHtmlCleanupReport`) and a Google Sheets historical dashboard (`updateSpreadsheetDashboard`). Both are opt-in via CONFIG flags and share a `collectCleanupStats()` helper to avoid duplicating Gmail query calls.

### Lessons & Patterns

1. **Extract a shared stat collector when two features need the same data** — `collectCleanupStats()` runs all the Gmail `countThreads` and `getTopSenders` calls once, returning a plain object. Both the HTML report and the dashboard consume it. This avoids hitting the 6-minute GAS wall-clock limit twice.

2. **Use table-based HTML for email compatibility** — CSS `display:grid`, `flexbox`, and `linear-gradient` do not render reliably in Gmail or Outlook. Use `<table>` layouts with inline `style=""` attributes for every element. No `<style>` blocks.

3. **Progress bar in email via a two-cell table** — `width="${progressBar}%"` on the first `<td>` and an empty second `<td>` simulates a progress bar in email clients without CSS `width` on `<div>`.

4. **`SpreadsheetApp.create()` returns the spreadsheet object with a usable ID** — log the ID immediately after creation so the user can copy it back into CONFIG. Never assume the user will find it in Drive manually.

5. **`appendRow()` is simpler and safer than `getLastRow()`** — for the Run History sheet, `appendRow()` is idempotent with respect to sheet state and does not require calculating the next empty row manually.

6. **`clearContents()` on the Summary sheet before rewriting** — avoids stale data if the number of rows changes between runs. `clearContents()` is preferred over `clear()` since it preserves column widths set at sheet creation.

7. **OAuth scopes in `appsscript.json` must be complete** — when `oauthScopes` is explicitly listed, GAS does NOT auto-detect additional scopes from the code. `gmail.send` (for `MailApp`) and `spreadsheets` (for `SpreadsheetApp`) must both be declared or the script will fail at runtime with an authorization error.

---

## 2026-06-07 — Attachment Deduplication + Configurable Exclusion List

### Context
Implemented two medium-priority features: filename-based dedup in `saveAttachment()` and a configurable sender exclusion list in `processMessage()`. Both features are pure-function helpers checked at the correct pipeline stage.

### Lessons & Patterns

1. **Dedup by filename is the right strategy for GAS** — Drive's `getFilesByName()` is a native indexed call, much faster than iterating all files. The `fileExistsInFolder()` helper is read-only and safe to call on every attachment.

2. **The dedup guard and the label guard are complementary** — `Processed_Drive` prevents re-processing at the thread level; `fileExistsInFolder()` prevents re-saving at the file level. Having both means the system is resilient even if the label is manually removed.

3. **Sender exclusion belongs in `processMessage()`, not `processThread()`** — the sender is per-message, not per-thread (a thread can have replies from multiple senders). Checking at the message level is the correct granularity.

4. **Domain rules with `endsWith('@domain.com')` also match subdomains** — `'@foo.com'` will match `bar@sub.foo.com`. Document this clearly. If the user needs exact domain matching, they should add the rule with the full subdomain.

5. **Always guard optional CONFIG keys with a null/length check** — `isSenderExcluded()` returns `false` early if `EXCLUDED_SENDERS` is empty or undefined, so existing setups that don't define the key still work correctly.

---

## 2026-06-07 — clasp CLI Integration

### Context
Wired up `@google/clasp` as the primary deployment workflow. Created `package.json`, `appsscript.json`, `.clasp.json.template`, `.clasp.json` (gitignored), and `.claspignore`. Updated README, CONTEXT.md, and todo.md.

### Lessons & Patterns

1. **`@google/clasp` 2.x has unresolved upstream vulnerabilities** — `googleapis-common` depends on a vulnerable `uuid`. Fix: upgrade to `clasp@^3.3.0` via `npm audit fix --force`. This is an upstream issue, not a risk in our deployed GAS code.

2. **Use `^3.3.0` for `@google/clasp` in `package.json`** — `2.x` is effectively abandoned. `3.x` is the maintained line and matches the globally installed version.

3. **`appsscript.json` must be present for `clasp push` to include the manifest** — without it, GAS uses default settings (V8 runtime not guaranteed). Always commit `appsscript.json`.

4. **`.claspignore` controls push, not pull** — `clasp pull` downloads everything in the remote project. Keep only `.gs` files and `appsscript.json` in GAS.

5. **`jsconfig.json` should use `include: ["*.gs"]` glob** — auto-covers future modules without updating the config each time.

6. **Script ID goes in `.clasp.json` (gitignored), not the template** — onboarding = `cp .clasp.json.template .clasp.json` + fill Script ID.

---

## 2026-06-03 — AI Context Persistence (Session 2)

### Context
Second session: reviewed the full project from scratch, created a persistent project overview, wired up the Knowledge Item (KI) store for auto-injection, and committed `CONTEXT.md` to the repo.

### Lessons & Patterns

1. **AI context is conversation-scoped by default** — artifacts written to `brain/<conversation-id>/` are invisible in future sessions. Use the KI store (`antigravity-ide/knowledge/<ki-name>/`) for cross-session persistence; the summary in `metadata.json` is injected automatically at every new conversation start.

2. **Two-layer context strategy** — KI metadata gives the AI a zero-click summary; `CONTEXT.md` in the repo gives humans and the AI a deeper reference that survives KI store resets. Keep both in sync whenever architecture changes.

3. **PowerShell does not support `&&` as a command separator** — use `;` instead (e.g., `git add .; git commit -m "msg"`). The `&&` idiom is bash-specific.

4. **Session wrap-up is non-negotiable** — updating `todo.md` + `lessons.md` + committing ensures zero context loss between sessions. Treat it as part of the definition of done for every task.

---

## 2026-06-03 — Project Scaffold & Repo Initialization

### Context
Initial session: analyzed `cleanup-attachments.gs`, scaffolded documentation, created git repo, and pushed to GitHub.

### Lessons & Patterns

1. **Google Apps Script has no native test runner** — all logic that can be extracted into pure functions should be isolated so they can eventually be unit-tested with a Node harness (e.g., `@google/clasp` + Jest). Keep GAS API calls (GmailApp, DriveApp, Logger) at the edges of each function.

2. **`computeThresholdDate` is timezone-sensitive** — `new Date()` returns the script runner's local time, which is UTC in GAS. If the script is triggered at midnight UTC it may evaluate the date boundary differently than expected by a user in UTC-6. Always verify date math against UTC when diagnosing edge cases.

3. **`GmailApp.search` paginates at 500** — the `countThreads` helper correctly pages, but any caller that just calls `search(q, 0, 500)` will silently miss threads beyond page 1. Document this cap clearly wherever sampling is intentional.

4. **Drive `addFile` / `removeFile` is a reference move, not a copy** — files are not duplicated; the file object moves its parent reference. This means if a migration fails mid-way, the file may temporarily appear in both folders (or neither). Always wrap in try/catch and log the file ID.

5. **`Logger.log` output disappears after the GAS execution ends** — for production use consider writing critical summaries to a Google Sheet or sending via `MailApp` so they are auditable after the fact.

6. **`.gitignore` must exclude `.clasp.json`** — this file contains OAuth tokens when using the clasp CLI and must **never** be committed.

### Open Questions
- Should the archive folder be created at the root of Drive or inside a specific shared drive?
- What is the intended behavior when an attachment already exists in the Drive folder (overwrite, skip, or rename)?

---

## 2026-06-08 — Intelligent Filtering and Folder Reorganization

### Context
Implemented intelligent filtering based on subject, filename, and sender rules. Migrated from a strict 'DisplayName/email@domain' structure to a clean 'Category/FriendlyName' structure. Added a migration script for existing files. Fixed report timeout vulnerabilities for large processing queues.

### Lessons & Patterns

1. **Avoid replacing entire file blocks if chunk matching is ambiguous** — when modifying heavily structured files like GAS scripts via API, prefer writing targeted patches or doing a full-file overwrite instead of relying on line-range replacements that might capture too much.
2. **Abstract folder hierarchy logic** — moving from a hardcoded 3-level Drive hierarchy to a category-based logic required careful decoupling in `main.gs` and `migration.gs`.
3. **Execution timeouts require manual checkpoints in GAS** — `Date.now() - startTime > 4.5 * 60 * 1000` is a mandatory check in heavy loops (like `countThreads`) because GAS will brutally crash the script at 6 minutes, leaving no final logs.
4. **Use node.js unit tests for pure GAS functions** — testing the categorization rules in Jest (which takes <1s) proved invaluable compared to deploying to GAS and running against live emails.

### Deduplication during Migration
When moving files between folders, Google Drive's `Folder.addFile()` combined with `removeFile()` creates duplicates if the destination already contains a file with the same name. To mitigate this:
1. Check `fileExistsInFolder(destination, filename)` prior to moving.
2. If true, safely call `file.setTrashed(true)` on the source file rather than `deleteFile()` to give the user a 30-day recovery window.
3. Added `cleanUpAllDuplicates()` to recursively traverse a hierarchy and trash any subsequent files sharing names using a `Set`.

### Handling 6-Minute Execution Limits in GAS for Drive Scans
- **Date:** 2026-06-13
- **Lesson:** Walking a deep Drive folder tree recursively is extremely slow and will often hit the 6-minute GAS limit. To make large audits reliable, flatten the traversal by building a queue of folder IDs (e.g., all `YYYY` folders), save the queue state to a JSON file (or script properties), and process it in 5-minute batches.
- **Action:** Implemented state persistence via `junk_audit_state.json` for `auditJunkFiles()` and added an estimation tool.
## 2026-08-22 — Separate document retention from mailbox cleanup

- A Gmail cleanup strategy should not infer backup success from the absence of a thrown error; every attachment operation must return an explicit result and mailbox mutation must be gated on a complete verified summary.
- File size is not a safe proxy for inline junk. Real financial PDFs can be under 10 KB; use Gmail MIME attachment options to exclude inline images and preserve real files regardless of size.
- Filename-only deduplication can destroy distinct documents. Compare size plus SHA-256, and suffix same-name/different-content collisions.
- Large mailboxes need two lanes: verified retention for documents and staged cleanup for attachment-free low-value categories. Bulk deletion requires a separate, manual confirmation label.

## 2026-08-22 — Ordered incoming rules must override Gmail categories

- Gmail categories are useful candidate signals, not authority: banking and account-security mail can appear under Updates or Promotions.
- Evaluate priority rules first, then process low-value categories with per-run first-match semantics.
- Low-value archive/Trash actions need independent runtime gates for real attachments, protected domains, starred/important state, and conversations containing sent messages.
- Keep automatic retention disabled until labels have accumulated enough mail for a human audit; a configurable label-empty operation still needs a typed confirmation token.

## 2026-08-24 — Separate institution, message type, and required action

- A financial sender is one classification dimension, not the final label. Apply an institution parent and derive a reusable child from ordered subject phrases so `Santander/Estados de cuenta` and `Santander/Hipoteca` stay navigable without multiplying Gmail searches.
- Security and fraud language must precede broad words such as `compra`, `cargo`, and `pago`; otherwise verification or unrecognized-transaction alerts become routine records.
- “Actionable” must be an explicit query, never the fallback for all Gmail Updates. The safe fallback is a delayed routine lane with attachment, sender, starred, sent-thread, and protected-content gates.
- Historical cleanup needs separate entry points from hourly classification: read-only audit first, then small confirmation-gated batches. Financial backfill can be label-only; Inbox draining may archive but must not use Trash.
- Applying both the institution parent and child lets future queries exclude processed mail efficiently while preserving a useful parent-level Gmail view.
- In `@google/clasp` 3.x the IDE command is `clasp open-script`, not `clasp open`. An unknown command may print general help and still appear successful, so verify the supported command list instead of trusting only the exit status.
- Large label-only Gmail backfills should use small locked batches behind an idempotent temporary trigger. Let the handler remove its own trigger after an empty, error-free batch so completion does not require an agent to poll for hours.
- `GmailThread.getMessages()` across a 100-thread batch can consume roughly three minutes. For subject-based historical classification, use Gmail search subject predicates and `GmailLabel.addToThreads()` so reads and writes remain bulk operations.
- Gmail historical search can distinguish accented Spanish terms even when the incoming pure-text classifier normalizes them. Expand query phrases with accented variants (`autorización`, `promoción`, `código`) and chunk long subject OR groups so the live rule and historical backfill classify the same mail.
- When a temporary trigger shares a script lock with a long hourly job, schedule it beyond the observed batch duration. Finance repair now runs every ten minutes, processes obsolete labels before expensive child-label inspection, and self-removes only after repair and backfill are both empty.

## 2026-08-27 — Split financial products with query-scoped parent rehomes

- Afore must not be detected by the word alone: ordinary bank transaction mail
  can mention `AFORE MOVIL` as a merchant. Use verified product senders and exact
  statement subjects, then explicitly exclude those patterns from the broader
  Banamex rule.
- Product/institution sections should remain parents, not shared child labels;
  this preserves the orthogonal message type (`Afore/Estados de cuenta`,
  `Infonavit/Seguridad`, and so on).
- When splitting a parent, add the exact new parent/child before removing only
  query-matched old finance labels. A post-run audit must prove zero missing
  parents, zero stale sources, exactly one child, and an empty temporary token.
- Include both `estado de cuenta` and `estados de cuenta`; the plural Afore
  subject previously matched `Inversiones` only because it also contained the
  word `afore`.
