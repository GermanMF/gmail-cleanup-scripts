# 📋 Gmail Cleanup Scripts — Task Backlog

> Tracks upcoming features, improvements, and bugs. Update this file during every dev session.

---

## 🔴 High Priority

- [x] **Add `clasp` integration** — wired up. `npm run push/pull/open/status/logs` all work. Script ID configured in `.clasp.json` (gitignored). See `.clasp.json.template` for onboarding.
- [x] **Unit-testable utility layer** — extract pure functions (string parsing, date logic) into a separate `utils.gs` file with `module.exports` at the bottom to allow running local Node.js unit tests (e.g., via Jest) without needing the GAS runtime.

---

## 🟡 Medium Priority

- [x] **Email notification on completion** — `sendBatchCompletionNotification()` in `reports.gs`. Sends compact HTML email with archived/deleted/skipped counts, exec time, and DRY RUN banner. Opt-in via `CONFIG.ENABLE_BATCH_NOTIFICATION: true`. Uses `REPORT_EMAIL` as recipient.
- [x] **Dry-run mode** — `DRY_RUN: false` config flag. When `true`, all Drive writes (`createFile`, `addFile`, `removeFile`) and Gmail mutations (`moveToTrash`, `addLabel`, `setTrashed`) are skipped and logged as `[DRY RUN] Would <action>: <target>`. Guards added in `main.gs` and all three migration stages in `migration.gs`.
- [x] **Attachment deduplication** — before saving, `fileExistsInFolder()` checks if the same filename already exists in the target Drive folder. Skips with log if duplicate detected.
- [x] **Configurable exclusion list** — `CONFIG.EXCLUDED_SENDERS` accepts exact emails (`'noreply@x.com'`) or full domains (`'@domain.com'`). Checked in `processMessage()` via `isSenderExcluded()`.

---

## 🟢 Low Priority / Nice-to-Have

- [x] **HTML report** — generate a richer styled HTML email report instead of plain Logger output.
- [x] **Spreadsheet dashboard** — write stats to a linked Google Sheet for historical tracking.
- [ ] **Multi-account support** — investigate if clasp / GAS allows switching between multiple Google accounts programmatically.

---

## ✅ Completed

- [x] Initial `processGmailAttachments` main loop with date-window policy.
- [x] `generateCleanupReport` with mailbox stats, top senders, Drive stats.
- [x] Stage 1 migration: `migrateOldStructure` (flat YYYY → email@domain/YYYY).
- [x] Stage 2 migration: `migrateEmailFoldersToDisplayName` (email → DisplayName/email).
- [x] Stage 3 migration: `migrateToIntelligentCategories` (DisplayName/email → Category/FriendlyName).
- [x] Post-migration cleanup utilities: `cleanUpAllDuplicates`, `auditPendingMigration`, `deleteOrphanedEmptyFolders`.
- [x] JSDoc on all public functions.
- [x] README, .gitignore, tasks scaffold.
- [x] Git repo initialized, pushed to GitHub (`main` + `dev` branches).
- [x] `CONTEXT.md` added to repo — persistent AI + contributor project overview, committed to `dev`.
- [x] Knowledge Item (KI) created in AI store — auto-injects project context at every new session start.
- [x] **Junk file cleanup** — `auditJunkFiles()` and `deleteConfirmedJunkFiles()` with HTML report and Sheets dashboard confirmation added.

- [x] **Multi-account support** — deferred (GAS single-account limitation confirmed by investigation).
