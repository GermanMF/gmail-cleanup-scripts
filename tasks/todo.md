# Active Backlog — Gmail Cleanup Scripts

Last reviewed: **2026-08-24**

This is the authoritative next-work list. Historical accomplishments belong in `tasks/lessons.md` and the Git history.

## High priority — live finance rollout

Current account-specific progress belongs in ignored `docs/HANDOVER.local.md`. At handover time, finance repair was still ahead of historical child-label backfill.

- [ ] Confirm whether `runScheduledFinancialSublabelBackfill` has completed and removed its temporary trigger.
- [ ] After completion, run the read-only finance repair/backfill audits and record final counts in `docs/HANDOVER.md`.
- [ ] Sample Ualá child labels after backfill. Verify promotion versus transaction and investment/service examples from `docs/FINANCE_TAXONOMY.md`.
- [ ] Sample every institution for false `Estados de cuenta` assignments; attachment-less results must contain explicit current-document access/download evidence.
- [ ] Once the temporary trigger is gone and audits are clean, decide whether to clear the two finance confirmation tokens and deploy that cleanup.

## Medium priority — inbox rollout decisions

- [ ] Review accumulated `Auto/Finance/Records` and `Auto/LowValue/Routine Updates` samples before changing `ENABLE_INBOX_RECORD_ARCHIVE`.
- [ ] Run `auditInboxRuleRetention` and review every affected low-value label before considering `ENABLE_RULE_RETENTION_TRASH`.
- [ ] Re-audit hourly `runInboxRules` duration after finance maintenance completes; normal runs should stay below the lock-contention window.
- [ ] Add any newly observed bank-specific vocabulary only with real examples and regression tests.

## Low priority / deferred

- [ ] Decide whether the Drive archive should eventually move from My Drive to a Shared Drive.
- [ ] Revisit multi-account support only if the project moves away from one-account Apps Script execution.
- [ ] Consider durable Sheets logging for critical trigger summaries if Apps Script execution history is insufficient.

## Recently completed

- [x] Deploy shared institution/child finance taxonomy for 12 institutions.
- [x] Add Ualá-specific promotion and investment vocabulary.
- [x] Require attachment or explicit access/download evidence for statements.
- [x] Repair verified Santander statement false positives into Security and Service Notices.
- [x] Verify the sampled Santander statement label contained document-backed statements and no known false patterns.
- [x] Add accent-aware, length-chunked historical Gmail queries.
- [x] Add the locked, ten-minute, self-removing finance repair/backfill trigger.
- [x] Replace catch-all Updates actionable classification with explicit action-required and routine lanes.
- [x] Keep automatic retention Trash and delayed record/routine archive disabled during sampling.
- [x] Add repository handover documentation, `AGENTS.md`, durable knowledge, checklists, and a repo-scoped Codex skill.
