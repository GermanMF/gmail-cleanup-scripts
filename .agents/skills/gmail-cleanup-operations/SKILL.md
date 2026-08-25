---
name: gmail-cleanup-operations
description: Resume, audit, modify, deploy, or hand over this Gmail Cleanup Scripts repository, especially its live Apps Script triggers, finance taxonomy, statement evidence rules, and safety-gated mailbox operations. Do not use for unrelated Gmail projects.
---

# Gmail Cleanup Operations

Operate this repository without reconstructing its history or weakening its mailbox safeguards.

## Load the right context

Always read:

- `../../../CONTEXT.md`
- `../../../KNOWLEDGE.md`
- `../../../docs/HANDOVER.md`
- `../../../tasks/todo.md`

If `../../../docs/HANDOVER.local.md` exists, read it after the public handover and treat it as the authoritative account-specific snapshot. Never commit that file.

For live execution, deployment, triggers, or a fresh-machine setup, also read `../../../docs/OPERATIONS.md` and `../../../tasks/checklist.md`.

For bank labels or financial classification, also read `../../../docs/FINANCE_TAXONOMY.md`.

Treat timestamps and mailbox counts in the local handover as a snapshot. Verify current Apps Script executions, triggers, and Gmail counts before drawing operational conclusions.

## Safety contract

- Start with read-only audits and local tests.
- Get explicit approval immediately before a live mutation: `clasp push`, a mutating Apps Script function, trigger installation/removal, Gmail/Drive changes, or a Git remote push.
- Do not enable automatic Trash or record/routine archiving without a reviewed audit and explicit instruction.
- Check for active executions before running a mailbox function manually. Respect the shared script lock; a skipped locked run is normal.
- Finance repair and backfill are label-only. Preserve read/archive state and parent-plus-child label semantics.
- Preserve unrelated working-tree changes.
- This repository is public. Keep Script IDs, account addresses, live mailbox counts, execution timestamps, and trigger snapshots out of tracked files.

## Change workflow

1. Inspect `git status`, the relevant config/rules, and the current live state.
2. Make the smallest change that preserves the documented invariants.
3. Add or update Jest coverage for classification and safety behavior.
4. Run `npm test -- --runInBand` and `npm run status`.
5. Summarize predicted live effects and obtain approval before deployment.
6. After deployment, observe one non-overlapping execution and verify Gmail counts. Avoid long polling when the existing scheduler can finish safely.
7. Refresh ignored `docs/HANDOVER.local.md` for live state; update tracked handover, knowledge, backlog, and lessons only with sanitized reusable guidance.

## Finance-specific rules

- Institution is the parent dimension; message type is the child dimension.
- `Estados de cuenta` requires a statement document attachment or explicit current-document access/download language. A keyword mention alone is insufficient.
- Consultation, paperless, education, design, and password-instruction notices are not statements.
- Ualá uses the shared taxonomy with bank-specific vocabulary and promotion precedence over generic transaction words.
- Historical queries must preserve accent variants and stay below practical Gmail query-length limits.
