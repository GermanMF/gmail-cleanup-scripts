# 🗺️ Project Context — Gmail Cleanup Scripts

> **Read this first.** Persistent AI and contributor context for the `gmail-cleanup-scripts` repository.
> Keep this file updated whenever the architecture, scope, or major decisions change.
> Last updated: 2026-06-12

---

## 📌 What this project does

A **Google Apps Script** suite that keeps a Gmail inbox clean by:
1. **Archiving** email attachments to Google Drive in a structured folder hierarchy.
2. **Trashing** old emails from Gmail once their attachments are safely stored.
3. **Reporting** the current mailbox state (stats, top senders, Drive inventory).

---

## 🗂️ Repository Layout

```
gmail-cleanup-scripts/
├── cleanup-attachments.gs     ← Main Apps Script — core logic and wrappers
├── cleanup-junk.gs            ← Junk file analysis and cleanup module
├── utils.gs                   ← Pure utility functions (shared scope in GAS)
├── __tests__/                 ← Local Jest test suites
│   └── utils.test.js          ← 100% coverage tests for utils.gs
├── appsscript.json            ← GAS manifest (runtime V8, OAuth scopes, timezone)
├── .clasp.json.template       ← Safe template — copy to .clasp.json and fill Script ID
├── .clasp.json                ← ⛔ gitignored — real credentials, never commit
├── .claspignore               ← Files excluded from clasp push
├── jsconfig.json              ← VS Code type-checking; *.gs + google-apps-script + jest
├── package.json               ← npm scripts + Jest configuration
├── .gitignore                 ← excludes node_modules, .clasp.json
├── CONTEXT.md                 ← This file
├── README.md                  ← User-facing setup guide & config reference
├── tasks/
│   ├── todo.md                ← Active backlog (High / Medium / Low / Done)
│   └── lessons.md             ← Append-only session lessons log
└── node_modules/              ← Editor tooling ONLY — never deployed to GAS
```

**Deployment model**: No build step. `cleanup-attachments.gs` is a single flat file. Primary workflow is **`npm run push`** via `clasp` (wired — Script ID configured). Manual copy-paste into the [Google Apps Script editor](https://script.google.com) remains as a fallback.

---

## ⚙️ CONFIG Object (top of `cleanup-attachments.gs`)

| Key | Default | Purpose |
|---|---|---|
| `SEARCH_QUERY` | `'has:attachment -in:chats'` | Base Gmail search query |
| `PROCESSED_LABEL` | `'Processed_Drive'` | Label applied after archiving (dedup guard) |
| `BASE_FOLDER_NAME` | `'Gmail_Attachments_Archive'` | Root folder in user's My Drive |
| `MIN_FILE_SIZE_BYTES` | `10240` (10 KB) | Skip inline signature images |
| `BATCH_SIZE` | `50` | Threads per execution (6-min wall-clock safety valve) |
| `ARCHIVE_AFTER_MONTHS` | `3` | Emails older than this are eligible to archive |
| `DELETE_AFTER_MONTHS` | `6` | Emails older than this are also trashed after archiving |
| `MAX_COUNT_PER_QUERY` | `500` | Safety cap for `countThreads` pagination |
| `EXCLUDED_SENDERS` | `[]` | Skip exact emails or full domains (e.g. `'@domain.com'`) |
| `SENDER_ALIASES` | `{...}` | Map email/domain → friendly display name for Drive folders |
| `CATEGORIES` | `[...]` | Ordered keyword rules for intelligent Drive categorization |
| `DEFAULT_CATEGORY` | `'Otros'` | Fallback category when no rule matches |
| `ENABLE_HTML_REPORT` | `false` | Send full HTML report email after run |
| `REPORT_EMAIL` | `''` | Recipient for HTML/notification emails (defaults to running account) |
| `ENABLE_DASHBOARD` | `false` | Append run stats to a Google Sheets dashboard |
| `DASHBOARD_SPREADSHEET_ID` | `''` | Spreadsheet ID for the dashboard (auto-created on first run) |
| `DRY_RUN` | `false` | When `true`, log planned actions without writing to Drive or Gmail |
| `ENABLE_BATCH_NOTIFICATION` | `false` | Send compact HTML summary email at end of each batch run |

---

## 🪟 Date-Window Policy

```
NOW
 │
 ├── < 3 months old    → ✅  UNTOUCHED — skipped entirely
 ├── 3–6 months old   → 📁  Archive attachments to Drive + apply Processed_Drive label
 └── > 6 months old   → 📁  Archive attachments to Drive + moveToTrash()
```

Decision is based on the **newest message date** in each thread.

---

## 📁 Drive Folder Hierarchy

```
Gmail_Attachments_Archive/
└── Category/             (e.g., Facturas, Estados de Cuenta, etc.)
    └── FriendlyName/     (e.g., Uber, Amazon, BBVA)
        └── YYYY/
            └── YYYYMMDD_localpart_OriginalFilename.ext
```

---

## 🔧 Function Map

### Entry Points

| Function | Safe? | Description |
|---|---|---|
| `processGmailAttachments()` | ⚠️ Destructive | Main loop — archive + label/trash. Prints pre/post reports. |
| `generateCleanupReport(title?)` | ✅ Read-only | Stats snapshot to Logger. Run anytime. |
| `migrateOldStructure()` | ⚠️ One-time | Stage 1: old `YYYY/MM_Month/` → `email@domain/YYYY/` |
| `migrateEmailFoldersToDisplayName()` | ⚠️ One-time | Stage 2: `email@domain/` → `DisplayName/email/` |
| `migrateToIntelligentCategories()` | ⚠️ One-time | Stage 3: → `Category/FriendlyName/YYYY/` |
| `auditPendingMigration()` | ✅ Read-only | Lists all folders NOT yet in a valid category |
| `cleanUpAllDuplicates()` | ⚠️ Destructive | Trashes duplicate files in the archive (30-day recovery window) |
| `validateNoDuplicates()` | ✅ Read-only | Verifies no duplicates remain after cleanup |
| `deleteOrphanedEmptyFolders()` | ⚠️ Destructive | Trashes empty legacy folders that are no longer valid categories |
| `auditArchiveStructure()` | ✅ Read-only | Full structured report of the current archive |
| `estimateAuditPerformance()` | ✅ Read-only | Runs a 30s test to calculate processing speed and capacity |
| `auditJunkFiles()` | ✅ Read-only | Scans Drive for junk files in 5-min resumable batches |
| `deleteConfirmedJunkFiles()` | ⚠️ Destructive | Reads Dashboard Sheet, trashes CONFIRMED junk files |

### Key Helpers

| Function | Notes |
|---|---|
| `countThreads(query, max?)` | Paginates at 500; caps at `MAX_COUNT_PER_QUERY` |
| `getTopSenders(query, topN)` | Samples first 500 threads only (speed tradeoff) |
| `getDriveArchiveStats()` | Walks Drive tree 3 levels deep |
| `processThread → processMessage → saveAttachment` | Archival pipeline |
| `getOrCreateLabel / getOrCreateFolder` | Idempotent — safe to call repeatedly |
| `sanitizeFilename` | Replaces `/ \ : * ? " < > \|` and spaces with `_` |
| `computeThresholdDate(months)` | ⚠️ UTC-sensitive — see Gotchas |
| `isSenderExcluded(email)` | Checks email against `CONFIG.EXCLUDED_SENDERS` (exact or `@domain`) |
| `fileExistsInFolder(folder, name)` | Read-only dedup check before `createFile` |
| `collectCleanupStats()` | Shared stat collector for HTML report + dashboard |
| `sendHtmlCleanupReport(title?, batch?)` | Sends full styled HTML email via `MailApp` |
| `sendBatchCompletionNotification(archived, deleted, skipped, startTime)` | Compact HTML batch-end notification — no extra Gmail queries |
| `buildHtmlReportBody(title, stats, batch)` | Builds email-safe table-based HTML string |
| `updateSpreadsheetDashboard(batch?)` | Appends to Run History + refreshes Summary sheet |
| `getOrCreateDashboard()` | Idempotent — creates spreadsheet + sheets on first run |

---

## ⚠️ Gotchas

1. **6-minute wall-clock limit** — keep `BATCH_SIZE` at 50 unless you've profiled a safe increase.
2. **`GmailApp.search` max page = 500** — `countThreads` paginates; direct callers silently miss overflow.
3. **`computeThresholdDate` is UTC** — GAS runs in UTC, not the user's local timezone. Midnight UTC runs may cross date boundaries unexpectedly.
4. **`addFile`/`removeFile` is a reference move** — not a copy. Mid-migration failure can leave a file with two parents temporarily.
5. **Logger is ephemeral** — output disappears after execution. For audits, write to a Sheet or send via `MailApp`.
6. **`.clasp.json` contains OAuth tokens** — already in `.gitignore`, but double-check before every commit.
7. **No dedup on `saveAttachment`** — ~~the `Processed_Drive` label is the only guard~~ **fixed**: `fileExistsInFolder()` checks by filename before `createFile`. Still, if the filename changes (e.g. due to a date bug), a second copy can appear.
8. **`EXCLUDED_SENDERS` domain match uses `endsWith`** — `'@foo.com'` matches `bar@foo.com` but also `baz@sub.foo.com`. Use the full subdomain (`'@sub.foo.com'`) if you want a narrower match.

---

## 📋 Backlog Snapshot

> Always check `tasks/todo.md` for the authoritative, up-to-date list.

### 🔴 High
- [x] `clasp` CLI integration — **DONE** (2026-06-07)
- [x] Unit-testable utility layer (`utils.gs` + Jest stubs) — **DONE** (2026-06-07)

### 🟡 Medium
- [x] Attachment deduplication (`fileExistsInFolder`) — **DONE** (2026-06-07)
- [x] Configurable sender exclusion list (`EXCLUDED_SENDERS` + `isSenderExcluded`) — **DONE** (2026-06-07)
- [x] Email notification on batch completion (`sendBatchCompletionNotification`) — **DONE** (2026-06-12)
- [x] Dry-run mode (`DRY_RUN` config flag) — **DONE** (2026-06-12)

### 🟢 Low
- [x] HTML email report (`sendHtmlCleanupReport` + `buildHtmlReportBody`) — **DONE** (2026-06-07)
- [x] Spreadsheet dashboard (`updateSpreadsheetDashboard` + `getOrCreateDashboard`) — **DONE** (2026-06-07)
- [ ] Multi-account support investigation

---

## 🔭 Future Suite Modules

`cleanup-attachments.gs` is **Module 1**. Planned future modules:
- `cleanup-newsletters.gs`
- `cleanup-promotions.gs`
- `cleanup-large-emails.gs`
- `utils.gs` — shared utilities across all modules
- `appsscript.json` — GAS project manifest

---

## 🏁 Session Wrap-Up Checklist

1. Update `tasks/todo.md` — mark done items `[x]`, add new ones.
2. Append a new entry to `tasks/lessons.md`.
3. Update `CONTEXT.md` if architecture or scope changed.
4. Commit to `dev`; merge to `main` only when stable.
