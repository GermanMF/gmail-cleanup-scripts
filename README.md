# 📬 Gmail Cleanup Scripts

> A Google Apps Script that automatically archives Gmail attachments to Google Drive and optionally trashes old emails — keeping your inbox lean without losing a single file.

---

## 🚀 Overview

This project contains a single Apps Script (`cleanup-attachments.gs`) designed to run on a Google account's **Gmail** and **Google Drive** via the [Google Apps Script](https://script.google.com) runtime. It enforces a rolling **date-window policy**:

| Email Age | Action |
|---|---|
| < 3 months | ✅ Untouched — skipped entirely |
| 3 – 6 months | 📁 Attachments archived to Drive, email kept |
| > 6 months | 📁 Attachments archived to Drive, email trashed |

Attachment storage follows a clean, navigable folder hierarchy:

```
Gmail_Attachments_Archive/
└── Display Name/
    └── email@domain.com/
        └── YYYY/
            └── YYYYMMDD_localpart_OriginalFilename.ext
```

---

## ✨ Features

- **Configurable date windows** — tweak `ARCHIVE_AFTER_MONTHS` and `DELETE_AFTER_MONTHS` without touching any logic.
- **Batch processing** — runs up to `BATCH_SIZE` (default 50) threads per execution to stay within Apps Script's 6-minute wall-clock limit.
- **Duplicate prevention** — processed threads are tagged with a Gmail label (`Processed_Drive`) so they are never re-processed.
- **Smart filtering** — inline signature images under 10 KB are skipped automatically. Exclude specific senders or domains via `EXCLUDED_SENDERS`.
- **HTML Email Reports** — opt-in to receive beautifully styled summary emails (`ENABLE_HTML_REPORT`) after each run.
- **Google Sheets Dashboard** — opt-in to automatically track run history and mailbox stats in a Google Sheet over time (`ENABLE_DASHBOARD`).
- **One-time migration helpers** — two migration functions handle existing archives from older folder structures.
- **Unit-testable Utility Layer** — pure functions are separated into `utils.gs` with 100% test coverage via local Jest tests.

---

## ⚙️ Configuration

All tuneable parameters live at the top of `cleanup-attachments.gs` in the `CONFIG` object:

```js
const CONFIG = {
  SEARCH_QUERY:         'has:attachment -in:chats', // base Gmail query
  PROCESSED_LABEL:      'Processed_Drive',           // dedup label
  BASE_FOLDER_NAME:     'Gmail_Attachments_Archive', // Drive root folder
  MIN_FILE_SIZE_BYTES:  10 * 1024,                   // skip files < 10 KB
  BATCH_SIZE:           50,                          // threads per run
  ARCHIVE_AFTER_MONTHS: 3,                           // archive threshold
  DELETE_AFTER_MONTHS:  6,                           // delete threshold
  MAX_COUNT_PER_QUERY:  500,                         // report accuracy cap
  EXCLUDED_SENDERS:     [],                          // senders/domains to ignore
  ENABLE_HTML_REPORT:   false,                       // send styled email after run
  REPORT_EMAIL:         '',                          // recipient (defaults to active user)
  ENABLE_DASHBOARD:     false,                       // append stats to Google Sheets
  DASHBOARD_SPREADSHEET_ID: '',                      // sheet ID (auto-created if empty)
};
```

---

## 📦 Entry Points

| Function | Description |
|---|---|
| `processGmailAttachments()` | **Main function** — run this manually or on a trigger |
| `generateCleanupReport()` | Stats-only report (Execution Log), safe to run anytime |
| `sendHtmlCleanupReport()` | Generates stats and emails an HTML summary |
| `updateSpreadsheetDashboard()` | Appends current stats to a tracking Google Sheet |
| `migrateOldStructure()` | Stage 1 migration: old `YYYY/MM_Month/` → `email@domain/YYYY/` |
| `migrateEmailFoldersToDisplayName()` | Stage 2 migration: `email@domain/` → `DisplayName/email/` |

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
| `npm run open` | `clasp open` | Open project in browser |
| `npm run status` | `clasp status` | Show which files differ |
| `npm run logs` | `clasp logs --watch` | Tail live execution logs |
| `npm run push:dry` | `clasp push --dry-run` | Preview files to be pushed |
| `npm run test` | `jest --coverage` | Run local unit test suite |

> ⚠️ Never commit `.clasp.json` — it is gitignored. Commit only `.clasp.json.template`.

---

### Option B — Manual (no CLI)

1. Go to [script.google.com](https://script.google.com) → **New project** → delete default content.
2. Copy the entire contents of `cleanup-attachments.gs` into the editor.
3. Click **Save**, then continue with step 4 below.

---

### Running & Triggering

4. **Configure:** Edit the `CONFIG` object at the top of `cleanup-attachments.gs`.

5. **Run manually first:**
   - Run `generateCleanupReport` to see your mailbox state before touching anything.
   - Then run `processGmailAttachments` to start the first batch.

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
├── config.gs                  # Configuration variables
├── main.gs                    # Main execution loop and core logic
├── reports.gs                 # Stats, HTML emails, and Spreadsheet tracking
├── migration.gs               # One-time structure migration utilities
├── gas-utils.gs               # Google Apps Script specific helpers
├── utils.gs                   # Pure utility functions (shared scope in GAS)
├── __tests__/                 # Local Jest test suites
│   └── utils.test.js          # 100% coverage tests for utils.gs
├── appsscript.json            # GAS project manifest (runtime, OAuth scopes)
├── .clasp.json.template       # clasp config template
├── .claspignore               # Files excluded from `clasp push`
├── jsconfig.json              # VS Code type-checking config (GAS + Jest)
├── package.json               # npm scripts & Jest dependency
├── CONTEXT.md                 # Persistent AI & contributor project context
├── tasks/
│   ├── todo.md                # Active task backlog
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
| `script.external_request` | Reserved for future webhook/API calls |

---

## 🤝 Contributing

1. Fork the repo and create a feature branch from `dev`.
2. Follow the existing JSDoc style for all public functions.
3. Test using `generateCleanupReport()` before and after your changes.
4. Open a PR against `dev` — never directly to `main`.

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
