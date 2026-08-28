# Project Checklists

## New-agent / new-computer handover

- [ ] Clone the repository and check out `dev`.
- [ ] Read `AGENTS.md`, `CONTEXT.md`, `KNOWLEDGE.md`, and `docs/HANDOVER.md`.
- [ ] If privately transferred `docs/HANDOVER.local.md` exists, read it and re-verify its dated state.
- [ ] Read `docs/OPERATIONS.md`; read `docs/FINANCE_TAXONOMY.md` for bank work.
- [ ] Run `npm ci`.
- [ ] Run `npm test -- --runInBand`.
- [ ] Copy `.clasp.json.template` to `.clasp.json`, obtain the Script ID through a private channel or Apps Script UI, and authenticate with `npx clasp login`.
- [ ] Run `npm run status`; do not push yet.
- [ ] Inspect current Apps Script executions and triggers read-only.
- [ ] Compare the live state with the dated snapshot before taking action.

## Before a code change

- [ ] Confirm whether the request is read-only, diagnostic, reversible, or destructive.
- [ ] Check `git status --short` and preserve unrelated changes.
- [ ] Identify active triggers and possible script-lock contention.
- [ ] Read the relevant source, tests, and domain documentation.
- [ ] State expected Gmail/Drive effects before a live mutation.

## Before Apps Script deployment

- [ ] Add or update regression tests.
- [ ] Run focused tests.
- [ ] Run `npm test -- --runInBand`.
- [ ] Run `npm run status` and verify the deployment file list.
- [ ] Verify no accidental config gate enables Trash or record/routine archive.
- [ ] Check for active mailbox executions.
- [ ] Obtain explicit user approval for `npm run push`.

## After Apps Script deployment

- [ ] Record the push timestamp.
- [ ] Observe one non-overlapping execution or a controlled sample.
- [ ] Check logs for changes, errors, lock skips, and read/archive guarantees.
- [ ] Verify Gmail/Drive state with targeted counts or samples.
- [ ] Avoid repeated manual batches when an active scheduler can finish safely.
- [ ] Refresh `docs/HANDOVER.md` and `tasks/todo.md`.

## Finance-rule review

- [ ] Sender query matches real messages.
- [ ] Shared child taxonomy remains intact.
- [ ] Security beats broad transaction/payment language.
- [ ] Promotions do not become transactions because of marketing wording.
- [ ] Statements have PDF/XML/ZIP or explicit current-document access/download evidence.
- [ ] Consultation, Paperless, education, design, and password-instruction notices are excluded from statements.
- [ ] Incoming and historical paths agree, including accented variants.
- [ ] Parent and child are both preserved.
- [ ] Repair/backfill changes labels only.

## Historical category-backfill review

- [ ] `runInboxRules` source and hourly trigger behavior are unchanged.
- [ ] Backfill token is empty unless one exact live batch is approved.
- [ ] A manual batch pins one explicitly reviewed policy.
- [ ] DRY_RUN neither persists/resets the cursor nor installs/removes triggers.
- [ ] Promotions archive is false; Social and Updates are label-only.
- [ ] Promotions/Social safety exclusions route to the historical `Protected`
  label and never receive their category staging labels.
- [ ] Run the read-only staging-repair audit before correcting older labels.
- [ ] Any repair adds `Protected` before removing only the wrong review label;
  it does not change read/archive state and never uses Trash.

## Session wrap-up

- [ ] Run tests and record the final count.
- [ ] Run `npm run status` if source changed.
- [ ] Update `tasks/todo.md`.
- [ ] Add the session lesson at the top of `tasks/lessons.md`.
- [ ] Update `KNOWLEDGE.md` for durable decisions.
- [ ] Update `CONTEXT.md` for architecture changes.
- [ ] Update ignored `docs/HANDOVER.local.md` for live-state changes; sanitize tracked documentation.
- [ ] Verify skill links and run the skill validator if the skill changed.
- [ ] Inspect `git diff --check` and `git status --short`.
- [ ] For the public remote, scan the exact proposed commit for credentials, Script IDs, account addresses, live mailbox counts, and trigger/execution timestamps.
- [ ] Obtain approval before Git remote push when it was not already explicitly requested.
