# Operations Runbook

This project controls a live Gmail and Drive account through Google Apps Script. Prefer read-only audits, small reversible batches, explicit approval, and post-run verification.

## Local commands

```bash
npm ci                         # reproducible dependency install
npm test -- --runInBand       # local regression suite
npm run status                # files clasp would include
npm run open                  # clasp open-script
npm run push                  # live Apps Script deployment; approval required
```

`npm run push:dry` is an alias for `clasp status`; it previews inclusion but is not a simulated remote deployment.

## Live project

- Apps Script ID: local-only in `.clasp.json` and optional `docs/HANDOVER.local.md`
- Runtime: V8
- Source root: `src/`
- Normal branch: `dev`
- `.clasp.json` and `docs/HANDOVER.local.md` are local-only and must never be committed.

## Entry-point safety classes

### Read-only

- `auditInboxRules`
- `auditFinancialSublabelBackfill`
- `auditFinancialLabelRepair`
- `auditFinancialTaxonomyMigrationAdHoc`
- `auditFinancialInstitutionRehomeAdHoc`
- `auditVerifiedFinancialCorrectionsAdHoc`
- `auditInboxBacklog`
- `auditHistoricalInboxBackfill`
- `auditHistoricalStagingLabelRepair`
- `auditInboxRuleRetention`
- `auditBulkCleanup`
- `generateCleanupReport`
- `auditPendingMigration`
- `auditArchiveStructure`
- `validateNoDuplicates`
- `estimateAuditPerformance`

### Reversible or label-only

- `runInboxRules` — labels and may archive safety-cleared low-value mail according to active flags.
- `repairFinancialLabels` — finance labels only; read/archive state unchanged.
- `backfillFinancialSublabels` — parent/child finance labels only.
- `runScheduledFinancialSublabelBackfill` — repair, then backfill, then self-remove trigger.
- `migrateFinancialTaxonomyAdHoc` — moves GBM parent/children to Mercado Pago only.
- `rehomeFinancialInstitutionsAdHoc` — query-scoped Afore/Infonavit parent and
  child reassignment; token-gated and label-only.
- `repairVerifiedFinancialCorrectionsAdHoc` — exact-subject, label-only corrections.
- `stageInboxBacklog` — labels and archives; no Trash.
- `backfillHistoricalInbox` — bounded category backfill; labels first and can
  archive only safety-cleared Promotions when both dedicated gates are enabled.
- `runScheduledHistoricalInboxBackfill` — ten-minute temporary worker; removes
  only its own trigger after a complete empty, error-free cycle.
- `repairHistoricalStagingLabels` — rehomes only safety-excluded
  Promotions/Social review labels to the neutral historical `Protected` label;
  read/archive state is unchanged.
- `stageBulkCleanupCandidates` — labels and archives; no Trash.

### Destructive or high-impact

- `processGmailAttachments`
- `purgeConfirmedBulkCleanup`
- `purgeExpiredInboxRuleMail`
- `emptyConfiguredLowValueLabel`
- migration cleanup functions that trash duplicate/orphaned Drive items
- trigger installation/removal
- `deleteRetiredFinancialLabelsAdHoc` — deletes only empty retired finance labels.

Run high-impact entry points only after the matching audit and explicit approval.

## Active safety gates

- `CONFIG.DRY_RUN`: general write guard; currently `false` in deployed source.
- `ENABLE_DOCUMENT_RECORD_ARCHIVE`: currently `false`; enable only for a separately reviewed rollout.
- `ENABLE_RULE_RETENTION_TRASH`: currently `false`.
- `INBOX_BACKLOG_CONFIRMATION`: empty by default.
- Historical backfill and historical staging-repair tokens are empty by
  default; Promotions archive remains false and the manual policy pin must be
  named explicitly for an approved batch.
- Finance backfill, repair, migration, and ad hoc correction tokens are empty by default.
- Destructive label-emptying requires both a target label and exact typed confirmation.

After the temporary finance scheduler completes and self-removes, consider clearing its two confirmation tokens in a reviewed follow-up deployment. Do not clear them while expecting the trigger to continue.

## Finance scheduler runbook

1. Inspect Apps Script **Executions** and **Triggers**.
2. Confirm no mailbox execution is currently active before a manual run.
3. Run `auditFinancialLabelRepair` and `auditFinancialSublabelBackfill` if a current count is needed.
4. Prefer the installed ten-minute trigger over manual repetition.
5. Expected lock collision log:

   ```text
   Financial label repair skipped — another mailbox execution is running.
   ```

   This is not a failure.

6. Expected repair log:

   ```text
   Financial label repair complete — reclassified=N, legacyRemoved=N, errors=0. Read/archive state unchanged.
   ```

7. Once repair returns zero changes, the same handler begins backfill.
8. The trigger deletes itself only when backfill returns `labelled=0, errors=0`.
9. After completion, sample Gmail and refresh ignored `docs/HANDOVER.local.md`; add only reusable, sanitized guidance to tracked docs.

## Historical category-backfill runbook

1. Verify Apps Script executions and triggers read-only. The existing hourly
   `runInboxRules` trigger must remain unchanged.
2. Run `auditHistoricalInboxBackfill()` and review the capped counts, query
   scopes, sample subjects, and reported exclusions for Promotions, Social, and
   every Updates subtype. Record account-specific results only in the ignored
   local handover.
3. Promotions is the first possible archive lane. Before enabling it, sample
   the pending label and confirm that no protected sender/content, star,
   importance, sent reply, or attachment was admitted.
4. Keep Social and all Updates policies label-only. Promotions and Social route
   every runtime safety exclusion—including recruiter, connection, invitation,
   reply, sent-thread, attachment, star/importance, protected sender, and
   protected content—to `Cleanup_Review/Historical/Protected`, never to either
   category staging label. Updates are
   separated into Security, Finance, Documents, Travel, Uber/orders/receipts,
   action-required, Digests, and Unclassified for human review.
5. For a reviewed live run, set only
   `HISTORICAL_INBOX_BACKFILL_CONFIRMATION` to
   `APPLY_HISTORICAL_INBOX_BACKFILL`. Keep
   `HISTORICAL_INBOX_BACKFILL_ARCHIVE_PROMOTIONS` false for label-only staging.
   Set it true only after a separate Promotions audit approval.
6. `backfillHistoricalInbox()` processes one policy at a time in batches of 25
   under the shared lock. For a manual batch, set
   `HISTORICAL_INBOX_BACKFILL_ACTIVE_POLICY_NAME` to the explicitly reviewed
   policy; leave it blank only for the approved all-policy scheduler. The
   review label is the durable cursor, so retries are idempotent.
   `resetHistoricalInboxBackfillState()` only resets the cursor; it does not
   remove labels or change Gmail. DRY_RUN neither advances nor resets the
   cursor and never installs or removes the temporary trigger.
7. If a temporary schedule is approved, install
   `installHistoricalInboxBackfillSchedule()`. It runs every ten minutes and
   removes only `runScheduledHistoricalInboxBackfill` after all policies are
   empty in a full scan with no errors. Remove it immediately with
   `removeHistoricalInboxBackfillSchedule()` to stop the process.
8. Before another Promotions/Social batch, run
   `auditHistoricalStagingLabelRepair()`. It reads exactly
   `label:"Cleanup_Review/Historical/Promotions" -in:spam -in:trash` and
   `label:"Cleanup_Review/Historical/Social" -in:spam -in:trash`, inspects at
   most the configured repair batch per label, and applies the same runtime
   safety checks without changing Gmail.
9. A separately approved correction sets
   `HISTORICAL_INBOX_BACKFILL_LABEL_REPAIR_CONFIRMATION` to
   `REPAIR_HISTORICAL_STAGING_LABELS` and runs
   `repairHistoricalStagingLabels()`. Matching threads first receive
   `Cleanup_Review/Historical/Protected`, then lose only the incorrect category
   review label. The operation does not mark read, archive, move to Inbox, or
   use Trash. Re-running is idempotent; reversing it manually means restoring
   the original review label before removing `Protected`.
10. To reverse any other reviewed staged batch, remove the corresponding
   `Cleanup_Review/Historical/...` label manually. If Promotions was ever
   archived under separate approval, move it back to Inbox. Nothing in this
   workflow uses Trash.

## Deployment checklist

1. Confirm the requested change and live-effect boundaries.
2. Check `git status --short`; preserve unrelated edits.
3. Run the focused tests, then the entire Jest suite.
4. Run `npm run status` and verify only `src/*.gs` plus `src/appsscript.json` deploy.
5. Check live executions for lock contention.
6. Obtain user approval.
7. Run `npm run push`.
8. Observe one non-overlapping execution.
9. Inspect logs and verify Gmail counts or labels.
10. Update the local handover if production state changed; sanitize any reusable tracked documentation.

## Ad hoc finance taxonomy consolidation

1. Run `auditFinancialTaxonomyMigrationAdHoc()` and
   `auditVerifiedFinancialCorrectionsAdHoc()` read-only.
2. Confirm there are no unknown GBM child labels and no active mailbox execution.
3. Temporarily set the exact migration/correction tokens only for the reviewed run.
4. Run `migrateFinancialTaxonomyAdHoc()` until `labelMoves=0`, then
   `repairFinancialLabels()` and `repairVerifiedFinancialCorrectionsAdHoc()`.
5. Re-run the read-only finance audits and verify parent+child coexistence under
   Mercado Pago.
6. Independently authorize `deleteRetiredFinancialLabelsAdHoc()` only after all
   GBM and BBVA labels report zero threads. It refuses to delete any non-empty label.
7. Clear every temporary token in a follow-up deployment.

None of these functions changes read, archive, spam, or Trash state.

## Query-scoped Afore/Infonavit rehome

1. Run `auditFinancialInstitutionRehomeAdHoc()` and review totals, missing
   target parents, and stale Banamex assignments.
2. Verify no Apps Script execution is active and no temporary trigger exists.
3. Set `FINANCIAL_INSTITUTION_REHOME_CONFIRMATION` to the exact reviewed token,
   deploy with explicit approval, and run `rehomeFinancialInstitutionsAdHoc()`.
4. Repeat until `changed=0`, rerun the read-only audit, and verify each target
   thread has its parent plus exactly one child.
5. Clear the token in a follow-up deployment.

The operation never changes read/archive state and removes only old finance
labels on threads matched by the reviewed institution query.

## Recovery guidance

- Wrong child label: correct the classifier and use a targeted label-only repair. Do not remove the institution parent.
- Long execution: retain the 4.5-minute loop guards and reduce per-run reads/batch size before increasing trigger frequency.
- Repeated lock skips: compare hourly execution duration with the temporary interval; do not remove the lock.
- Query misses accented Spanish: add accent expansion and keep long OR groups chunked.
- Dirty local versus remote source: inspect history and diffs. Avoid `clasp pull` until local work is safely committed or copied.
- Unexpected Trash behavior: disable the responsible feature flag/trigger first, then audit. Do not empty Gmail Trash automatically.

## Session wrap-up

Use `tasks/checklist.md`. At minimum update the ignored live snapshot, active todo items, lessons, tests, and deployment state. Commit reusable project knowledge together with the code it describes, but keep account metadata local.
