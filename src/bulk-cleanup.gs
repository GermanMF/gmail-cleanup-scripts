// =============================================================================
// BULK MAILBOX CLEANUP — STAGE, REVIEW, CONFIRM, TRASH
// =============================================================================

/** Read-only candidate counts for each low-value cleanup policy. */
function auditBulkCleanup() {
  Logger.log('=== BULK CLEANUP AUDIT (READ-ONLY) ===');
  CONFIG.BULK_CLEANUP_POLICIES.forEach(function (policy) {
    const count = countThreads(policy.query, CONFIG.MAX_COUNT_PER_QUERY);
    const capped = count >= CONFIG.MAX_COUNT_PER_QUERY ? '+' : '';
    Logger.log(`${policy.name}: ${count}${capped} candidate threads`);
    Logger.log(`  query: ${policy.query}`);
  });
  Logger.log('No labels, archive state, or messages were changed.');
}

/**
 * Archives low-value candidates out of Inbox and applies a policy-specific
 * review label. Nothing is deleted by this function.
 */
function stageBulkCleanupCandidates() {
  const startTime = Date.now();
  let staged = 0;
  let protectedCount = 0;

  CONFIG.BULK_CLEANUP_POLICIES.forEach(function (policy) {
    if (Date.now() - startTime > 4.5 * 60 * 1000) return;

    const labelName = `${CONFIG.BULK_REVIEW_LABEL_ROOT}/${policy.name}`;
    const label = CONFIG.DRY_RUN ? null : getOrCreateLabel(labelName);
    const queryParts = [policy.query];
    if (label || GmailApp.getUserLabelByName(labelName)) queryParts.push(`-label:"${labelName}"`);
    if (GmailApp.getUserLabelByName(CONFIG.BULK_DELETE_LABEL)) {
      queryParts.push(`-label:${CONFIG.BULK_DELETE_LABEL}`);
    }
    const query = queryParts.join(' ');
    const threads = GmailApp.search(query, 0, CONFIG.BULK_CLEANUP_BATCH_SIZE);

    threads.forEach(function (thread) {
      if (Date.now() - startTime > 4.5 * 60 * 1000) return;
      const messages = thread.getMessages();
      if (
        threadHasRealAttachments(messages) ||
        isThreadProtected(thread, messages) ||
        threadHasAutomationProtectedSender(messages) ||
        threadHasAutomationProtectedContent(messages)
      ) {
        protectedCount++;
        Logger.log(`[PROTECTED] ${thread.getFirstMessageSubject()}`);
        return;
      }

      if (CONFIG.DRY_RUN) {
        Logger.log(`[DRY RUN] Would stage ${policy.name}: ${thread.getFirstMessageSubject()}`);
      } else {
        thread.addLabel(label);
        thread.moveToArchive();
      }
      staged++;
    });
  });

  Logger.log(`Stage complete — review=${staged}, protected/skipped=${protectedCount}. Nothing was deleted.`);
  Logger.log(`To approve deletion, manually add the Gmail label "${CONFIG.BULK_DELETE_LABEL}" to reviewed threads.`);
}

/**
 * Moves manually confirmed, attachment-free threads to Trash. The confirmation
 * label is never created or applied by code; the user must apply it in Gmail.
 */
function purgeConfirmedBulkCleanup() {
  const confirmationLabel = GmailApp.getUserLabelByName(CONFIG.BULK_DELETE_LABEL);
  if (!confirmationLabel) {
    Logger.log(`Confirmation label "${CONFIG.BULK_DELETE_LABEL}" does not exist. Nothing changed.`);
    return;
  }

  const query = [
    `label:${CONFIG.BULK_DELETE_LABEL}`,
    '-is:starred',
    '-is:important',
    '-in:trash',
    '-in:spam',
  ].join(' ');
  const threads = GmailApp.search(query, 0, CONFIG.BULK_CLEANUP_BATCH_SIZE);
  let trashed = 0;
  let protectedCount = 0;

  threads.forEach(function (thread) {
    const messages = thread.getMessages();
    if (
      threadHasRealAttachments(messages) ||
      isThreadProtected(thread, messages) ||
      threadHasAutomationProtectedSender(messages) ||
      threadHasAutomationProtectedContent(messages)
    ) {
      protectedCount++;
      Logger.log(`[PROTECTED] Confirmation ignored: ${thread.getFirstMessageSubject()}`);
      return;
    }

    if (CONFIG.DRY_RUN) {
      Logger.log(`[DRY RUN] Would trash confirmed thread: ${thread.getFirstMessageSubject()}`);
    } else {
      thread.moveToTrash();
    }
    trashed++;
  });

  Logger.log(`Purge complete — trashed=${trashed}, protected/skipped=${protectedCount}.`);
}

/** True when at least one message contains a real, non-inline attachment. */
function threadHasRealAttachments(messages) {
  return messages.some(function (message) {
    return message.getAttachments({
      includeInlineImages: false,
      includeAttachments: true,
    }).length > 0;
  });
}
