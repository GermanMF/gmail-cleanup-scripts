# Project Context — Gmail Cleanup Scripts

Last architecture update: **2026-08-27**

Read this file for the system map. Then read `docs/HANDOVER.md` for live state and `KNOWLEDGE.md` for stable invariants.

## Purpose

This Google Apps Script suite manages one Gmail/Drive account through two safety-separated lanes:

1. Archive real email attachments to a verified Drive hierarchy, then apply the configured retention policy.
2. Classify and stage mailbox cleanup using ordered rules, explicit protections, reversible labels, and gated destructive actions.

It also contains reporting, dashboard, migration, duplicate cleanup, and resumable Drive-audit utilities.

## Repository map

```text
gmail-cleanup-scripts/
├── AGENTS.md                         automatic Codex repository instructions
├── CONTEXT.md                        architecture and component map
├── KNOWLEDGE.md                      stable decisions and invariants
├── README.md                         user-facing setup and feature guide
├── .agents/skills/
│   └── gmail-cleanup-operations/
│       └── SKILL.md                  repo-scoped operational skill
├── docs/
│   ├── HANDOVER.md                   dated live-production snapshot
│   ├── OPERATIONS.md                 deployment/trigger/recovery runbook
│   └── FINANCE_TAXONOMY.md           bank labels and statement evidence rules
├── src/
│   ├── appsscript.json               GAS manifest and OAuth scopes
│   ├── main.gs                       verified attachment pipeline
│   ├── config.gs                     all configuration and rule definitions
│   ├── inbox-rules.gs                inbox rules, finance repair/backfill, retention
│   ├── bulk-cleanup.gs               stage/review/confirm mailbox cleanup
│   ├── cleanup-junk.gs               resumable Drive junk audit/confirmation
│   ├── migration.gs                  one-time Drive hierarchy migration/cleanup
│   ├── reports.gs                    logger, email, and Sheets reporting
│   ├── gas-utils.gs                  GAS-bound helpers
│   └── utils.gs                      pure/testable utilities
├── __tests__/
│   ├── utils.test.js
│   ├── config.test.js
│   └── inbox-rules.test.js
└── tasks/
    ├── todo.md                       authoritative active backlog
    ├── checklist.md                  deployment and wrap-up checklists
    └── lessons.md                    append-only operational lessons
```

All `.gs` files share the Apps Script global scope. There are no runtime imports or build artifacts.

## Deployment model

- Local source root: `src/`
- Remote Apps Script project ID: stored only in ignored `.clasp.json` and optional `docs/HANDOVER.local.md`
- Primary branch: `dev`
- Deploy: `npm run push`
- Open editor: `npm run open` (`clasp open-script`)
- Test: `npm test -- --runInBand`
- Preview included GAS files: `npm run status`

The real `.clasp.json` is ignored and must be recreated on a new computer from `.clasp.json.template`; obtain the Script ID through a private channel or the Apps Script UI.

## Attachment retention lane

Date policy uses the newest message in a thread:

```text
< 3 months    untouched
3–6 months   verified Drive archive; Gmail retained
> 6 months   verified Drive archive; Gmail moved to Trash
```

Target Drive hierarchy:

```text
Gmail_Attachments_Archive/
└── Category/
    └── FriendlyName/
        └── YYYY/
            └── YYYYMMDD_localpart_OriginalFilename.ext
```

Core safety behavior:

- Non-inline attachments are preserved regardless of small size.
- Saved files are verified by content; identical duplicates are reused.
- Same-name/different-content collisions receive deterministic suffixes.
- Any failure or ambiguity blocks Gmail deletion and sends the thread to review.

## Inbox automation lane

`CONFIG.INBOX_RULES` is ordered. Institution rules are non-terminal; most other rules are terminal per run.

Main lanes:

- priority Security
- explicit finance action required
- developer/security/failure notices
- documents, receipts, and orders
- low-value bank marketing, digests, promotions, and social mail

Runtime safety rechecks real attachments, protected senders/content, starred/important state, and sent-thread participation. Gmail category membership alone never authorizes a destructive action.

Current rollout gates are documented in `docs/OPERATIONS.md`.

## Financial classification

Each configured institution receives:

```text
Auto/Finance/<Institution>
Auto/Finance/<Institution>/<Message type>
```

Shared children are Security, Mortgage, Credits, Statements, Investments, Payments/Due Dates, Transactions, Promotions/Benefits, Cards, Service Notices, and Other (Gmail labels use the Spanish names in `docs/FINANCE_TAXONOMY.md`).

Statements are evidence-aware: a matching subject must also have a statement document or explicit current-document access/download wording. Afore and Infonavit have dedicated parents while retaining the shared type children. Ualá adds institution-specific vocabulary and promotion precedence while keeping the same child taxonomy.

Historical finance maintenance is label-only:

1. Repair known incorrect statement/Other assignments and remove obsolete finance-only labels.
2. Backfill parent/child labels in bounded batches.
3. Self-remove the temporary trigger after an empty, error-free repair/backfill cycle.

The configured taxonomy has twelve institutions, including dedicated Afore and
Infonavit parents. GBM-origin mail belongs to the Mercado Pago hierarchy, and
BBVA is intentionally not configured.

## Important configuration gates

| Config | Current intent |
|---|---|
| `DRY_RUN` | Global write guard for supported workflows; normally false after reviewed samples |
| `ENABLE_DOCUMENT_RECORD_ARCHIVE` | Enabled after reviewed receipt/order sampling; archives eligible records after 14 days |
| `ENABLE_RULE_RETENTION_TRASH` | Keep false until retention audit is explicitly approved |
| `INBOX_BACKLOG_CONFIRMATION` | Empty unless applying one reviewed reversible backlog batch |
| `FINANCIAL_SUBLABEL_BACKFILL_CONFIRMATION` | Populated only while the temporary finance workflow is intentionally active |
| `FINANCIAL_LABEL_REPAIR_CONFIRMATION` | Populated only while finance repair is intentionally active |
| `FINANCIAL_INSTITUTION_REHOME_CONFIRMATION` | Exact temporary token for the reviewed Afore/Infonavit label-only migration |

## Entry-point groups

Read-only audits:

- `auditInboxRules`
- `auditFinancialSublabelBackfill`
- `auditFinancialLabelRepair`
- `auditInboxBacklog`
- `auditInboxRuleRetention`
- `auditBulkCleanup`
- `generateCleanupReport`
- Drive migration/junk audits

Routine/temporary automation:

- `runInboxRules`
- `runScheduledFinancialSublabelBackfill`
- `installInboxAutomation` / `removeInboxAutomation`
- `installFinancialSublabelBackfillSchedule` / `removeFinancialSublabelBackfillSchedule`

High-impact functions and exact safety details are listed in `docs/OPERATIONS.md`.

## Known constraints

- Practical Apps Script execution ceiling: six minutes; loops stop near 4.5 minutes.
- Gmail search pages at 500.
- Thread message reads are much slower than indexed search plus bulk label operations.
- Gmail historical search needs explicit accent variants even though pure matching normalizes accents.
- Parent finance label counts remain high by design.
- Logger output is ephemeral; production verification should include execution logs plus Gmail/Drive state.

## Handover protocol

At the end of a material session:

1. Update ignored `docs/HANDOVER.local.md` with the dated live snapshot; never put account-specific state in the public repository.
2. Update `tasks/todo.md` and `tasks/checklist.md`.
3. Add durable findings to `KNOWLEDGE.md` and `tasks/lessons.md`.
4. Update this file only when architecture changes.
5. Run tests and deployment-status checks.
6. Scan the proposed commit for secrets and private operational metadata.
7. Commit and push only with the appropriate user authorization.
