# Public Handover — Gmail Cleanup Scripts

This tracked file intentionally contains no account-specific identifiers, mailbox counts, execution timestamps, or live trigger snapshot because the GitHub repository is public.

For work on a configured account, use an ignored `docs/HANDOVER.local.md`. If it is unavailable, reconstruct the current state read-only from `.clasp.json`, the Apps Script UI, and Gmail before taking any action.

## Stable operating state

- `runInboxRules` is the normal inbox classifier entry point.
- `runScheduledFinancialSublabelBackfill` is a temporary repair/backfill handler that may or may not still be installed on a given account.
- Both mailbox jobs share a script lock; a locked skip is expected and safe.
- The temporary handler repairs labels first, backfills missing bank children second, and removes only its own trigger after an empty, error-free cycle.
- Finance repair/backfill is label-only and must preserve read/archive state.
- Delayed receipt/order archive is enabled after a reviewed bounded rollout;
  automatic retention Trash remains a separate disabled rollout gate.

## What the next agent should do first

1. Run `git status --short` and confirm the expected branch.
2. Read `AGENTS.md`, `CONTEXT.md`, `KNOWLEDGE.md`, `docs/OPERATIONS.md`, `docs/FINANCE_TAXONOMY.md`, and `tasks/todo.md`.
3. Read `docs/HANDOVER.local.md` if it was transferred privately.
4. Run `npm ci`, `npm test -- --runInBand`, and `npm run status` on a new machine.
5. Inspect Apps Script executions and triggers read-only.
6. Determine whether temporary finance maintenance is active, complete, repeatedly locked, or failing before changing its schedule.
7. Sample mail missing every child label; do not treat a large institution parent count as proof of failure.

## Fresh-machine access

The real `.clasp.json` is intentionally ignored:

```bash
npm ci
npx clasp login
cp .clasp.json.template .clasp.json
```

Obtain the Script ID through a private channel or from the Apps Script UI, set it only in `.clasp.json`, then run `npm run status` before any push. `npm run open` calls `clasp open-script`.

## Private snapshot template

Keep these fields only in ignored `docs/HANDOVER.local.md`:

- last live verification date/time and timezone
- Apps Script project ID
- branch and deployed commit
- active triggers and latest executions
- current feature-flag/confirmation-token state
- latest repair/backfill summaries
- targeted Gmail label counts and sample conclusions
- next live action and its approval status

## Definition of a clean handover

- Tests pass.
- Live trigger state has been verified rather than inferred.
- Mutating work has explicit user approval.
- Private live state is current and remains outside Git.
- Tracked todo/knowledge/lessons contain reusable guidance without personal operational metadata.
- The exact proposed commit passes a secret and metadata review before remote push.
