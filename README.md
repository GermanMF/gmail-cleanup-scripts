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
- **Small file filtering** — inline signature images under 10 KB are skipped automatically.
- **Comprehensive reporting** — `generateCleanupReport()` prints a rich snapshot to the Execution Log with mailbox stats, top senders, Drive archive state, and estimated runs remaining.
- **One-time migration helpers** — two migration functions handle existing archives from older folder structures.

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
};
```

---

## 📦 Entry Points

| Function | Description |
|---|---|
| `processGmailAttachments()` | **Main function** — run this manually or on a trigger |
| `generateCleanupReport()` | Stats-only report, safe to run anytime |
| `migrateOldStructure()` | Stage 1 migration: old `YYYY/MM_Month/` → `email@domain/YYYY/` |
| `migrateEmailFoldersToDisplayName()` | Stage 2 migration: `email@domain/` → `DisplayName/email/` |

---

## 🛠️ Setup & Deployment

### Prerequisites
- A Google Account with Gmail and Drive access.
- Access to [Google Apps Script](https://script.google.com).

### Steps

1. **Create a new Apps Script project:**
   - Go to [script.google.com](https://script.google.com) → **New project**
   - Delete all default content.

2. **Paste the script:**
   - Copy the entire contents of `cleanup-attachments.gs` into the script editor.

3. **Configure:**
   - Edit the `CONFIG` object at the top to match your preferences.

4. **Run manually first:**
   - Run `generateCleanupReport` to see your mailbox state before touching anything.
   - Then run `processGmailAttachments` to start the first batch.

5. **Set up a time-based trigger (optional):**
   - Go to **Triggers** (clock icon) → **Add Trigger**.
   - Function: `processGmailAttachments`
   - Event source: Time-driven → e.g., **Daily** at your preferred hour.

6. **Grant permissions:**
   - On first run, Google will ask to authorize Gmail and Drive access. Review and approve.

---

## 🗂️ Project Structure

```
gmail-cleanup-scripts/
├── cleanup-attachments.gs   # Main Apps Script (deploy to Google Apps Script)
├── jsconfig.json            # VS Code / editor type-checking config
├── tasks/
│   ├── todo.md              # Active task backlog
│   └── lessons.md           # Session lessons log
└── README.md                # This file
```

---

## 🔒 Permissions Required

| Scope | Reason |
|---|---|
| `https://mail.google.com/` | Read threads, add labels, trash emails |
| `https://www.googleapis.com/auth/drive` | Create folders and files in Drive |

---

## 🤝 Contributing

1. Fork the repo and create a feature branch from `dev`.
2. Follow the existing JSDoc style for all public functions.
3. Test using `generateCleanupReport()` before and after your changes.
4. Open a PR against `dev` — never directly to `main`.

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
