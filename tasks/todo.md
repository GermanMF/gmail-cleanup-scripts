# Active Backlog — Gmail Cleanup Scripts

Last reviewed: **2026-08-28**

This is the authoritative next-work list. Historical accomplishments belong in `tasks/lessons.md` and the Git history.

## High priority — live finance rollout

Current account-specific progress belongs in ignored `docs/HANDOVER.local.md`.

- [x] Re-audit the 269 historical parent-only threads outside the configured ten-year lookback before deciding on a separate batch.

## Medium priority — inbox rollout decisions

- [x] Configure and run live read-only `auditHistoricalInboxBackfill`; record
  account counts and samples only in ignored `docs/HANDOVER.local.md`.
- [x] Review staged Promotions and Social samples. Both contained conversation-
  shaped mail, so Promotions archive remains disabled and both stay label-only.
- [x] Add local protection that routes all Promotions/Social safety exclusions
  to the neutral historical `Protected` label instead of category staging.
- [x] Deploy the token-empty protection and run the read-only
  `auditHistoricalStagingLabelRepair` before any further historical batch.
- [x] Review that audit and complete one approved label-only repair that
  rehomes only affected staged threads; no archive or Trash.
- [x] Review accumulated receipt/order samples before considering `ENABLE_DOCUMENT_RECORD_ARCHIVE`.
- [x] Run `auditInboxRuleRetention` and review every affected low-value label before considering `ENABLE_RULE_RETENTION_TRASH`.
- [x] Re-audit hourly `runInboxRules` duration after finance maintenance completes; normal runs should stay below the lock-contention window.
- [x] Diagnose the remaining seven-day `runInboxRules` error-rate history
  read-only. The failed hourly executions were caused by daily Gmail quota
  exhaustion while the former temporary finance scheduler was active;
  subsequent hourly and post-deploy runs completed normally, so the stable
  trigger remains unchanged.
- [ ] Add any newly observed bank-specific vocabulary only with real examples and regression tests.

## Low priority / deferred

- [ ] Decide whether the Drive archive should eventually move from My Drive to a Shared Drive.
- [ ] Revisit multi-account support only if the project moves away from one-account Apps Script execution.
- [ ] Consider durable Sheets logging for critical trigger summaries if Apps Script execution history is insufficient.

## Recently completed

- [x] Complete a bounded receipt/order archive rollout and verify attachment
  protections; keep the rollout gate disabled outside an approved run.
- [x] Add dedicated Afore and Infonavit finance parents, rehome all 54 verified
  threads with exactly one child, remove stale Banamex assignments, and clear
  the temporary token without changing read/archive state.
- [x] Audit all 293 `Auto/LowValue/Routine Updates` threads and retire the catch-all Updates lane from inbox, backlog, and retention configuration.
- [x] Add observed `uala.mx` and `mercadopago.com` finance sender domains.
- [x] Retire the redundant cross-institution `Auto/Finance/Records` rule after reviewing its complete live sample; preserve institution and subcategory labels.
- [x] Verify the temporary finance scheduler self-removed; retain only the hourly `runInboxRules` trigger.
- [x] Consolidate all GBM-origin parent/child assignments into Mercado Pago without changing read/archive state.
- [x] Correct the exact Ualá promotion false positive and verify the source pattern count returned to zero.
- [x] Reject 18 apparent statement candidates that lacked current-document evidence; align the audit with the repair evidence gate.
- [x] Backfill two newly arrived parent-only threads and verify zero missing children for all 10 institutions within the ten-year lookback.
- [x] Delete the four empty retired GBM/BBVA labels and verify both paths are absent.
- [x] Clear all finance repair/backfill/ad hoc confirmation tokens after the reviewed live batch.
- [x] Deploy the original shared institution/child finance taxonomy for 12 institutions.
- [x] Add Ualá-specific promotion and investment vocabulary.
- [x] Require attachment or explicit access/download evidence for statements.
- [x] Repair verified Santander statement false positives into Security and Service Notices.
- [x] Verify the sampled Santander statement label contained document-backed statements and no known false patterns.
- [x] Add accent-aware, length-chunked historical Gmail queries.
- [x] Add the locked, ten-minute, self-removing finance repair/backfill trigger.
- [x] Replace catch-all Updates actionable classification with explicit action-required and routine lanes.
- [x] Keep automatic retention Trash and delayed record/routine archive disabled during sampling.
- [x] Add repository handover documentation, `AGENTS.md`, durable knowledge, checklists, and a repo-scoped Codex skill.
