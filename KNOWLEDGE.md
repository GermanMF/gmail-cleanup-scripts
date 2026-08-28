# Durable Project Knowledge

This file records stable decisions and non-obvious invariants. Use `docs/HANDOVER.md` for the current live snapshot and `tasks/todo.md` for pending work.

## System model

- Google Apps Script has one shared global scope across every file in `src/`.
- The repository has no build step. `clasp` pushes `src/*.gs` and `src/appsscript.json` directly.
- Gmail attachment retention and mailbox cleanup are separate lanes with different safety contracts.
- Gmail categories are candidate signals, not authority. Finance, security, receipts, and sent conversations require runtime protection.

## Data-safety invariants

- Gmail mutation after attachment processing requires a complete, verified backup summary.
- Inline MIME parts are excluded using Gmail attachment options; small files are not discarded by size.
- Same-name duplicates are compared by content. Same-name/different-content attachments are preserved with deterministic suffixes.
- Failed backups, excluded senders, and ambiguous attachment state go to manual review.
- Automatic retention Trash is off by default. Bulk Trash requires a separate user-applied confirmation label or exact config token.
- Finance repair/backfill is label-only and must not alter read/archive state.

## Inbox automation model

- Rules are ordered and first-match for terminal rules.
- Institution classifiers are non-terminal so a bank promotion can receive both a bank label and a low-value label.
- Real attachments, protected domains/content, starred/important state, and sent-thread participation can block low-value archive/Trash behavior.
- `runInboxRules` and finance maintenance share a script lock.
- Historical category backfill is separate from `runInboxRules`: review labels
  form its durable cursor, Social and Updates remain label-only, and Promotions
  may archive only after a reviewed audit and two explicit rollout gates.
- Promotions/Social candidates that fail any runtime safety check go to the
  neutral historical `Protected` label, never to either category staging label.
  Repair rehomes labels only and must preserve Inbox/read/archive state.
- `ENABLE_DOCUMENT_RECORD_ARCHIVE` and `ENABLE_RULE_RETENTION_TRASH` are
  independent rollout gates, not ordinary tuning switches. Keep both disabled
  unless the corresponding reviewed workflow is intentionally active.
- Do not recreate a catch-all `Routine Updates` label from Gmail's `category:updates`; explicit security, action, document, finance, digest, and promotion rules must own those messages.

## Finance model

- Institution parent labels and message-type child labels are orthogonal. Keep both.
- All institutions share the same child names; bank-specific polymorphism is limited to vocabulary and precedence.
- Statements need a document or explicit current-document access/download evidence.
- A subject containing `estado de cuenta` can still be Security, Service, or Other.
- Do not add a cross-institution finance `Records` label: institution plus message-type child labels are sufficient, and archive eligibility must use explicit categories and safety exclusions.
- Ualá marketing requires promotion precedence over generic transaction words.
- Historical Gmail queries need explicit accent variants and length-aware chunking.
- Treat `mercadopago.com.mx`, `mercadopago.com`, and `gbm.com.mx` as one Mercado Pago institution;
  do not recreate a separate GBM hierarchy.
- BBVA is intentionally absent from the configured account taxonomy.
- Ualá live mail uses both `uala.com.mx` and `uala.mx` sender domains.
- Afore and Infonavit are institution-level parents so their messages retain a
  separate type child; do not add either name as a shared child category.
- Never split Afore by the word alone: Banamex transaction bodies can contain
  `AFORE MOVIL` as a merchant. Use verified Afore senders/exact subjects.

## Performance constraints

- Apps Script executions have a practical six-minute ceiling; long loops stop around 4.5 minutes.
- `GmailThread.getMessages()` is expensive at mailbox scale. Prefer Gmail indexed queries and bulk label methods.
- `GmailApp.search` pages at 500; direct bounded searches are samples unless explicitly paginated.
- Trigger frequency must remain comfortably above normal batch duration. Lock skips are safer than overlapping work.
- Recursive Drive scans require resumable state for large archives.

## Tooling and deployment

- `@google/clasp` 3.x uses `clasp open-script`; an invalid command can print help without making the intended action obvious.
- `.clasp.json` contains the live Script ID/config and is intentionally ignored.
- `npm run status` shows deployment inclusion, not a remote diff simulation.
- Node/Jest imports use guarded `module.exports` blocks that GAS ignores.

## Documentation ownership

- `AGENTS.md`: automatic repository instructions.
- `.agents/skills/gmail-cleanup-operations/SKILL.md`: reusable Codex workflow.
- `CONTEXT.md`: architecture and component map.
- `docs/HANDOVER.md`: dated production snapshot.
- `docs/OPERATIONS.md`: safe runbooks.
- `docs/FINANCE_TAXONOMY.md`: financial classification knowledge.
- `tasks/todo.md`: authoritative next work.
- `tasks/checklist.md`: repeatable verification/wrap-up lists.
- `tasks/lessons.md`: append-only discoveries and failure modes.
