// =============================================================================
// MAIN ENTRY POINT & SAFE ATTACHMENT PIPELINE
// =============================================================================

/**
 * Archives real Gmail attachments and mutates a thread only after every eligible
 * attachment has been saved or matched to a content-verified Drive duplicate.
 */
function processGmailAttachments() {
  const startTime = Date.now();
  try {
    if (CONFIG.DELETE_AFTER_MONTHS <= CONFIG.ARCHIVE_AFTER_MONTHS) {
      throw new Error('DELETE_AFTER_MONTHS must be greater than ARCHIVE_AFTER_MONTHS.');
    }

    const archiveDate = computeThresholdDate(CONFIG.ARCHIVE_AFTER_MONTHS);
    const deleteDate = computeThresholdDate(CONFIG.DELETE_AFTER_MONTHS);
    const queryParts = [CONFIG.SEARCH_QUERY];
    if (GmailApp.getUserLabelByName(CONFIG.PROCESSED_LABEL)) {
      queryParts.push(`-label:${CONFIG.PROCESSED_LABEL}`);
    }
    if (GmailApp.getUserLabelByName(CONFIG.REVIEW_LABEL)) {
      queryParts.push(`-label:${CONFIG.REVIEW_LABEL}`);
    }
    queryParts.push(`before:${formatDateForQuery(archiveDate)}`);
    const query = queryParts.join(' ');
    const threads = GmailApp.search(query, 0, CONFIG.BATCH_SIZE);

    if (CONFIG.DRY_RUN) {
      Logger.log('⚠️ DRY RUN — no Gmail labels/folders/files will be created and nothing will be trashed.');
    }
    if (threads.length === 0) {
      Logger.log(`No unprocessed threads older than ${CONFIG.ARCHIVE_AFTER_MONTHS} months.`);
      return;
    }

    const processedLabel = CONFIG.DRY_RUN ? null : getOrCreateLabel(CONFIG.PROCESSED_LABEL);
    const reviewLabel = CONFIG.DRY_RUN ? null : getOrCreateLabel(CONFIG.REVIEW_LABEL);
    const baseFolder = CONFIG.DRY_RUN
      ? null
      : getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);

    let archivedCount = 0;
    let deletedCount = 0;
    let reviewCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < threads.length; i++) {
      if (Date.now() - startTime > 4.5 * 60 * 1000) {
        Logger.log('⚠️ Time guard reached. The next run will continue safely.');
        break;
      }

      const thread = threads[i];
      try {
        const messages = thread.getMessages();
        const newestMessage = messages.reduce(function (latest, message) {
          return message.getDate() > latest.getDate() ? message : latest;
        });
        if (newestMessage.getDate() >= archiveDate) {
          Logger.log(`[THREAD ${thread.getId()}] skipped — contains a message inside the recent window.`);
          skippedCount++;
          continue;
        }
        const result = processThread(messages, baseFolder, archiveDate);
        const decision = decideThreadAction({
          newestMessageDate: newestMessage.getDate(),
          archiveDate: archiveDate,
          deleteDate: deleteDate,
          eligibleAttachments: result.eligibleAttachments,
          completedAttachments: result.savedAttachments + result.verifiedDuplicates + result.plannedAttachments,
          failedAttachments: result.failedAttachments,
          excludedMessages: result.excludedMessages,
          protectedThread: isThreadProtected(thread, messages),
        });

        Logger.log(
          `[THREAD ${thread.getId()}] eligible=${result.eligibleAttachments} ` +
          `saved=${result.savedAttachments} duplicate=${result.verifiedDuplicates} ` +
          `failed=${result.failedAttachments} → ${decision.action} (${decision.reason})`
        );

        if (decision.action === 'skip') {
          skippedCount++;
        } else if (decision.action === 'review') {
          if (CONFIG.DRY_RUN) Logger.log(`  [DRY RUN] Would apply review label: ${CONFIG.REVIEW_LABEL}`);
          else thread.addLabel(reviewLabel);
          reviewCount++;
        } else if (decision.action === 'trash') {
          if (CONFIG.DRY_RUN) Logger.log('  [DRY RUN] Would verify the backup, then trash only if verification succeeds.');
          else thread.moveToTrash();
          deletedCount++;
        } else {
          if (CONFIG.DRY_RUN) Logger.log(`  [DRY RUN] Would apply label: ${CONFIG.PROCESSED_LABEL}`);
          else thread.addLabel(processedLabel);
          archivedCount++;
        }
      } catch (threadError) {
        Logger.log(`ERROR in thread ${thread.getId()}: ${threadError}`);
        if (!CONFIG.DRY_RUN) {
          try { thread.addLabel(reviewLabel); } catch (labelError) {
            Logger.log(`Could not apply review label: ${labelError}`);
          }
        }
        reviewCount++;
      }
    }

    const modePrefix = CONFIG.DRY_RUN ? 'planned ' : '';
    Logger.log(
      `✅ Batch complete — ${modePrefix}kept=${archivedCount}, ${modePrefix}trashed=${deletedCount}, ` +
      `review=${reviewCount}, recent/mixed=${skippedCount}`
    );
    if (CONFIG.ENABLE_BATCH_NOTIFICATION && !CONFIG.DRY_RUN) {
      sendBatchCompletionNotification(archivedCount, deletedCount, reviewCount + skippedCount, startTime);
    }
  } catch (error) {
    Logger.log(`Critical error in processGmailAttachments: ${error}`);
  }
}

/** Returns true when policy forbids automatic deletion of the thread. */
function isThreadProtected(thread, messages, options) {
  options = options || {};
  if (CONFIG.PROTECT_STARRED_THREADS && messages.some(function (message) { return message.isStarred(); })) {
    return true;
  }
  if (
    CONFIG.PROTECT_IMPORTANT_THREADS &&
    !options.ignoreImportant &&
    typeof thread.isImportant === 'function' &&
    thread.isImportant()
  ) {
    return true;
  }
  if (CONFIG.PROTECT_SENT_THREADS) {
    let accountEmail = '';
    try {
      accountEmail = Session.getEffectiveUser().getEmail().toLowerCase();
    } catch (error) {
      Logger.log(`⚠️ Could not resolve the running account email; protecting thread by default: ${error}`);
      return true;
    }
    if (!accountEmail) {
      Logger.log('⚠️ Running account email is blank; protecting thread by default.');
      return true;
    }
    if (accountEmail && messages.some(function (message) {
      return extractEmailAddress(message.getFrom()).toLowerCase() === accountEmail;
    })) return true;
  }
  return false;
}

/** Processes only messages old enough for the archive window. */
function processThread(messages, baseFolder, archiveDate) {
  const summary = newProcessingSummary();
  messages.forEach(function (message) {
    if (message.getDate() >= archiveDate) return;
    const messageResult = processMessage(message, baseFolder);
    Object.keys(summary).forEach(function (key) {
      summary[key] += messageResult[key] || 0;
    });
  });
  return summary;
}

function newProcessingSummary() {
  return {
    eligibleAttachments: 0,
    savedAttachments: 0,
    verifiedDuplicates: 0,
    plannedAttachments: 0,
    failedAttachments: 0,
    excludedMessages: 0,
    skippedSmallAttachments: 0,
  };
}

/** Archives real (non-inline) attachments from one message. */
function processMessage(message, baseFolder) {
  const result = newProcessingSummary();
  const senderEmail = extractEmailAddress(message.getFrom());
  if (isSenderExcluded(senderEmail)) {
    result.excludedMessages = 1;
    return result;
  }

  const attachments = message.getAttachments({
    includeInlineImages: !CONFIG.SKIP_INLINE_IMAGES,
    includeAttachments: true,
  });
  const date = message.getDate();
  const subject = message.getSubject() || '';
  const friendlyName = getFriendlySenderName(senderEmail, extractDisplayName(message.getFrom()));
  const senderLocal = extractLocalPart(senderEmail);

  attachments.forEach(function (attachment) {
    if (attachment.getSize() < CONFIG.MIN_FILE_SIZE_BYTES) {
      result.skippedSmallAttachments++;
      return;
    }
    result.eligibleAttachments++;

    const category = determineCategory(subject, senderEmail, attachment.getName());
    const targetPath = [category, friendlyName, getYearString(date)]
      .map(sanitizeFilename)
      .join('/');
    try {
      let targetFolder = null;
      if (!CONFIG.DRY_RUN) {
        const categoryFolder = getOrCreateFolder(baseFolder, sanitizeFilename(category));
        const friendlyFolder = getOrCreateFolder(categoryFolder, sanitizeFilename(friendlyName));
        targetFolder = getOrCreateFolder(friendlyFolder, getYearString(date));
      }
      const saveResult = saveAttachment(attachment, date, senderLocal, targetFolder, targetPath);
      if (saveResult.status === 'saved') result.savedAttachments++;
      else if (saveResult.status === 'duplicate') result.verifiedDuplicates++;
      else if (saveResult.status === 'planned') result.plannedAttachments++;
      else result.failedAttachments++;
    } catch (error) {
      result.failedAttachments++;
      Logger.log(`  Failed attachment "${attachment.getName()}": ${error}`);
    }
  });
  return result;
}

/** Saves and verifies one attachment, returning an explicit status. */
function saveAttachment(attachment, date, senderLocal, targetFolder, targetPath) {
  const originalName = attachment.getName() || 'attachment';
  const dotIndex = originalName.lastIndexOf('.');
  const stem = dotIndex > 0 ? originalName.substring(0, dotIndex) : originalName;
  const extension = dotIndex > 0 ? originalName.substring(dotIndex) : '';
  const intendedName =
    `${getDateString(date)}_${sanitizeFilename(senderLocal)}_${sanitizeFilename(stem)}${extension}`;

  if (CONFIG.DRY_RUN) {
    Logger.log(`  [DRY RUN] Would verify/save: ${targetPath}/${intendedName}`);
    return { status: 'planned', fileName: intendedName };
  }

  try {
    if (findVerifiedDuplicate(targetFolder, intendedName, attachment)) {
      Logger.log(`  Verified duplicate: ${intendedName}`);
      return { status: 'duplicate', fileName: intendedName };
    }

    const finalName = getCollisionSafeFilename(targetFolder, intendedName, attachment);
    const createdFile = targetFolder.createFile(attachment).setName(finalName);
    const verified = createdFile.getSize() === attachment.getSize() &&
      getBlobFingerprint(createdFile.getBlob()) === getBlobFingerprint(attachment);
    if (!verified) {
      Logger.log(`  ERROR: Drive verification failed for ${finalName}; Gmail thread will be kept.`);
      return { status: 'error', fileName: finalName };
    }
    Logger.log(`  Saved and verified: ${finalName}`);
    return { status: 'saved', fileName: finalName };
  } catch (error) {
    Logger.log(`  Error saving "${originalName}": ${error}`);
    return { status: 'error', fileName: intendedName, error: String(error) };
  }
}
