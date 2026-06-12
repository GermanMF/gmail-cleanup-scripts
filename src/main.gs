// =============================================================================
// MAIN ENTRY POINTS & PROCESSING HELPERS
// =============================================================================
/**
 * Main function: processes Gmail threads with attachments following the date policy:
 *
 *   0 – ARCHIVE_AFTER_MONTHS (3)        → untouched, skipped entirely
 *   ARCHIVE_AFTER_MONTHS – DELETE_AFTER_MONTHS (3–6 months old) → archived to Drive, kept in Gmail
 *   older than DELETE_AFTER_MONTHS (6+) → archived to Drive, then deleted from Gmail
 *
 * Folder structure: Gmail_Attachments_Archive / DisplayName / email@domain.com / YYYY /
 * File naming:      YYYYMMDD_localpart_OriginalFilename.ext
 */
function processGmailAttachments() {
  try {
    const startTime = Date.now();

    if (CONFIG.DRY_RUN) {
      Logger.log('⚠️  DRY RUN MODE ENABLED — no files will be saved, no emails will be trashed or labelled.');
    }

    const label = getOrCreateLabel(CONFIG.PROCESSED_LABEL);
    const archiveDate = computeThresholdDate(CONFIG.ARCHIVE_AFTER_MONTHS); // 3 months ago
    const deleteDate = computeThresholdDate(CONFIG.DELETE_AFTER_MONTHS);  // 6 months ago

    // ── Pre-cleanup check ────────────────────────────────────────────────

    // Only fetch emails older than ARCHIVE_AFTER_MONTHS — newer ones are ignored entirely
    const query = [
      CONFIG.SEARCH_QUERY,
      `-label:${CONFIG.PROCESSED_LABEL}`,
      `before:${formatDateForQuery(archiveDate)}`,
    ].join(' ');

    const threads = GmailApp.search(query, 0, CONFIG.BATCH_SIZE);

    if (threads.length === 0) {
      Logger.log('No threads to process (none older than ' + CONFIG.ARCHIVE_AFTER_MONTHS + ' months).');
      return;
    }

    const baseFolder = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    Logger.log(`\n⚙️  Processing ${threads.length} threads...\n`);

    let archivedCount = 0;
    let deletedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];
      // Prevent 6-minute Google Apps Script timeout limit (leave 1.5 mins for reporting)
      if (Date.now() - startTime > 4.5 * 60 * 1000) {
        Logger.log('\n⚠️ Approaching 6-minute execution limit. Stopping batch early to avoid timeout. The script will pick up where it left off on the next run.');
        break;
      }

      try {
        // Archive all messages in the thread to Drive
        processThread(thread, baseFolder);

        // Determine if the entire thread qualifies for deletion (all messages older than deleteDate)
        const messages = thread.getMessages();
        const newestMessage = messages.reduce(function (latest, msg) {
          return msg.getDate() > latest.getDate() ? msg : latest;
        });
        const threadIsOld = newestMessage.getDate() < deleteDate;

        if (threadIsOld) {
          // Archive done — now delete from Gmail
          if (CONFIG.DRY_RUN) {
            Logger.log(`  [DRY RUN] Would trash thread (newest msg: ${newestMessage.getDate().toISOString().substring(0, 10)})`);
            skippedCount++;
          } else {
            thread.moveToTrash();
            Logger.log(`  Trashed thread (newest msg: ${newestMessage.getDate().toISOString().substring(0, 10)})`);
            deletedCount++;
          }
        } else {
          // Archive done — keep in Gmail but mark as processed
          if (CONFIG.DRY_RUN) {
            Logger.log(`  [DRY RUN] Would apply label '${CONFIG.PROCESSED_LABEL}' to thread`);
            skippedCount++;
          } else {
            thread.addLabel(label);
            archivedCount++;
          }
        }
      } catch (threadError) {
        Logger.log(`Error handling thread ${thread.getId()}: ${threadError}`);
      }
    }
    Logger.log(`\n✅  Batch done — Archived & kept: ${archivedCount} | Archived & deleted: ${deletedCount} | Dry-run skipped: ${skippedCount}\n`);

    if (CONFIG.ENABLE_BATCH_NOTIFICATION) {
      sendBatchCompletionNotification(archivedCount, deletedCount, skippedCount, startTime);
    }

  } catch (error) {
    Logger.log(`Critical error in processGmailAttachments: ${error}`);
  }
}

/**
 * Processes all messages in a thread.
 * @param {GoogleAppsScript.Gmail.GmailThread} thread Thread to process.
 * @param {GoogleAppsScript.Drive.Folder} baseFolder Archive root folder.
 */
function processThread(thread, baseFolder) {
  try {
    thread.getMessages().forEach(function (message) {
      processMessage(message, baseFolder);
    });
  } catch (error) {
    Logger.log(`Error processing thread ${thread.getId()}: ${error}`);
  }
}

/**
 * Extracts valid attachments from a single message and saves them.
 * @param {GoogleAppsScript.Gmail.GmailMessage} message Message to process.
 * @param {GoogleAppsScript.Drive.Folder} baseFolder Archive root folder.
 */
function processMessage(message, baseFolder) {
  try {
    const attachments = message.getAttachments();
    if (attachments.length === 0) return;

    const date = message.getDate();
    const rawFrom = message.getFrom();
    const senderEmail = extractEmailAddress(rawFrom);
    const subject = message.getSubject() || '';

    // ── Exclusion list check ────────────────────────────────────────────────
    if (isSenderExcluded(senderEmail)) {
      Logger.log(`  Skipped excluded sender: ${senderEmail}`);
      return;
    }

    const displayName = extractDisplayName(rawFrom);  // e.g. "G2A.com"
    const senderLocal = extractLocalPart(senderEmail); // e.g. "info"

    const friendlyName = getFriendlySenderName(senderEmail, displayName);

    attachments.forEach(function (attachment) {
      if (attachment.getSize() > CONFIG.MIN_FILE_SIZE_BYTES) {
        const category = determineCategory(subject, senderEmail, attachment.getName());
        
        // Hierarchy: Category / FriendlyName / YYYY
        const categoryFolder = getOrCreateFolder(baseFolder, sanitizeFilename(category));
        const friendlyFolder = getOrCreateFolder(categoryFolder, sanitizeFilename(friendlyName));
        const yearFolder = getOrCreateFolder(friendlyFolder, getYearString(date));
        
        saveAttachment(attachment, date, senderLocal, yearFolder);
      } else {
        Logger.log(`  Skipped small attachment (<10KB): ${attachment.getName()}`);
      }
    });
  } catch (error) {
    Logger.log(`Error processing message ${message.getId()}: ${error}`);
  }
}

/**
 * Saves a single attachment to Drive with the configured naming convention.
 * Skips the file if an identically-named file already exists in the target folder
 * to prevent duplicates when re-processing a thread (e.g. after label removal).
 * @param {GoogleAppsScript.Gmail.GmailAttachment} attachment Blob to save.
 * @param {Date} date Email received date.
 * @param {string} senderLocal Local part of sender's email (before the @).
 * @param {GoogleAppsScript.Drive.Folder} targetFolder Destination folder.
 */
function saveAttachment(attachment, date, senderLocal, targetFolder) {
  try {
    const originalName = attachment.getName();
    const dotIndex = originalName.lastIndexOf('.');
    const nameWithoutExt = dotIndex !== -1 ? originalName.substring(0, dotIndex) : originalName;
    const extension = dotIndex !== -1 ? originalName.substring(dotIndex) : '';

    const finalName = `${getDateString(date)}_${sanitizeFilename(senderLocal)}_${sanitizeFilename(nameWithoutExt)}${extension}`;

    // ── Deduplication check ─────────────────────────────────────────────────
    if (fileExistsInFolder(targetFolder, finalName)) {
      Logger.log(`  Skipped duplicate: ${finalName}`);
      return;
    }

    if (CONFIG.DRY_RUN) {
      Logger.log(`  [DRY RUN] Would save: ${finalName} → ${targetFolder.getName()}`);
    } else {
      targetFolder.createFile(attachment).setName(finalName);
      Logger.log(`  Saved: ${finalName}`);
    }
  } catch (error) {
    Logger.log(`Error saving attachment "${attachment.getName()}": ${error}`);
  }
}