/**
 * Configuration object for the Gmail Attachment Processor.
 * Modify these settings to adjust the script's behavior.
 */
const CONFIG = {
  /**
   * Base Gmail search query. The date window is applied automatically on top of this.
   * Emails newer than ARCHIVE_AFTER_MONTHS are always excluded.
   */
  SEARCH_QUERY: 'has:attachment -in:chats',
  /** Label applied to processed threads to prevent duplicate processing. */
  PROCESSED_LABEL: 'Processed_Drive',
  /** Base Google Drive folder name for the archive root. */
  BASE_FOLDER_NAME: 'Gmail_Attachments_Archive',
  /** Minimum file size in bytes (10KB) to exclude inline signature images. */
  MIN_FILE_SIZE_BYTES: 10 * 1024,
  /** Maximum number of threads to process per execution to avoid timeouts. */
  BATCH_SIZE: 50,
  /**
   * Emails OLDER than this many months are archived to Drive.
   * Emails NEWER than this are left completely untouched.
   */
  ARCHIVE_AFTER_MONTHS: 3,
  /**
   * Emails OLDER than this many months are archived AND then deleted from Gmail.
   * Must be greater than ARCHIVE_AFTER_MONTHS.
   * Window summary:
   *   0 – ARCHIVE_AFTER_MONTHS  → untouched
   *   ARCHIVE_AFTER_MONTHS – DELETE_AFTER_MONTHS → archived, kept in Gmail
   *   older than DELETE_AFTER_MONTHS → archived + deleted from Gmail
   */
  DELETE_AFTER_MONTHS: 6,
  /**
   * Maximum number of threads counted per category in generateCleanupReport.
   * Lower this if the report is slow or hits execution time limits.
   * Raise it if you have a very large mailbox and want accurate totals.
   */
  MAX_COUNT_PER_QUERY: 500,
};

// =============================================================================
// MAIN ENTRY POINTS
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
    const label = getOrCreateLabel(CONFIG.PROCESSED_LABEL);
    const archiveDate = computeThresholdDate(CONFIG.ARCHIVE_AFTER_MONTHS); // 3 months ago
    const deleteDate = computeThresholdDate(CONFIG.DELETE_AFTER_MONTHS);  // 6 months ago

    // ── PRE-CLEANUP snapshot ────────────────────────────────────────────────
    generateCleanupReport('PRE-CLEANUP SNAPSHOT');

    // Only fetch emails older than ARCHIVE_AFTER_MONTHS — newer ones are ignored entirely
    const query = [
      CONFIG.SEARCH_QUERY,
      `-label:${CONFIG.PROCESSED_LABEL}`,
      `before:${formatDateForQuery(archiveDate)}`,
    ].join(' ');

    const threads = GmailApp.search(query, 0, CONFIG.BATCH_SIZE);

    if (threads.length === 0) {
      Logger.log('No threads to process (none older than ' + CONFIG.ARCHIVE_AFTER_MONTHS + ' months).');
      generateCleanupReport('POST-CLEANUP SNAPSHOT  (nothing to process)');
      return;
    }

    const baseFolder = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    Logger.log(`\n⚙️  Processing ${threads.length} threads...\n`);

    let archivedCount = 0;
    let deletedCount = 0;

    threads.forEach(function (thread) {
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
          thread.moveToTrash();
          Logger.log(`  Trashed thread (newest msg: ${newestMessage.getDate().toISOString().substring(0, 10)})`);
          deletedCount++;
        } else {
          // Archive done — keep in Gmail but mark as processed
          thread.addLabel(label);
          archivedCount++;
        }
      } catch (threadError) {
        Logger.log(`Error handling thread ${thread.getId()}: ${threadError}`);
      }
    });

    Logger.log(`\n✅  Batch done — Archived & kept: ${archivedCount} | Archived & deleted: ${deletedCount}\n`);

    // ── POST-CLEANUP snapshot ───────────────────────────────────────────────
    generateCleanupReport('POST-CLEANUP SNAPSHOT');

  } catch (error) {
    Logger.log(`Critical error in processGmailAttachments: ${error}`);
  }
}

// =============================================================================
// STATS & REPORTING
// =============================================================================

/**
 * Generates a comprehensive cleanup report to the Execution Log.
 * Analyzes both Gmail and Google Drive to show current state, progress,
 * and how many runs remain to complete the cleanup.
 *
 * Accepts an optional title displayed in the report header (e.g. "PRE-CLEANUP SNAPSHOT").
 * Makes NO changes to Gmail or Drive — safe to run anytime.
 * @param {string} [title] Optional header title for the report.
 */
function generateCleanupReport(title) {
  try {
    const now = new Date();
    const archiveDate = computeThresholdDate(CONFIG.ARCHIVE_AFTER_MONTHS);
    const deleteDate = computeThresholdDate(CONFIG.DELETE_AFTER_MONTHS);
    const archiveDateStr = formatDateForQuery(archiveDate);
    const deleteDateStr = formatDateForQuery(deleteDate);
    const reportTitle = title || 'GMAIL CLEANUP REPORT';

    Logger.log('Gathering stats — this may take a moment...\n');

    // ── Gmail counts ──────────────────────────────────────────────────────────
    const totalThreads = countThreads('has:attachment -in:chats');
    const processed = countThreads(`has:attachment -in:chats label:${CONFIG.PROCESSED_LABEL}`);
    const recentUntouched = countThreads(`has:attachment -in:chats after:${archiveDateStr}`);
    const toArchiveOnly = countThreads([
      'has:attachment -in:chats',
      `-label:${CONFIG.PROCESSED_LABEL}`,
      `before:${archiveDateStr}`,
      `after:${deleteDateStr}`,
    ].join(' '));
    const toArchiveDelete = countThreads([
      'has:attachment -in:chats',
      `-label:${CONFIG.PROCESSED_LABEL}`,
      `before:${deleteDateStr}`,
    ].join(' '));
    const inTrash = countThreads('has:attachment in:trash');

    const totalPending = toArchiveOnly + toArchiveDelete;
    const totalAccountedFor = processed + recentUntouched + totalPending;
    const progressPct = totalThreads > 0 ? ((processed / totalThreads) * 100).toFixed(1) : '0.0';
    const pendingPct = totalThreads > 0 ? ((totalPending / totalThreads) * 100).toFixed(1) : '0.0';
    const deletePct = totalPending > 0 ? ((toArchiveDelete / totalPending) * 100).toFixed(1) : '0.0';
    const runsRemaining = Math.ceil(totalPending / CONFIG.BATCH_SIZE);

    // ── Top senders (sample from pending-delete pool for speed) ──────────────
    const topSenders = getTopSenders(
      `has:attachment -in:chats -label:${CONFIG.PROCESSED_LABEL} before:${archiveDateStr}`,
      10
    );

    // ── Drive archive stats ───────────────────────────────────────────────────
    const driveStats = getDriveArchiveStats();

    // ── Build report ─────────────────────────────────────────────────────────
    const line = '─'.repeat(52);
    const lines = [];

    lines.push('');
    lines.push('╔══════════════════════════════════════════════════════╗');
    lines.push(`║  📊  ${reportTitle.padEnd(48)}║`);
    lines.push(`║     ${now.toISOString().substring(0, 10)}  ${now.toTimeString().substring(0, 5)}                          ║`);
    lines.push('╚══════════════════════════════════════════════════════╝');
    lines.push('');

    lines.push('📬  GMAIL OVERVIEW');
    lines.push(line);
    lines.push(pad('Total threads with attachments:', totalThreads));
    lines.push(pad(`Archived to Drive (label: ${CONFIG.PROCESSED_LABEL}):`, `${processed}  (${progressPct}% done)`));
    lines.push(pad('Moved to Trash (previous runs):', inTrash));
    lines.push(pad('Unaccounted / other folders:', Math.max(0, totalThreads - totalAccountedFor)));
    lines.push('');

    lines.push('⏳  AGE BREAKDOWN  (unprocessed threads)');
    lines.push(line);
    lines.push(pad(`  < ${CONFIG.ARCHIVE_AFTER_MONTHS} months  — untouched zone:`, recentUntouched));
    lines.push(pad(`  ${CONFIG.ARCHIVE_AFTER_MONTHS}–${CONFIG.DELETE_AFTER_MONTHS} months — archive & keep:`, toArchiveOnly));
    lines.push(pad(`  > ${CONFIG.DELETE_AFTER_MONTHS} months  — archive & DELETE:`, `${toArchiveDelete}  (${deletePct}% of pending)`));
    lines.push(pad('  TOTAL pending cleanup:', `${totalPending}  (${pendingPct}% of inbox)`));
    lines.push('');

    lines.push('🏃  EXECUTION FORECAST');
    lines.push(line);
    lines.push(pad('Batch size (threads per run):', CONFIG.BATCH_SIZE));
    lines.push(pad('Estimated runs remaining:', runsRemaining));
    lines.push(pad('Threads to delete per run (est.):', Math.min(CONFIG.BATCH_SIZE, toArchiveDelete)));
    if (runsRemaining <= 1) {
      lines.push('  ✅ One more run and you\'re done!');
    } else {
      lines.push(`  ⚡ Tip: Increase BATCH_SIZE to ${CONFIG.BATCH_SIZE * 2} to finish in ~${Math.ceil(runsRemaining / 2)} runs.`);
    }
    lines.push('');

    lines.push('🏆  TOP 10 SENDERS  (pending cleanup)');
    lines.push(line);
    if (topSenders.length === 0) {
      lines.push('  (no pending threads found)');
    } else {
      topSenders.forEach(function (s, i) {
        lines.push(`  ${String(i + 1).padStart(2, ' ')}. ${pad(s.name, s.count + ' threads', 46)}`);
      });
    }
    lines.push('');

    lines.push('📁  DRIVE ARCHIVE  (' + CONFIG.BASE_FOLDER_NAME + ')');
    lines.push(line);
    if (driveStats.found) {
      lines.push(pad('Unique senders (top-level folders):', driveStats.senderFolders));
      lines.push(pad('Files saved to Drive:', driveStats.totalFiles));
      lines.push(pad('Year folders across all senders:', driveStats.yearFolders));
    } else {
      lines.push('  Archive folder not found — run processGmailAttachments first.');
    }
    lines.push('');
    lines.push('══════════════════════════════════════════════════════');
    lines.push('');

    lines.forEach(function (l) { Logger.log(l); });

  } catch (error) {
    Logger.log(`Error generating report: ${error}`);
  }
}

/**
 * Counts Gmail threads matching a query, paginating up to CONFIG.MAX_COUNT_PER_QUERY.
 * @param {string} query Gmail search query string.
 * @param {number} [max] Optional override for the safety cap (defaults to CONFIG.MAX_COUNT_PER_QUERY).
 * @returns {number} Thread count.
 */
function countThreads(query, max) {
  const PAGE = 500;
  const safeMax = max || CONFIG.MAX_COUNT_PER_QUERY;
  let count = 0;
  let start = 0;
  try {
    while (count < safeMax) {
      const batch = GmailApp.search(query, start, PAGE);
      count += batch.length;
      if (batch.length < PAGE) break;
      start += PAGE;
    }
  } catch (error) {
    Logger.log(`countThreads error for query "${query}": ${error}`);
  }
  return count;
}

/**
 * Samples the first page of a query and tallies threads by sender display name.
 * @param {string} query Gmail search query.
 * @param {number} topN Number of top senders to return.
 * @returns {Array<{name: string, count: number}>} Sorted list of top senders.
 */
function getTopSenders(query, topN) {
  try {
    const threads = GmailApp.search(query, 0, 500);
    const tally = {};
    threads.forEach(function (thread) {
      try {
        const from = thread.getMessages()[0].getFrom();
        const name = extractDisplayName(from);
        tally[name] = (tally[name] || 0) + 1;
      } catch (_) { }
    });
    return Object.keys(tally)
      .map(function (k) { return { name: k, count: tally[k] }; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, topN);
  } catch (error) {
    Logger.log(`getTopSenders error: ${error}`);
    return [];
  }
}

/**
 * Counts folders and files inside the Drive archive root.
 * @returns {{found: boolean, senderFolders: number, yearFolders: number, totalFiles: number}}
 */
function getDriveArchiveStats() {
  const result = { found: false, senderFolders: 0, yearFolders: 0, totalFiles: 0 };
  try {
    const root = DriveApp.getRootFolder();
    const search = root.getFoldersByName(CONFIG.BASE_FOLDER_NAME);
    if (!search.hasNext()) return result;

    result.found = true;
    const baseFolder = search.next();

    // Level 1: DisplayName folders
    const displayFolders = baseFolder.getFolders();
    while (displayFolders.hasNext()) {
      const displayFolder = displayFolders.next();
      result.senderFolders++;

      // Level 2: email@domain folders
      const emailFolders = displayFolder.getFolders();
      while (emailFolders.hasNext()) {
        const emailFolder = emailFolders.next();

        // Level 3: YYYY folders
        const yearFolderIter = emailFolder.getFolders();
        while (yearFolderIter.hasNext()) {
          const yearFolder = yearFolderIter.next();
          result.yearFolders++;

          // Count files
          const files = yearFolder.getFiles();
          while (files.hasNext()) {
            files.next();
            result.totalFiles++;
          }
        }
      }
    }
  } catch (error) {
    Logger.log(`getDriveArchiveStats error: ${error}`);
  }
  return result;
}

/**
 * Formats a key-value pair as a padded log line for the report.
 * @param {string} label Left-side label.
 * @param {string|number} value Right-side value.
 * @param {number} [width=48] Total line width for padding.
 * @returns {string} Formatted line.
 */
function pad(label, value, width) {
  const w = width || 48;
  const str = String(value);
  const dots = Math.max(1, w - label.length - str.length);
  return `  ${label}${'·'.repeat(dots)}${str}`;
}

/**
 * STAGE 2 MIGRATION — Run this after migrateOldStructure (or if you already have
 * the email@domain/YYYY/ structure in Drive from the previous script version).
 *
 * Reads each email-address folder at the top level of the archive, queries Gmail
 * to resolve the sender's display name, then restructures into:
 *   DisplayName / email@domain.com / YYYY / files
 *
 * After running, manually delete the now-empty old email-address folders from Drive.
 */
function migrateEmailFoldersToDisplayName() {
  try {
    const baseFolder = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    const topFolders = baseFolder.getFolders();
    let movedCount = 0;
    let errorCount = 0;

    while (topFolders.hasNext()) {
      const emailFolder = topFolders.next();
      const emailAddress = emailFolder.getName();

      // Only process folders that look like an email address
      if (!emailAddress.includes('@')) {
        Logger.log(`Skipping non-email folder: ${emailAddress}`);
        continue;
      }

      Logger.log(`Resolving display name for: ${emailAddress}`);
      const displayName = getDisplayNameForEmail(emailAddress);
      Logger.log(`  Display name: "${displayName}"`);

      // Build target: DisplayName / email@domain.com /
      const displayFolder = getOrCreateFolder(baseFolder, sanitizeFilename(displayName));
      const newEmailFolder = getOrCreateFolder(displayFolder, sanitizeFilename(emailAddress));

      // Move each year subfolder's files into the new location
      const yearFolders = emailFolder.getFolders();
      while (yearFolders.hasNext()) {
        const yearFolder = yearFolders.next();
        const newYearFolder = getOrCreateFolder(newEmailFolder, yearFolder.getName());
        const files = yearFolder.getFiles();

        while (files.hasNext()) {
          const file = files.next();
          try {
            newYearFolder.addFile(file);
            yearFolder.removeFile(file);
            Logger.log(`  Moved: ${file.getName()} -> ${displayName}/${emailAddress}/${yearFolder.getName()}/`);
            movedCount++;
          } catch (fileError) {
            Logger.log(`  Error moving file "${file.getName()}": ${fileError}`);
            errorCount++;
          }
        }
      }
    }

    Logger.log(`Stage 2 migration complete. Moved: ${movedCount} files | Errors: ${errorCount}`);
    Logger.log('Now manually delete the old empty email-address folders from Drive.');
  } catch (error) {
    Logger.log(`Critical error in migrateEmailFoldersToDisplayName: ${error}`);
  }
}

/**
 * Queries Gmail to find the display name associated with an email address.
 * Searches for the most recent message from that sender and parses its From header.
 * Falls back to the email address itself if no messages are found.
 * @param {string} email Email address to look up.
 * @returns {string} Display name or the email address as fallback.
 */
function getDisplayNameForEmail(email) {
  try {
    const threads = GmailApp.search(`from:${email}`, 0, 1);
    if (threads.length > 0) {
      const message = threads[0].getMessages()[0];
      return extractDisplayName(message.getFrom());
    }
  } catch (error) {
    Logger.log(`  Could not query Gmail for "${email}": ${error}`);
  }
  // Fallback: use local part of the email (before @)
  return extractLocalPart(email);
}

/**
 * One-time migration function: reorganizes files already saved under
 * the old YYYY/MM_MonthName/ structure into the email@domain.com/YYYY/ hierarchy.
 * Run ONLY if you still have the original YYYY/MM_MonthName structure.
 * Otherwise run migrateEmailFoldersToDisplayName directly.
 */
function migrateOldStructure() {
  try {
    const baseFolder = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    const yearFolders = baseFolder.getFolders();
    let migratedCount = 0;
    let errorCount = 0;

    // Iterate through top-level year folders (e.g. "2026")
    while (yearFolders.hasNext()) {
      const yearFolder = yearFolders.next();
      const yearName = yearFolder.getName();

      // Only process folders that look like a 4-digit year (old structure)
      if (!/^\d{4}$/.test(yearName)) {
        Logger.log(`Skipping non-year folder: ${yearName}`);
        continue;
      }

      const monthFolders = yearFolder.getFolders();

      // Iterate through month subfolders (e.g. "06_June")
      while (monthFolders.hasNext()) {
        const monthFolder = monthFolders.next();
        const files = monthFolder.getFiles();

        while (files.hasNext()) {
          const file = files.next();
          const result = migrateFile(file, baseFolder);
          if (result) {
            migratedCount++;
          } else {
            errorCount++;
          }
        }
      }
    }

    Logger.log(`Stage 1 migration complete. Migrated: ${migratedCount} | Errors: ${errorCount}`);
    Logger.log('You can now manually delete the old YYYY/MM_MonthName folders from Drive.');
  } catch (error) {
    Logger.log(`Critical error in migrateOldStructure: ${error}`);
  }
}

// =============================================================================
// PROCESSING HELPERS
// =============================================================================

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
    const displayName = extractDisplayName(rawFrom);  // e.g. "G2A.com"
    const senderLocal = extractLocalPart(senderEmail); // e.g. "info"

    // Hierarchy: DisplayName / email@domain.com / YYYY
    const displayFolder = getOrCreateFolder(baseFolder, sanitizeFilename(displayName));
    const emailFolder = getOrCreateFolder(displayFolder, sanitizeFilename(senderEmail));
    const yearFolder = getOrCreateFolder(emailFolder, getYearString(date));

    attachments.forEach(function (attachment) {
      if (attachment.getSize() > CONFIG.MIN_FILE_SIZE_BYTES) {
        saveAttachment(attachment, date, senderLocal, yearFolder);
      } else {
        Logger.log(`Skipped small attachment (<10KB): ${attachment.getName()}`);
      }
    });
  } catch (error) {
    Logger.log(`Error processing message ${message.getId()}: ${error}`);
  }
}

/**
 * Saves a single attachment to Drive with the configured naming convention.
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
    targetFolder.createFile(attachment).setName(finalName);
    Logger.log(`  Saved: ${finalName}`);
  } catch (error) {
    Logger.log(`Error saving attachment "${attachment.getName()}": ${error}`);
  }
}

// =============================================================================
// MIGRATION HELPER
// =============================================================================

/**
 * Moves a single file from the old flat structure to the new sender-based hierarchy.
 * Parses sender email from the existing filename pattern: YYYYMMDD_sender@domain_filename.ext
 * @param {GoogleAppsScript.Drive.File} file File to migrate.
 * @param {GoogleAppsScript.Drive.Folder} baseFolder Archive root folder.
 * @returns {boolean} True if migration succeeded, false otherwise.
 */
function migrateFile(file, baseFolder) {
  try {
    const currentName = file.getName();
    Logger.log(`Migrating: ${currentName}`);

    // Parse: YYYYMMDD_localpart@domain.ext_OriginalName.ext
    // The email is identified by containing "@"
    const parsed = parseOldFilename(currentName);

    if (!parsed) {
      Logger.log(`  Could not parse filename, skipping: ${currentName}`);
      return false;
    }

    const { dateStr, senderEmail, senderLocal, restOfName } = parsed;
    const year = dateStr.substring(0, 4);

    // Build new target: baseFolder / senderEmail / YYYY /
    const senderFolder = getOrCreateFolder(baseFolder, sanitizeFilename(senderEmail));
    const yearFolder = getOrCreateFolder(senderFolder, year);

    // Build new filename: YYYYMMDD_localpart_restofname
    const newName = `${dateStr}_${sanitizeFilename(senderLocal)}_${restOfName}`;

    // Move file by adding it to new parent and removing from old parent
    const oldParent = file.getParents().next();
    yearFolder.addFile(file);
    oldParent.removeFile(file);
    file.setName(newName);

    Logger.log(`  -> ${senderEmail}/${year}/${newName}`);
    return true;
  } catch (error) {
    Logger.log(`  Error migrating file "${file.getName()}": ${error}`);
    return false;
  }
}

/**
 * Parses a filename created by the old version of the script.
 * Expected pattern: YYYYMMDD_localpart@domain.tld_OriginalName.ext
 * @param {string} filename Filename to parse.
 * @returns {{dateStr: string, senderEmail: string, senderLocal: string, restOfName: string}|null}
 */
function parseOldFilename(filename) {
  // Match: (8 digits) _ (anything with @) _ (rest)
  const match = filename.match(/^(\d{8})_(.+?@[^_]+)_(.+)$/);
  if (!match) return null;

  const dateStr = match[1];
  const senderEmail = match[2].replace(/_/g, '.');  // restore dots that may have been replaced
  const restOfName = match[3];
  const senderLocal = extractLocalPart(senderEmail);

  return { dateStr, senderEmail, senderLocal, restOfName };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Gets or creates a Gmail label by name.
 * @param {string} labelName Name of the label.
 * @returns {GoogleAppsScript.Gmail.GmailLabel} Label object.
 */
function getOrCreateLabel(labelName) {
  try {
    let label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      label = GmailApp.createLabel(labelName);
      Logger.log(`Created Gmail label: ${labelName}`);
    }
    return label;
  } catch (error) {
    Logger.log(`Error getting/creating label "${labelName}": ${error}`);
    throw error;
  }
}

/**
 * Gets or creates a child folder inside a given parent folder.
 * Prevents duplicates by checking existence before creating.
 * @param {GoogleAppsScript.Drive.Folder} parentFolder Parent Drive folder.
 * @param {string} folderName Name of the subfolder.
 * @returns {GoogleAppsScript.Drive.Folder} The subfolder.
 */
function getOrCreateFolder(parentFolder, folderName) {
  try {
    const existing = parentFolder.getFoldersByName(folderName);
    if (existing.hasNext()) return existing.next();
    return parentFolder.createFolder(folderName);
  } catch (error) {
    Logger.log(`Error getting/creating folder "${folderName}": ${error}`);
    throw error;
  }
}

/**
 * Extracts a clean email address from a raw "Display Name <email@domain.com>" string.
 * @param {string} senderString Raw sender string from Gmail.
 * @returns {string} Extracted email address or the original string if no angle brackets.
 */
function extractEmailAddress(senderString) {
  const match = senderString.match(/<([^>]+)>/);
  return match ? match[1] : senderString;
}

/**
 * Extracts the display name from a raw "Display Name <email@domain.com>" string.
 * Falls back to the local part of the email address if no display name is present.
 * @param {string} senderString Raw sender string from Gmail.
 * @returns {string} Display name (e.g. "G2A.com") or local part (e.g. "info").
 */
function extractDisplayName(senderString) {
  // Format: "Display Name <email@domain.com>" or just "email@domain.com"
  const nameMatch = senderString.match(/^([^<]+)</);
  if (nameMatch) {
    const name = nameMatch[1].trim().replace(/^"|"$/g, ''); // strip surrounding quotes
    if (name.length > 0) return name;
  }
  // Fallback: use local part of the email address
  const email = extractEmailAddress(senderString);
  return extractLocalPart(email);
}

/**
 * Extracts the local part (before @) from an email address.
 * @param {string} email Full email address.
 * @returns {string} Local part, or full email if no @ is found.
 */
function extractLocalPart(email) {
  const atIndex = email.indexOf('@');
  return atIndex !== -1 ? email.substring(0, atIndex) : email;
}

/**
 * Replaces characters illegal in Drive file/folder names with underscores.
 * @param {string} name Raw string.
 * @returns {string} Safe string for use as a filename or folder name.
 */
function sanitizeFilename(name) {
  return name.replace(/[\/\\:\*\?"<>\|]/g, '_').replace(/\s+/g, '_');
}

/**
 * Formats a Date as YYYYMMDD.
 * @param {Date} date Date to format.
 * @returns {string} Formatted date string.
 */
function getDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Extracts the 4-digit year from a Date.
 * @param {Date} date Date object.
 * @returns {string} Year as string.
 */
function getYearString(date) {
  return String(date.getFullYear());
}

/**
 * Computes a threshold Date by subtracting a number of months from today.
 * @param {number} months Number of months to subtract from the current date.
 * @returns {Date} The resulting threshold date.
 */
function computeThresholdDate(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

/**
 * Formats a Date object as YYYY/MM/DD for use in Gmail search queries (before: / after:).
 * @param {Date} date Date to format.
 * @returns {string} Date string in YYYY/MM/DD format.
 */
function formatDateForQuery(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}
