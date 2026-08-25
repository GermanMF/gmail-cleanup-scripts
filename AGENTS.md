# Gmail Cleanup Scripts — repository instructions

## Start here

- Read `CONTEXT.md`, `KNOWLEDGE.md`, `docs/HANDOVER.md`, and `tasks/todo.md` before changing behavior. If `docs/HANDOVER.local.md` exists, read it as the authoritative live snapshot.
- For finance work, also read `docs/FINANCE_TAXONOMY.md`.
- For deployment, triggers, or live Gmail work, read `docs/OPERATIONS.md` and `tasks/checklist.md`.

## Production safety

- This repository controls a live Gmail/Drive Apps Script project. Read-only audits are the default first step.
- Obtain explicit user approval immediately before `clasp push`, running a mutating Apps Script entry point, installing/removing triggers, enabling retention Trash, or pushing Git commits remotely.
- Never enable `ENABLE_RULE_RETENTION_TRASH` or destructive confirmation tokens as a convenience. Preserve the existing safety gates and typed confirmation tokens.
- Check Apps Script executions before a manual run. `runInboxRules` and the temporary finance scheduler share a script lock; a skipped locked run is expected and safe.
- Parent finance labels intentionally remain alongside child labels. Do not interpret a large parent count as failed child classification; audit mail missing every child label instead.
- Preserve unrelated dirty-worktree changes. Do not reset, discard, or overwrite them.

## Development workflow

- All files in `src/` share one Google Apps Script global scope. Avoid duplicate top-level names.
- Keep pure logic in `src/utils.gs` when practical and export Node-testable functions through the guarded `module.exports` blocks.
- Run `npm test -- --runInBand` after code changes. Run `npm run status` before any Apps Script deployment.
- `npm run push` deploys `src/` to Apps Script. `npm run open` uses `clasp open-script`.
- Keep account-specific IDs, timestamps, mailbox counts, and live trigger state in ignored `docs/HANDOVER.local.md`; keep tracked documentation safe for this public repository.
- Update `CONTEXT.md`, `KNOWLEDGE.md`, `docs/HANDOVER.md`, `tasks/todo.md`, and `tasks/lessons.md` when public architecture or operating guidance changes materially.

## Current scope boundaries

- Attachment archival and mailbox cleanup are separate safety lanes.
- Finance repair/backfill may add or remove labels but must not change read/archive state.
- The temporary finance trigger is self-removing only after repair and backfill both produce an empty, error-free batch. Verify live state; do not trust a dated snapshot blindly.
