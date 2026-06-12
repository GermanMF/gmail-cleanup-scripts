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

/**
 * Sends a compact HTML summary email at the end of a processGmailAttachments() run.
 * Unlike sendHtmlCleanupReport(), this function makes NO extra Gmail queries —
 * it only reports the counters already gathered by the main batch loop.
 * Opt-in via CONFIG.ENABLE_BATCH_NOTIFICATION = true.
 * Recipient: CONFIG.REPORT_EMAIL or the running account.
 *
 * @param {number} archivedCount Threads archived and labelled (kept in Gmail).
 * @param {number} deletedCount  Threads archived and moved to Trash.
 * @param {number} skippedCount  Threads skipped (dry-run or excluded sender).
 * @param {number} startTime     Date.now() timestamp from the start of the run.
 */
function sendBatchCompletionNotification(archivedCount, deletedCount, skippedCount, startTime) {
  try {
    const recipient = CONFIG.REPORT_EMAIL || Session.getActiveUser().getEmail();
    if (!recipient) {
      Logger.log('sendBatchCompletionNotification: No recipient email found. Set CONFIG.REPORT_EMAIL.');
      return;
    }

    const now         = new Date();
    const dateStr     = now.toISOString().substring(0, 10);
    const timeStr     = now.toTimeString().substring(0, 5);
    const elapsedSec  = ((Date.now() - startTime) / 1000).toFixed(1);
    const isDryRun    = !!CONFIG.DRY_RUN;
    const modeLabel   = isDryRun ? '⚠️ DRY RUN — no changes were made' : '✅ Live run — changes applied';
    const modeColor   = isDryRun ? '#e65100' : '#2e7d32';
    const modeBg      = isDryRun ? '#fff3e0' : '#e8f5e9';
    const headerColor = isDryRun ? '#e65100' : '#1a73e8';

    const subject = isDryRun
      ? `[DRY RUN] Gmail Cleanup batch complete — ${dateStr}`
      : `✅ Gmail Cleanup batch complete — ${dateStr}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Gmail Cleanup Notification</title></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4f8;padding:24px 0;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">

  <!-- HEADER -->
  <tr><td style="background:${headerColor};padding:28px 28px 20px;border-radius:12px 12px 0 0;">
    <div style="font-size:22px;font-weight:700;color:#fff;">📬 Gmail Cleanup</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.82);margin-top:5px;">Batch Complete &nbsp;·&nbsp; ${dateStr} at ${timeStr}</div>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#fff;padding:28px;border-radius:0 0 12px 12px;box-shadow:0 4px 20px rgba(0,0,0,0.07);">

    <!-- MODE BANNER -->
    <table width="100%" cellpadding="10" cellspacing="0" border="0" style="background:${modeBg};border-radius:8px;margin-bottom:24px;">
    <tr><td style="font-size:13px;font-weight:700;color:${modeColor};text-align:center;">${modeLabel}</td></tr>
    </table>

    <!-- STAT CARDS -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
    <tr>
      <td width="33%" style="padding-right:6px;">
        <table width="100%" cellpadding="14" cellspacing="0" style="background:#e8f5e9;border-radius:10px;text-align:center;">
        <tr><td>
          <div style="font-size:38px;font-weight:800;color:#2e7d32;line-height:1;">${archivedCount}</div>
          <div style="font-size:10px;color:#558b2f;text-transform:uppercase;letter-spacing:0.6px;margin-top:5px;font-weight:700;">Archived &amp; Kept</div>
        </td></tr></table>
      </td>
      <td width="33%" style="padding:0 3px;">
        <table width="100%" cellpadding="14" cellspacing="0" style="background:#fce4ec;border-radius:10px;text-align:center;">
        <tr><td>
          <div style="font-size:38px;font-weight:800;color:#c62828;line-height:1;">${deletedCount}</div>
          <div style="font-size:10px;color:#ad1457;text-transform:uppercase;letter-spacing:0.6px;margin-top:5px;font-weight:700;">Archived &amp; Deleted</div>
        </td></tr></table>
      </td>
      <td width="33%" style="padding-left:6px;">
        <table width="100%" cellpadding="14" cellspacing="0" style="background:#fff8e1;border-radius:10px;text-align:center;">
        <tr><td>
          <div style="font-size:38px;font-weight:800;color:#e65100;line-height:1;">${skippedCount}</div>
          <div style="font-size:10px;color:#bf360c;text-transform:uppercase;letter-spacing:0.6px;margin-top:5px;font-weight:700;">${isDryRun ? 'Dry-Run Skipped' : 'Skipped'}</div>
        </td></tr></table>
      </td>
    </tr>
    </table>

    <!-- TIMING -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:#555;margin-bottom:20px;">
      <tr>
        <td style="padding:9px 10px;border-bottom:1px solid #f0f0f0;">⏱ Execution time</td>
        <td style="padding:9px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;">${elapsedSec}s</td>
      </tr>
      <tr>
        <td style="padding:9px 10px;">📦 Batch size</td>
        <td style="padding:9px 10px;text-align:right;font-weight:700;">${CONFIG.BATCH_SIZE} threads</td>
      </tr>
    </table>

    <!-- FOOTER -->
    <div style="border-top:1px solid #eee;padding-top:14px;font-size:11px;color:#bbb;text-align:center;">
      Gmail Cleanup Scripts &nbsp;·&nbsp; ${dateStr} ${timeStr} &nbsp;·&nbsp; Google Apps Script
    </div>

  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    MailApp.sendEmail({ to: recipient, subject: subject, htmlBody: html });
    Logger.log(`Batch notification sent to: ${recipient}`);
  } catch (error) {
    Logger.log(`sendBatchCompletionNotification error: ${error}`);
  }
}