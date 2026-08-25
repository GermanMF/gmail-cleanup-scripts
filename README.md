# 📬 Gmail Cleanup Scripts

> Two safety lanes for Gmail: verified attachment archival to Drive, plus staged cleanup of old low-value email.

For a new maintainer or Codex instance, start with [AGENTS.md](AGENTS.md),
[CONTEXT.md](CONTEXT.md), and [docs/HANDOVER.md](docs/HANDOVER.md).

---

## 🚀 Overview

This Google Apps Script suite enforces a rolling **date-window policy** for messages with real attachments:

| Email Age | Action |
|---|---|
| < 3 months | ✅ Untouched — skipped entirely |
| 3 – 6 months | 📁 Attachments archived to Drive, email kept |
| > 6 months | 📁 Attachments archived to Drive, email trashed |

Attachment storage follows a clean, navigable folder hierarchy:

```
Gmail_Attachments_Archive/
└── Category/
    └── Friendly Sender Name/
        └── YYYY/
            └── YYYYMMDD_localpart_OriginalFilename.ext
```

---

## ✨ Features

- **Configurable date windows** — tweak `ARCHIVE_AFTER_MONTHS` and `DELETE_AFTER_MONTHS` without touching any logic.
- **Batch processing** — runs up to `BATCH_SIZE` (default 50) threads per execution to stay within Apps Script's 6-minute wall-clock limit.
- **Verified backup barrier** — Gmail changes only after every real attachment is saved and SHA-256 verified, or matched to a content-verified duplicate.
- **Safe duplicate handling** — same name plus same content is a duplicate; same name with different content gets a deterministic suffix and both files are kept.
- **Smart filtering** — inline MIME images are excluded while small legitimate attachments are preserved. Exclude specific senders or domains via `EXCLUDED_SENDERS`.
- **Manual review lane** — failed/incomplete backups, excluded senders, and threads without real attachments receive `Cleanup_Review` and are never auto-deleted.
- **Staged bulk cleanup** — old attachment-free Promotions, Social, and Updates are archived and labeled for review; only manually confirmed threads can be trashed.
- **Periodic inbox rules** — ordered `Auto/...` rules separate action-required, record, and routine mail while protecting security, real attachments, starred mail, and conversations containing sent messages.
- **Evidence-aware financial sublabels** — bank mail receives an institution parent plus a message-type child; statements additionally require a document or explicit current-document access/download evidence.
- **Reversible backlog drain** — read-only audits plus confirmation-gated, batched label/archive operations reduce historical Inbox debt without using Trash.
- **Low-value retention** — Promotions, Social, and safe Updates can expire after configurable retention windows; automatic Trash is disabled by default.
- **HTML Email Reports** — opt-in to receive beautifully styled summary emails (`ENABLE_HTML_REPORT`) after each run.
- **Google Sheets Dashboard** — opt-in to automatically track run history and mailbox stats in a Google Sheet over time (`ENABLE_DASHBOARD`).
- **One-time migration helpers** — two migration functions handle existing archives from older folder structures.
- **Unit-testable Utility Layer** — pure functions and rule/config behavior are covered by local Jest suites.

---

## ⚙️ Configuration

All tuneable parameters live in `src/config.gs` in the `CONFIG` object:

```js
const CONFIG = {
  SEARCH_QUERY:         'has:attachment -in:chats', // base Gmail query
  PROCESSED_LABEL:      'Processed_Drive',           // dedup label
  REVIEW_LABEL:         'Cleanup_Review',            // manual safety queue
  BASE_FOLDER_NAME:     'Gmail_Attachments_Archive', // Drive root folder
  MIN_FILE_SIZE_BYTES:  0,                           // preserve small real files
  SKIP_INLINE_IMAGES:   true,                        // ignore HTML logos/signatures
  BATCH_SIZE:           50,                          // threads per run
  ARCHIVE_AFTER_MONTHS: 3,                           // archive threshold
  DELETE_AFTER_MONTHS:  6,                           // delete threshold
  MAX_COUNT_PER_QUERY:  500,                         // report accuracy cap
  EXCLUDED_SENDERS:     [],                          // senders/domains to ignore
  ENABLE_HTML_REPORT:   false,                       // send styled email after run
  REPORT_EMAIL:         '',                          // recipient (defaults to active user)
  ENABLE_DASHBOARD:     false,                       // append stats to Google Sheets
  DASHBOARD_SPREADSHEET_ID: '',                      // sheet ID (auto-created if empty)
  ENABLE_INBOX_RECORD_ARCHIVE: false,                // gate new record/routine archives
};
```

---

## 📦 Entry Points

| Function | Description |
|---|---|
| `processGmailAttachments()` | **Main function** — run this manually or on a trigger |
| `auditBulkCleanup()` | Read-only counts for low-value cleanup policies |
| `stageBulkCleanupCandidates()` | Archives and labels candidates for review; never deletes |
| `purgeConfirmedBulkCleanup()` | Trashes only attachment-free threads manually labeled `Cleanup_Delete` |
| `auditInboxRules()` | Read-only preview counts for incoming-mail rules |
| `runInboxRules()` | Labels recent mail and archives only safety-cleared records/routine threads |
| `auditFinancialSublabelBackfill()` | Read-only counts for historical bank mail missing a child label |
| `backfillFinancialSublabels()` | Confirmation-gated label-only historical financial classification |
| `auditFinancialLabelRepair()` | Read-only counts for incorrect/obsolete finance assignments |
| `repairFinancialLabels()` | Label-only repair; never changes read/archive state |
| `runScheduledFinancialSublabelBackfill()` | Repairs first, then backfills, then removes its temporary trigger |
| `installFinancialSublabelBackfillSchedule()` | Installs the idempotent ten-minute temporary trigger |
| `removeFinancialSublabelBackfillSchedule()` | Removes only the temporary finance trigger |
| `auditInboxBacklog()` | Read-only counts for reversible historical Inbox drain policies |
| `stageInboxBacklog()` | Confirmation-gated label + archive backlog batches; never deletes |
| `auditInboxRuleRetention()` | Read-only counts for expired `Auto/LowValue/...` mail |
| `purgeExpiredInboxRuleMail()` | Retention cleanup; disabled until explicitly enabled in config |
| `emptyConfiguredLowValueLabel()` | Protected batch-empty operation requiring an exact confirmation token |
| `installInboxAutomation()` | Installs an hourly rules trigger and optional daily retention trigger |
| `removeInboxAutomation()` | Removes only triggers created by the inbox automation module |
| `generateCleanupReport()` | Stats-only report (Execution Log), safe to run anytime |
| `sendHtmlCleanupReport()` | Generates stats and emails an HTML summary |
| `updateSpreadsheetDashboard()` | Appends current stats to a tracking Google Sheet |
| `migrateOldStructure()` | Stage 1 migration: old `YYYY/MM_Month/` → `email@domain/YYYY/` |
| `migrateEmailFoldersToDisplayName()` | Stage 2 migration: `email@domain/` → `DisplayName/email/` |
| `migrateToIntelligentCategories()` | Stage 3 migration: → `Category/FriendlyName/YYYY/` |
| `auditPendingMigration()` | **Read-only** — lists all folders NOT yet in a valid category |
| `cleanUpAllDuplicates()` | Trashes duplicate files in the archive (30-day recovery window) |
| `validateNoDuplicates()` | Read-only — verifies no duplicates remain after cleanup |
| `deleteOrphanedEmptyFolders()` | Trashes empty legacy folders that are no longer valid categories |
| `auditArchiveStructure()` | Read-only — full structured report of the current archive |
| `auditJunkFiles()` | Non-destructive scan; writes candidates to the Junk Audit sheet |
| `deleteConfirmedJunkFiles()` | Trashes only Junk Audit rows manually marked `CONFIRMED` |

---

## 🛠️ Setup & Deployment

### Prerequisites
- A Google Account with Gmail and Drive access.
- Node.js ≥ 18 (for `clasp` CLI tooling).
- An existing [Google Apps Script](https://script.google.com) project.

---

### Option A — clasp (recommended for development)

This is the primary workflow. Changes are pushed/pulled via CLI — no copy-paste.

```bash
# 1. Install dependencies
npm install

# 2. Authenticate with your Google account (one-time)
clasp login

# 3. Configure your Script ID
cp .clasp.json.template .clasp.json
# Edit .clasp.json and replace YOUR_SCRIPT_ID_HERE with your real Script ID
# (found in script.google.com → Project Settings → Script ID)

# 4. Preview what will be pushed (dry run)
npm run push:dry

# 5. Push to Google Apps Script
npm run push

# 6. Open the project in the browser
npm run open
```

**Available npm scripts:**

| Script | Command | Description |
|---|---|---|
| `npm run push` | `clasp push` | Upload local files to GAS |
| `npm run pull` | `clasp pull` | Download remote changes locally |
| `npm run open` | `clasp open-script` | Open project in browser |
| `npm run status` | `clasp status` | Show which files differ |
| `npm run logs` | `clasp logs --watch` | Tail live execution logs |
| `npm run push:dry` | `clasp status` | Preview files included in the Apps Script project |
| `npm run test` | `jest --coverage` | Run local unit test suite |

> ⚠️ Never commit `.clasp.json` — it is gitignored. Commit only `.clasp.json.template`.

---

### Option B — Manual (no CLI)

1. Go to [script.google.com](https://script.google.com) → **New project** → delete default content.
2. Create one Apps Script file per `.gs` file in `src/` and copy each file's contents.
3. Click **Save**, then continue with step 4 below.

---

### Running & Triggering

4. **Configure:** Edit the `CONFIG` object in `config.gs`.

5. **Run manually first:**
   - Run `generateCleanupReport` and `auditBulkCleanup` before touching anything.
   - Set `DRY_RUN: true` and run `processGmailAttachments` once.
   - Inspect the log before changing `DRY_RUN` to `false`.

### Recommended bulk-cleanup sequence

1. Run `auditBulkCleanup()`; it is read-only.
2. Run `stageBulkCleanupCandidates()`; candidates leave Inbox and receive labels
   such as `Cleanup_Review/Promotions`, but nothing is deleted.
3. Review those labels in Gmail and manually apply `Cleanup_Delete` only to
   threads you approve.
4. Run `purgeConfirmedBulkCleanup()`; confirmed, attachment-free, unstarred,
   non-important threads move to Trash.

Use `DRY_RUN: true` for the first execution of every mutating entry point.
After resolving an item in `Cleanup_Review`, remove that label to let the
attachment pipeline retry it on a later run.

### Incoming-mail automation

1. Customize `AUTOMATION_PROTECTED_DOMAINS` and the ordered `INBOX_RULES` in
   `config.gs`. Keep Security, Finance, and Documents above low-value rules.
2. Run `auditInboxRules()`; it is read-only.
3. Set `DRY_RUN: true` and run `runInboxRules()` manually. Review the execution log.
4. Set `DRY_RUN: false`, run it once, and inspect the new `Auto/...` labels.
5. Run `installInboxAutomation()` to classify recent Inbox mail every hour.
6. Keep `ENABLE_INBOX_RECORD_ARCHIVE: false` while sampling the new record and
   routine labels. Enable it only after their contents look correct.
7. Leave `ENABLE_RULE_RETENTION_TRASH: false` until the low-value labels have
   been reviewed. Run `auditInboxRuleRetention()` before enabling daily retention.

Financial mail is classified into a two-level hierarchy. The same child
taxonomy is reused for Santander, Banamex, BBVA, Invex, GBM, Mercado Pago,
PayPal, Hey Banco, Nu, Revolut, Uala, and Openbank:

```text
Auto/Finance/
└── Santander/
    ├── Seguridad
    ├── Hipoteca
    ├── Créditos
    ├── Estados de cuenta
    ├── Inversiones
    ├── Pagos y vencimientos
    ├── Transacciones
    ├── Promociones y beneficios
    ├── Tarjetas
    ├── Avisos de servicio
    └── Otros
```

The institution parent intentionally remains applied after a child is added, so
the parent count is an all-mail view rather than a remaining-work counter.
Ualá keeps the shared child names but adds bank-specific investment/promotion
phrases and gives explicit promotions precedence over generic transaction words.

`Estados de cuenta` has an extra evidence gate. A matching subject must include
either a non-inline PDF/XML/ZIP statement document or explicit wording that the
current document is available to access/download. Paperless notices,
consultation audit events, design/education messages, and password instructions
are routed elsewhere. See [docs/FINANCE_TAXONOMY.md](docs/FINANCE_TAXONOMY.md)
for exact rules and examples.

To classify historical bank mail, run `auditFinancialSublabelBackfill()` first.
Then set `FINANCIAL_SUBLABEL_BACKFILL_CONFIRMATION` to
`APPLY_FINANCIAL_SUBLABELS` and run `backfillFinancialSublabels()` in batches.
This operation only adds labels; it does not change read or archive state.
For a large backlog, run `installFinancialSublabelBackfillSchedule()` after a
successful sample batch. It attempts one batch of up to 100 threads per
scheduled run and removes its own temporary trigger after an empty, error-free batch. If
another mailbox job holds the script lock, that attempt is skipped and the next
scheduled run retries. The current interval is ten minutes so even a slow Gmail
index refresh remains comfortably below the next scheduled batch.

The scheduled handler repairs finance-only legacy labels first, including
misclassified `Otros` mail and obsolete finance assignments under the old
Actionable/Priority lanes. It then resumes missing-child backfill. All repair
steps are label-only and never change read or archive state.

The current trigger and mailbox snapshot are intentionally kept out of this
general guide; check [docs/HANDOVER.md](docs/HANDOVER.md) and verify Apps Script
live state before running a manual batch.

For historical Inbox cleanup, run `auditInboxBacklog()`. To apply one reversible
batch, set `INBOX_BACKLOG_CONFIRMATION` to `ARCHIVE_INBOX_BACKLOG` and run
`stageInboxBacklog()`. Clear the token again afterward.

Default incoming behavior:

- Security and genuinely action-required finance/Updates mail stay in Inbox.
- With `ENABLE_INBOX_RECORD_ARCHIVE: true`, routine financial records, receipts,
  and completed orders are marked read and archived after 14 days only when they
  have no real attachment and pass runtime safety checks.
- Real attachments stay in Inbox and receive document/financial labels.
- Safe Promotions and Social mail are labeled, marked read, and archived.
- Safe routine Updates are initially label-only; the same feature flag enables
  marking them read and archiving them after seven days.
- A low-value match from a protected sender, protected conversation, or thread
  with a real attachment is sent to `Cleanup_Review/Protected` instead.

6. **Set up a time-based trigger (optional):**
   - Go to **Triggers** (clock icon) → **Add Trigger**.
   - Function: `processGmailAttachments`
   - Event source: Time-driven → e.g., **Daily** at your preferred hour.

7. **Grant permissions:**
   - On first run, Google will ask to authorize Gmail and Drive access. Review and approve.

---

## 🗂️ Project Structure

```
gmail-cleanup-scripts/
├── AGENTS.md                  # Automatic Codex repository guidance
├── CONTEXT.md                 # Architecture and component map
├── KNOWLEDGE.md               # Durable decisions and invariants
├── .agents/skills/            # Repo-scoped Codex workflows
├── docs/                      # Handover, operations, and finance taxonomy
├── src/
│   ├── config.gs              # Configuration and ordered rules
│   ├── main.gs                # Verified attachment pipeline
│   ├── bulk-cleanup.gs        # Staged attachment-free cleanup
│   ├── inbox-rules.gs         # Inbox classification, repair, and retention
│   ├── reports.gs             # Logger/email/Sheets reporting
│   ├── migration.gs           # Drive migration and cleanup
│   ├── gas-utils.gs           # Apps Script-bound helpers
│   ├── utils.gs               # Pure/testable helpers
│   └── appsscript.json        # GAS runtime and OAuth scopes
├── __tests__/                 # Jest suites for utilities/config/inbox rules
├── tasks/
│   ├── todo.md                # Active task backlog
│   ├── checklist.md           # Deployment and wrap-up checklists
│   └── lessons.md             # Append-only session lessons log
└── README.md                  # This file
```

---

## 🔒 Permissions Required

Scopes are declared in `appsscript.json` and requested automatically on first run:

| Scope | Reason |
|---|---|
| `gmail.modify` | Read threads, add labels, trash emails |
| `drive` | Create folders and files in Drive |
| `gmail.send` | Send HTML cleanup report emails |
| `spreadsheets` | Update the historical tracking dashboard |
| `script.scriptapp` | Install or remove this project's time-based triggers |
| `script.external_request` | Reserved for future webhook/API calls |

---

## 🤝 Contributing

1. Fork the repo and create a feature branch from `dev`.
2. Follow the existing JSDoc style for all public functions.
3. Test using `generateCleanupReport()` before and after your changes.
4. Open a PR against `dev` — never directly to `main`.

---

## 📄 License

MIT, as declared in `package.json`.
