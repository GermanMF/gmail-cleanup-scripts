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
  /**
   * List of senders to skip entirely during attachment archiving.
   * Supports two formats:
   *   - Exact email:  'newsletter@example.com'
   *   - Full domain:  '@marketing.example.com'  (matches any address at that domain)
   * Comparison is case-insensitive.
   * @example ['noreply@spam.com', '@newsletters.co']
   */
  EXCLUDED_SENDERS: [],
  /**
   * Set to true to send an HTML-formatted cleanup report email after each run.
   * The email is sent to REPORT_EMAIL, or the active user's account if left empty.
   * Requires the gmail.send OAuth scope (already included in appsscript.json).
   */
  ENABLE_HTML_REPORT: false,
  /**
   * Recipient email address for the HTML report.
   * Leave empty to default to the Google account running the script.
   */
  REPORT_EMAIL: '',
  /**
   * Set to true to append a run record to a Google Sheets dashboard after each run.
   * On first run a new spreadsheet is created and its ID is logged — copy it into
   * DASHBOARD_SPREADSHEET_ID so future runs reuse the same sheet.
   */
  ENABLE_DASHBOARD: false,
  /**
   * Google Sheets spreadsheet ID for the historical dashboard.
   * Leave empty to auto-create on the first run with ENABLE_DASHBOARD: true.
   */
  DASHBOARD_SPREADSHEET_ID: '',
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

    // ── Optional: HTML email report ─────────────────────────────────────────
    if (CONFIG.ENABLE_HTML_REPORT) {
      sendHtmlCleanupReport('Post-Cleanup Report', { archived: archivedCount, deleted: deletedCount });
    }

    // ── Optional: Spreadsheet dashboard ────────────────────────────────────
    if (CONFIG.ENABLE_DASHBOARD) {
      updateSpreadsheetDashboard({ archived: archivedCount, deleted: deletedCount });
    }

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

    // ── Exclusion list check ────────────────────────────────────────────────
    if (isSenderExcluded(senderEmail)) {
      Logger.log(`  Skipped excluded sender: ${senderEmail}`);
      return;
    }

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


// =============================================================================
// HTML REPORT & SPREADSHEET DASHBOARD
// =============================================================================

/**
 * Collects current Gmail and Drive statistics into a structured object.
 * Shared by sendHtmlCleanupReport() and updateSpreadsheetDashboard() to avoid
 * duplicating expensive Gmail query calls.
 * @returns {{totalThreads: number, processed: number, recentUntouched: number,
 *   toArchiveOnly: number, toArchiveDelete: number, totalPending: number,
 *   runsRemaining: number, topSenders: Array, driveStats: Object}}
 */
function collectCleanupStats() {
  const archiveDate    = computeThresholdDate(CONFIG.ARCHIVE_AFTER_MONTHS);
  const deleteDate     = computeThresholdDate(CONFIG.DELETE_AFTER_MONTHS);
  const archiveDateStr = formatDateForQuery(archiveDate);
  const deleteDateStr  = formatDateForQuery(deleteDate);

  const totalThreads    = countThreads('has:attachment -in:chats');
  const processed       = countThreads(`has:attachment -in:chats label:${CONFIG.PROCESSED_LABEL}`);
  const recentUntouched = countThreads(`has:attachment -in:chats after:${archiveDateStr}`);
  const toArchiveOnly   = countThreads([
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
  const totalPending  = toArchiveOnly + toArchiveDelete;
  const runsRemaining = Math.ceil(totalPending / CONFIG.BATCH_SIZE);
  const topSenders    = getTopSenders(
    `has:attachment -in:chats -label:${CONFIG.PROCESSED_LABEL} before:${archiveDateStr}`,
    10
  );
  const driveStats = getDriveArchiveStats();

  return {
    totalThreads, processed, recentUntouched,
    toArchiveOnly, toArchiveDelete, totalPending,
    runsRemaining, topSenders, driveStats,
  };
}

/**
 * Sends a styled HTML cleanup report email.
 * Collects fresh Gmail and Drive stats, builds the HTML body, and sends via MailApp.
 * Can also be run standalone as a GAS entry point (no batchResult required).
 * @param {string} [title='Gmail Cleanup Report'] Title shown in subject and email header.
 * @param {{archived?: number, deleted?: number}} [batchResult] Per-run counters from the batch.
 */
function sendHtmlCleanupReport(title, batchResult) {
  try {
    const reportTitle = title || 'Gmail Cleanup Report';
    const recipient   = CONFIG.REPORT_EMAIL || Session.getActiveUser().getEmail();
    if (!recipient) {
      Logger.log('sendHtmlCleanupReport: No recipient email found. Set CONFIG.REPORT_EMAIL.');
      return;
    }

    Logger.log('Collecting stats for HTML report...');
    const stats   = collectCleanupStats();
    const html    = buildHtmlReportBody(reportTitle, stats, batchResult || {});
    const subject = `📬 ${reportTitle} — ${new Date().toISOString().substring(0, 10)}`;

    MailApp.sendEmail({ to: recipient, subject: subject, htmlBody: html });
    Logger.log(`HTML report sent to: ${recipient}`);
  } catch (error) {
    Logger.log(`sendHtmlCleanupReport error: ${error}`);
  }
}

/**
 * Builds the full HTML email body for the cleanup report.
 * Uses table-based layouts for maximum email client compatibility.
 * @param {string} title Report title for the header and subject.
 * @param {Object} stats Output from collectCleanupStats().
 * @param {{archived?: number, deleted?: number}} batchResult Per-run counters.
 * @returns {string} Complete HTML document string.
 */
function buildHtmlReportBody(title, stats, batchResult) {
  const now          = new Date();
  const dateStr      = now.toISOString().substring(0, 10);
  const timeStr      = now.toTimeString().substring(0, 5);
  const archived     = batchResult.archived || 0;
  const deleted      = batchResult.deleted  || 0;
  const progressPct  = stats.totalThreads > 0
    ? ((stats.processed / stats.totalThreads) * 100).toFixed(1)
    : '0.0';
  const progressBar  = Math.round(parseFloat(progressPct));

  const senderRows = stats.topSenders.length === 0
    ? '<tr><td colspan="3" style="padding:14px 12px;color:#999;text-align:center;">No pending threads found</td></tr>'
    : stats.topSenders.map(function (s, i) {
        return `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#aaa;font-weight:700;width:32px;">${i + 1}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">${s.name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;">${s.count}</td>
        </tr>`;
      }).join('');

  const driveRows = stats.driveStats.found
    ? `<tr><td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">Files saved to Drive</td>
         <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;">${stats.driveStats.totalFiles.toLocaleString()}</td></tr>
       <tr><td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">Unique senders</td>
         <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;">${stats.driveStats.senderFolders}</td></tr>
       <tr><td style="padding:10px 12px;">Year folders</td>
         <td style="padding:10px 12px;text-align:right;font-weight:700;">${stats.driveStats.yearFolders}</td></tr>`
    : '<tr><td colspan="2" style="padding:14px 12px;color:#999;">Archive folder not found — run processGmailAttachments first.</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;color:#333;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4f8;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

  <!-- HEADER -->
  <tr><td style="background:#1a73e8;padding:36px 32px;border-radius:12px 12px 0 0;">
    <div style="font-size:26px;font-weight:700;color:#fff;">📬 Gmail Cleanup</div>
    <div style="font-size:14px;color:rgba(255,255,255,0.82);margin-top:6px;">${title} &nbsp;·&nbsp; ${dateStr} at ${timeStr}</div>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

    <!-- SECTION LABEL -->
    <div style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:14px;">This Run</div>

    <!-- STAT CARDS -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
    <tr>
      <td width="33%" style="padding-right:8px;">
        <table width="100%" cellpadding="16" cellspacing="0" style="background:#e8f5e9;border-radius:10px;text-align:center;">
        <tr><td>
          <div style="font-size:42px;font-weight:800;color:#2e7d32;line-height:1;">${archived}</div>
          <div style="font-size:11px;color:#558b2f;text-transform:uppercase;letter-spacing:0.6px;margin-top:6px;font-weight:600;">Archived &amp; Kept</div>
        </td></tr></table>
      </td>
      <td width="33%" style="padding:0 4px;">
        <table width="100%" cellpadding="16" cellspacing="0" style="background:#fce4ec;border-radius:10px;text-align:center;">
        <tr><td>
          <div style="font-size:42px;font-weight:800;color:#c62828;line-height:1;">${deleted}</div>
          <div style="font-size:11px;color:#ad1457;text-transform:uppercase;letter-spacing:0.6px;margin-top:6px;font-weight:600;">Archived &amp; Deleted</div>
        </td></tr></table>
      </td>
      <td width="33%" style="padding-left:8px;">
        <table width="100%" cellpadding="16" cellspacing="0" style="background:#fff8e1;border-radius:10px;text-align:center;">
        <tr><td>
          <div style="font-size:42px;font-weight:800;color:#e65100;line-height:1;">${stats.totalPending}</div>
          <div style="font-size:11px;color:#bf360c;text-transform:uppercase;letter-spacing:0.6px;margin-top:6px;font-weight:600;">Still Pending</div>
        </td></tr></table>
      </td>
    </tr>
    </table>

    <!-- PROGRESS -->
    <div style="margin-bottom:30px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:7px;">
      <tr>
        <td style="font-size:13px;color:#555;font-weight:600;">Overall Progress</td>
        <td style="font-size:13px;color:#1a73e8;font-weight:700;text-align:right;">${progressPct}% complete</td>
      </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8eaf6;border-radius:99px;height:8px;overflow:hidden;">
      <tr>
        <td width="${progressBar}%" style="background:#1a73e8;height:8px;border-radius:99px;"></td>
        <td></td>
      </tr>
      </table>
      <div style="font-size:12px;color:#aaa;margin-top:5px;">${stats.processed.toLocaleString()} of ${stats.totalThreads.toLocaleString()} threads processed &nbsp;·&nbsp; ~${stats.runsRemaining} runs remaining</div>
    </div>

    <!-- AGE BREAKDOWN -->
    <div style="font-size:15px;font-weight:700;color:#333;border-bottom:2px solid #e8eaf6;padding-bottom:8px;margin-bottom:14px;">⏳ Age Breakdown</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;margin-bottom:28px;">
      <tr style="background:#f8f9fa;">
        <th style="text-align:left;padding:10px 12px;font-weight:600;color:#666;">Age Range</th>
        <th style="text-align:left;padding:10px 12px;font-weight:600;color:#666;">Action</th>
        <th style="text-align:right;padding:10px 12px;font-weight:600;color:#666;">Count</th>
      </tr>
      <tr>
        <td style="padding:11px 12px;border-bottom:1px solid #f0f0f0;">&lt; ${CONFIG.ARCHIVE_AFTER_MONTHS} months</td>
        <td style="padding:11px 12px;border-bottom:1px solid #f0f0f0;"><span style="background:#f5f5f5;color:#777;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Untouched</span></td>
        <td style="padding:11px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;">${stats.recentUntouched.toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding:11px 12px;border-bottom:1px solid #f0f0f0;">${CONFIG.ARCHIVE_AFTER_MONTHS}–${CONFIG.DELETE_AFTER_MONTHS} months</td>
        <td style="padding:11px 12px;border-bottom:1px solid #f0f0f0;"><span style="background:#e3f2fd;color:#1565c0;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Archive + Keep</span></td>
        <td style="padding:11px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;">${stats.toArchiveOnly.toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding:11px 12px;">&gt; ${CONFIG.DELETE_AFTER_MONTHS} months</td>
        <td style="padding:11px 12px;"><span style="background:#fce4ec;color:#c62828;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">Archive + Delete</span></td>
        <td style="padding:11px 12px;text-align:right;font-weight:700;">${stats.toArchiveDelete.toLocaleString()}</td>
      </tr>
    </table>

    <!-- TOP SENDERS -->
    <div style="font-size:15px;font-weight:700;color:#333;border-bottom:2px solid #e8eaf6;padding-bottom:8px;margin-bottom:14px;">🏆 Top 10 Senders (Pending)</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;margin-bottom:28px;">
      <tr style="background:#f8f9fa;">
        <th style="text-align:left;padding:10px 12px;font-weight:600;color:#666;width:36px;">#</th>
        <th style="text-align:left;padding:10px 12px;font-weight:600;color:#666;">Sender</th>
        <th style="text-align:right;padding:10px 12px;font-weight:600;color:#666;">Threads</th>
      </tr>
      ${senderRows}
    </table>

    <!-- DRIVE STATS -->
    <div style="font-size:15px;font-weight:700;color:#333;border-bottom:2px solid #e8eaf6;padding-bottom:8px;margin-bottom:14px;">📁 Drive Archive (${CONFIG.BASE_FOLDER_NAME})</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;margin-bottom:28px;">
      <tr style="background:#f8f9fa;">
        <th style="text-align:left;padding:10px 12px;font-weight:600;color:#666;">Metric</th>
        <th style="text-align:right;padding:10px 12px;font-weight:600;color:#666;">Value</th>
      </tr>
      ${driveRows}
    </table>

    <!-- FORECAST -->
    <div style="font-size:15px;font-weight:700;color:#333;border-bottom:2px solid #e8eaf6;padding-bottom:8px;margin-bottom:14px;">🏃 Execution Forecast</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;margin-bottom:28px;">
      <tr><td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#666;">Batch size</td><td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;">${CONFIG.BATCH_SIZE} threads</td></tr>
      <tr><td style="padding:10px 12px;color:#666;">Estimated runs remaining</td><td style="padding:10px 12px;text-align:right;font-weight:700;">${stats.runsRemaining}</td></tr>
    </table>

    <!-- FOOTER -->
    <div style="border-top:1px solid #eee;padding-top:16px;font-size:12px;color:#bbb;text-align:center;">
      Gmail Cleanup Scripts &nbsp;·&nbsp; ${dateStr} ${timeStr} &nbsp;·&nbsp; Sent via Google Apps Script
    </div>

  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Appends a run record to the "Run History" sheet and refreshes the "Summary"
 * sheet in the Gmail Cleanup Dashboard spreadsheet.
 * If CONFIG.DASHBOARD_SPREADSHEET_ID is empty, creates a new spreadsheet automatically
 * and logs its ID — copy it into CONFIG to link future runs.
 * Can also be called as a standalone GAS entry point.
 * @param {{archived?: number, deleted?: number}} [batchResult] Per-run counters.
 */
function updateSpreadsheetDashboard(batchResult) {
  try {
    Logger.log('Collecting stats for dashboard...');
    const stats    = collectCleanupStats();
    const result   = batchResult || {};
    const archived = result.archived || 0;
    const deleted  = result.deleted  || 0;
    const now      = new Date();

    const { spreadsheet, historySheet, summarySheet } = getOrCreateDashboard();

    // ── Append to Run History ─────────────────────────────────────────────
    historySheet.appendRow([
      now,                               // A: Timestamp
      archived,                          // B: Archived & Kept (this run)
      deleted,                           // C: Archived & Deleted (this run)
      stats.totalPending,                // D: Total Pending
      stats.toArchiveOnly,               // E: Pending (archive + keep)
      stats.toArchiveDelete,             // F: Pending (archive + delete)
      stats.processed,                   // G: Total Processed (cumulative)
      stats.totalThreads,                // H: Total Threads in Mailbox
      stats.driveStats.totalFiles || 0,  // I: Drive Files (total)
      stats.runsRemaining,               // J: Estimated Runs Remaining
    ]);

    // ── Refresh Summary sheet ─────────────────────────────────────────────
    summarySheet.clearContents();
    const summaryData = [
      ['Gmail Cleanup Dashboard', 'Last Updated: ' + now.toISOString()],
      ['', ''],
      ['📬 LAST RUN', ''],
      ['Archived & Kept',    archived],
      ['Archived & Deleted', deleted],
      ['', ''],
      ['⏳ CURRENT STATE', ''],
      ['Total Threads',                                              stats.totalThreads],
      ['Processed (cumulative)',                                     stats.processed],
      ['Pending — Archive + Keep',                                   stats.toArchiveOnly],
      ['Pending — Archive + Delete',                                 stats.toArchiveDelete],
      ['Total Pending',                                              stats.totalPending],
      ['Recent Untouched (< ' + CONFIG.ARCHIVE_AFTER_MONTHS + ' mo)', stats.recentUntouched],
      ['', ''],
      ['🏃 FORECAST', ''],
      ['Batch Size',               CONFIG.BATCH_SIZE],
      ['Runs Remaining (est.)',    stats.runsRemaining],
      ['', ''],
      ['📁 DRIVE ARCHIVE', ''],
      ['Total Files',       stats.driveStats.totalFiles    || 0],
      ['Unique Senders',    stats.driveStats.senderFolders || 0],
      ['Year Folders',      stats.driveStats.yearFolders   || 0],
    ];

    const range = summarySheet.getRange(1, 1, summaryData.length, 2);
    range.setValues(summaryData);

    // Header row
    summarySheet.getRange(1, 1, 1, 2).setFontWeight('bold').setFontSize(13)
      .setBackground('#1a73e8').setFontColor('#ffffff');

    // Section label rows
    [3, 7, 15, 19].forEach(function (row) {
      summarySheet.getRange(row, 1).setFontWeight('bold').setBackground('#e8f0fe');
      summarySheet.getRange(row, 2).setBackground('#e8f0fe');
    });

    summarySheet.autoResizeColumn(1);
    summarySheet.autoResizeColumn(2);

    Logger.log('Dashboard updated: ' + spreadsheet.getUrl());
  } catch (error) {
    Logger.log(`updateSpreadsheetDashboard error: ${error}`);
  }
}

/**
 * Returns (and if needed, creates) the Gmail Cleanup Dashboard spreadsheet
 * along with its "Run History" and "Summary" sheets.
 * If CONFIG.DASHBOARD_SPREADSHEET_ID is empty, a new spreadsheet is created
 * and its ID is logged so the user can persist it in CONFIG.
 * @returns {{spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
 *   historySheet: GoogleAppsScript.Spreadsheet.Sheet,
 *   summarySheet: GoogleAppsScript.Spreadsheet.Sheet}}
 */
function getOrCreateDashboard() {
  let spreadsheet;
  let isNew = false;

  if (CONFIG.DASHBOARD_SPREADSHEET_ID) {
    spreadsheet = SpreadsheetApp.openById(CONFIG.DASHBOARD_SPREADSHEET_ID);
  } else {
    spreadsheet = SpreadsheetApp.create('Gmail Cleanup Dashboard');
    isNew = true;
    Logger.log('');
    Logger.log('⚠️  Created a new Gmail Cleanup Dashboard spreadsheet.');
    Logger.log('   URL: ' + spreadsheet.getUrl());
    Logger.log('   Copy this ID into CONFIG.DASHBOARD_SPREADSHEET_ID:');
    Logger.log('   "' + spreadsheet.getId() + '"');
    Logger.log('');
  }

  // ── Run History sheet ─────────────────────────────────────────────────
  let historySheet = spreadsheet.getSheetByName('Run History');
  if (!historySheet) {
    historySheet = isNew ? spreadsheet.getActiveSheet() : spreadsheet.insertSheet();
    historySheet.setName('Run History');

    const headers = [
      'Timestamp', 'Archived & Kept', 'Archived & Deleted',
      'Total Pending', 'Pending (keep)', 'Pending (delete)',
      'Total Processed', 'Total Threads', 'Drive Files', 'Runs Remaining',
    ];
    const headerRange = historySheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setBackground('#1a73e8').setFontColor('#ffffff')
      .setFontWeight('bold').setFontSize(11);
    historySheet.setFrozenRows(1);
    historySheet.setColumnWidth(1, 165);  // Timestamp
    for (var c = 2; c <= headers.length; c++) {
      historySheet.setColumnWidth(c, 128);
    }
  }

  // ── Summary sheet ─────────────────────────────────────────────────────
  let summarySheet = spreadsheet.getSheetByName('Summary');
  if (!summarySheet) {
    summarySheet = spreadsheet.insertSheet('Summary');
    summarySheet.setColumnWidth(1, 300);
    summarySheet.setColumnWidth(2, 200);
  }

  return { spreadsheet: spreadsheet, historySheet: historySheet, summarySheet: summarySheet };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
// Pure string and date utilities (sanitizeFilename, extractEmailAddress,
// extractDisplayName, extractLocalPart, pad, getDateString, getYearString,
// formatDateForQuery, computeThresholdDate, parseOldFilename) live in utils.gs.
// GAS loads both files in the same scope, so they are available here automatically.
// For unit tests, see __tests__/utils.test.js.
// =============================================================================

/**
 * Checks whether a sender's email address matches any rule in CONFIG.EXCLUDED_SENDERS.
 * Supports two rule formats:
 *   - Exact match:   'newsletter@example.com'
 *   - Domain match:  '@example.com'  (matches any address at that domain)
 * Comparison is case-insensitive.
 * @param {string} senderEmail Normalised sender email address.
 * @returns {boolean} True if the sender should be skipped.
 */
function isSenderExcluded(senderEmail) {
  if (!CONFIG.EXCLUDED_SENDERS || CONFIG.EXCLUDED_SENDERS.length === 0) return false;
  const email = senderEmail.toLowerCase();
  return CONFIG.EXCLUDED_SENDERS.some(function (rule) {
    const r = rule.toLowerCase().trim();
    // Domain rule starts with '@' — match anything ending in that domain
    return r.startsWith('@') ? email.endsWith(r) : email === r;
  });
}

/**
 * Checks whether a file with the given name already exists in a Drive folder.
 * Used by saveAttachment() to prevent re-saving duplicate files.
 * This call is read-only and has no side effects.
 * @param {GoogleAppsScript.Drive.Folder} folder Drive folder to search.
 * @param {string} fileName Exact file name to look for.
 * @returns {boolean} True if at least one file with that name exists.
 */
function fileExistsInFolder(folder, fileName) {
  return folder.getFilesByName(fileName).hasNext();
}

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

