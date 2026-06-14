// =============================================================================
// JUNK FILE CLEANUP
// =============================================================================

const JUNK_STATE_FILENAME = 'junk_audit_state.json';
const MAX_EXECUTION_TIME_MS = 4.5 * 60 * 1000; // 4.5 minutes

/**
 * Runs a 30-second performance test to estimate how many files and folders
 * can be processed in a standard 5-minute execution window.
 */
function estimateAuditPerformance() {
  try {
    const root = DriveApp.getRootFolder();
    const search = root.getFoldersByName(CONFIG.BASE_FOLDER_NAME);
    if (!search.hasNext()) {
      Logger.log('Archive folder not found.');
      return;
    }
    const baseFolder = search.next();

    Logger.log('Running 30-second estimation test...');
    const startTime = Date.now();
    let foldersProcessed = 0;
    let filesProcessed = 0;

    function _testWalk(folder) {
      if (Date.now() - startTime > 30 * 1000) return;
      
      const files = folder.getFiles();
      while (files.hasNext()) {
        if (Date.now() - startTime > 30 * 1000) return;
        files.next();
        filesProcessed++;
      }
      foldersProcessed++;

      const subfolders = folder.getFolders();
      while (subfolders.hasNext()) {
        if (Date.now() - startTime > 30 * 1000) return;
        _testWalk(subfolders.next());
      }
    }

    _testWalk(baseFolder);

    const elapsedSec = (Date.now() - startTime) / 1000;
    const filesPerSec = filesProcessed / elapsedSec;
    const foldersPerSec = foldersProcessed / elapsedSec;
    const estFiles5Min = filesPerSec * 300;

    Logger.log('--- Estimation Results ---');
    Logger.log(`Test duration: ${elapsedSec.toFixed(1)}s`);
    Logger.log(`Folders scanned: ${foldersProcessed}`);
    Logger.log(`Files scanned: ${filesProcessed}`);
    Logger.log(`Speed: ${filesPerSec.toFixed(1)} files/sec`);
    Logger.log(`Estimated capacity for a 5-min run: ~${Math.round(estFiles5Min)} files`);
    Logger.log('--------------------------');
  } catch (error) {
    Logger.log(`Error in estimateAuditPerformance: ${error}`);
  }
}

/**
 * Scans the Drive archive for junk files (footers, signatures, empty docs, etc.)
 * based on JUNK_FILE_RULES. Runs in batches to avoid the 6-minute timeout,
 * saving its state to a JSON file.
 */
function auditJunkFiles() {
  try {
    const startTime = Date.now();
    Logger.log('Starting junk file audit batch...');

    const root = DriveApp.getRootFolder();
    const search = root.getFoldersByName(CONFIG.BASE_FOLDER_NAME);
    if (!search.hasNext()) {
      Logger.log('Archive folder not found.');
      return;
    }
    const baseFolder = search.next();

    let state = _getState(baseFolder);

    // If no state, we initialize the queue
    if (!state) {
      Logger.log('No previous state found. Building folder queue...');
      state = {
        queue: _buildFolderQueue(baseFolder),
        candidates: [],
        totalProcessed: 0
      };
      Logger.log(`Queue built: ${state.queue.length} folders to process.`);
    } else {
      Logger.log(`Resuming audit. ${state.queue.length} folders remaining in queue.`);
    }

    let foldersProcessedThisRun = 0;
    let filesProcessedThisRun = 0;

    // Process the queue
    while (state.queue.length > 0) {
      if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
        Logger.log('⚠️ Approaching execution time limit. Saving state to resume on next run...');
        break;
      }

      const folderData = state.queue.shift();
      try {
        const folder = DriveApp.getFolderById(folderData.id);
        const files = folder.getFiles();
        
        while (files.hasNext()) {
          const file = files.next();
          const reason = _isJunkFile(file, folderData.path);
          if (reason) {
            state.candidates.push({
              id: file.getId(),
              name: file.getName(),
              path: folderData.path,
              size: file.getSize(),
              url: file.getUrl(),
              mime: file.getMimeType(),
              reason: reason
            });
          }
          filesProcessedThisRun++;
          state.totalProcessed++;
        }
        foldersProcessedThisRun++;
      } catch (err) {
        Logger.log(`Error processing folder ${folderData.path}: ${err}`);
      }
    }

    // Execution wrapped up (either finished or timed out)
    const isFinished = state.queue.length === 0;

    // Always log what we found THIS run to the sheet to prevent data loss if it fails later
    if (state.candidates.length > 0) {
      const sheet = getOrCreateJunkAuditSheet();
      const now = new Date();
      
      const rows = state.candidates.map(c => [
        'PENDING',                      // A: Status
        now,                            // B: Timestamp
        c.name,                         // C: File Name
        c.path,                         // D: Folder Path
        (c.size / 1024).toFixed(2),     // E: Size (KB)
        c.reason,                       // F: Reason
        c.url,                          // G: Drive URL
        c.id,                           // H: File ID
      ]);

      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      Logger.log(`Added ${state.candidates.length} new candidates to the Junk Audit sheet.`);
      
      // For email report, we pass mock objects that the email generator expects
      if (CONFIG.ENABLE_HTML_REPORT) {
         const emailMocks = state.candidates.map(c => {
           return {
             file: {
               getName: () => c.name,
               getSize: () => c.size,
               getUrl: () => c.url,
               getMimeType: () => c.mime,
               getThumbnailUrl: () => c.url // Basic fallback since getting thumbnail can be slow, but we can't fetch it fully asynchronously here easily.
             },
             path: c.path,
             reason: c.reason
           }
         });
         _sendJunkAuditReportHtml(emailMocks, isFinished);
      }
    }

    if (isFinished) {
      Logger.log('✅ Audit complete! All folders processed.');
      _deleteState(baseFolder);
    } else {
      // Clear candidates so we don't write them twice next time
      state.candidates = [];
      _saveState(baseFolder, state);
      Logger.log(`Batch done. Processed ${foldersProcessedThisRun} folders and ${filesProcessedThisRun} files in this run.`);
      Logger.log(`Run auditJunkFiles() again to continue.`);
    }

  } catch (error) {
    Logger.log(`Critical error in auditJunkFiles: ${error}`);
  }
}

/**
 * Reads the "Junk Audit" sheet, finds rows marked as "CONFIRMED",
 * moves those files to the Trash in Drive, updates the sheet to "DELETED",
 * and sends an HTML report of the deleted files.
 */
function deleteConfirmedJunkFiles() {
  try {
    if (CONFIG.DRY_RUN) {
      Logger.log('⚠️ DRY RUN MODE ENABLED — no files will actually be trashed.');
    }

    const sheet = getOrCreateJunkAuditSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('Junk Audit sheet is empty.');
      return;
    }

    // Read all data
    const dataRange = sheet.getRange(2, 1, lastRow - 1, 8);
    const data = dataRange.getValues();
    const deletedItems = [];
    let trashedCount = 0;

    for (let i = 0; i < data.length; i++) {
      const status = data[i][0];
      const fileName = data[i][2];
      const fileId = data[i][7];

      if (status === 'CONFIRMED') {
        try {
          const file = DriveApp.getFileById(fileId);
          if (!CONFIG.DRY_RUN) {
            file.setTrashed(true);
            // Update sheet status
            sheet.getRange(i + 2, 1).setValue('DELETED');
            sheet.getRange(i + 2, 1).setBackground('#e8f5e9').setFontColor('#2e7d32');
          } else {
            Logger.log(`[DRY RUN] Would trash: ${fileName} (${fileId})`);
          }
          trashedCount++;
          deletedItems.push({
            name: fileName,
            sizeKb: data[i][4],
            path: data[i][3],
            url: data[i][6],
          });
        } catch (fileError) {
          Logger.log(`Error trashing file ${fileId} (${fileName}): ${fileError}`);
          sheet.getRange(i + 2, 1).setValue('ERROR');
          sheet.getRange(i + 2, 1).setBackground('#ffebee').setFontColor('#c62828');
        }
      }
    }

    if (trashedCount > 0) {
      Logger.log(`Successfully trashed ${trashedCount} junk files.`);
      if (CONFIG.ENABLE_HTML_REPORT) {
        _sendJunkDeletedReportHtml(deletedItems);
      }
    } else {
      Logger.log('No CONFIRMED files found to delete.');
    }

  } catch (error) {
    Logger.log(`Critical error in deleteConfirmedJunkFiles: ${error}`);
  }
}

// ── Private Helpers ─────────────────────────────────────────────────────────

function _getState(baseFolder) {
  const files = baseFolder.getFilesByName(JUNK_STATE_FILENAME);
  if (files.hasNext()) {
    const file = files.next();
    try {
      return JSON.parse(file.getBlob().getDataAsString());
    } catch (e) {
      Logger.log('Corrupted state file found. Starting fresh.');
      return null;
    }
  }
  return null;
}

function _saveState(baseFolder, state) {
  const files = baseFolder.getFilesByName(JUNK_STATE_FILENAME);
  if (files.hasNext()) {
    files.next().setContent(JSON.stringify(state));
  } else {
    baseFolder.createFile(JUNK_STATE_FILENAME, JSON.stringify(state), MimeType.PLAIN_TEXT);
  }
}

function _deleteState(baseFolder) {
  const files = baseFolder.getFilesByName(JUNK_STATE_FILENAME);
  if (files.hasNext()) {
    files.next().setTrashed(true);
  }
}

/**
 * Builds a flat list of all deepest folders to process.
 */
function _buildFolderQueue(baseFolder) {
  const queue = [];
  const displayFolders = baseFolder.getFolders();
  
  // Level 1: Category/DisplayName
  while (displayFolders.hasNext()) {
    const dFolder = displayFolders.next();
    const dName = dFolder.getName();
    
    // Level 2: FriendlyName/Email
    const emailFolders = dFolder.getFolders();
    while (emailFolders.hasNext()) {
      const eFolder = emailFolders.next();
      const eName = eFolder.getName();
      
      // Level 3: YYYY
      const yearFolders = eFolder.getFolders();
      while (yearFolders.hasNext()) {
        const yFolder = yearFolders.next();
        queue.push({
          id: yFolder.getId(),
          path: `${CONFIG.BASE_FOLDER_NAME}/${dName}/${eName}/${yFolder.getName()}`
        });
      }
      
      // Also add the email folder itself just in case there are loose files there
      queue.push({
        id: eFolder.getId(),
        path: `${CONFIG.BASE_FOLDER_NAME}/${dName}/${eName}`
      });
    }
    
    // Add display folder
    queue.push({
      id: dFolder.getId(),
      path: `${CONFIG.BASE_FOLDER_NAME}/${dName}`
    });
  }
  
  // Add base folder
  queue.push({
    id: baseFolder.getId(),
    path: CONFIG.BASE_FOLDER_NAME
  });

  return queue;
}

/**
 * Evaluates a file against JUNK_FILE_RULES.
 * @returns {string|null} The reason it's considered junk, or null if it's safe.
 */
function _isJunkFile(file, path) {
  const rules = CONFIG.JUNK_FILE_RULES;
  if (!rules) return null;

  const name = file.getName().toLowerCase();
  const size = file.getSize();
  const mimeType = file.getMimeType();

  // 1. Check Exceptions first
  if (rules.EXCEPTIONS) {
    if (rules.EXCEPTIONS.FILENAMES && rules.EXCEPTIONS.FILENAMES.some(ex => name === ex.toLowerCase())) {
      return null;
    }
    if (rules.EXCEPTIONS.FOLDER_PATHS && rules.EXCEPTIONS.FOLDER_PATHS.some(ex => path.includes(ex))) {
      return null;
    }
  }

  // 2. Bad Extensions
  if (rules.BAD_EXTENSIONS && rules.BAD_EXTENSIONS.some(ext => name.endsWith(ext.toLowerCase()))) {
    return 'Bad extension';
  }

  // 3. Bad MIME types
  if (rules.BAD_MIME_TYPES && rules.BAD_MIME_TYPES.includes(mimeType)) {
    return `Bad MIME type (${mimeType})`;
  }

  // 4. Name Keywords
  if (rules.NAME_KEYWORDS && rules.NAME_KEYWORDS.some(kw => name.includes(kw.toLowerCase()))) {
    return 'Name contains keyword';
  }

  // 5. Tiny File Threshold
  if (rules.TINY_FILE_THRESHOLD_BYTES && size < rules.TINY_FILE_THRESHOLD_BYTES) {
    return 'Tiny file (< 5KB)';
  }

  return null;
}

/**
 * Sends an HTML email with the list of junk candidates.
 */
function _sendJunkAuditReportHtml(candidates, isFinished) {
  try {
    const recipient = CONFIG.REPORT_EMAIL || Session.getActiveUser().getEmail();
    if (!recipient) return;

    const subject = `🕵️ Gmail Cleanup — ${candidates.length} Junk Files Detected`;
    const now = new Date().toISOString().substring(0, 10);
    
    // We only show the first 100 in the email to avoid massive HTML payloads
    const displayLimit = 100;
    const displayCandidates = candidates.slice(0, displayLimit);
    
    const rows = displayCandidates.map(c => {
      // For batched runs we skipped fetching the real thumbnail URL to save time
      let thumbnailHtml = '<div style="width:50px;height:50px;background:#eee;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;line-height:50px;text-align:center;">DOC</div>';

      return `<tr>
        <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">${thumbnailHtml}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;word-break:break-all;">
          <a href="${c.file.getUrl()}" style="color:#1a73e8;text-decoration:none;font-weight:600;">${c.file.getName()}</a><br>
          <span style="font-size:11px;color:#777;">${c.path}</span>
        </td>
        <td style="padding:10px;border-bottom:1px solid #eee;color:#555;font-size:13px;">${c.reason}</td>
        <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${(c.file.getSize() / 1024).toFixed(1)} KB</td>
      </tr>`;
    }).join('');

    const truncatedWarning = candidates.length > displayLimit 
      ? `<div style="background:#fff3e0;color:#e65100;padding:12px;border-radius:6px;text-align:center;font-size:13px;font-weight:600;margin-bottom:20px;">
          Showing first ${displayLimit} files. Please check the Dashboard Sheet for the full list.
         </div>`
      : '';
      
    const statusLabel = isFinished ? 'Audit Finished' : 'Partial Audit Batch';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:24px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
  <tr><td style="background:#e65100;padding:32px;color:#fff;">
    <div style="font-size:24px;font-weight:700;">🕵️ Junk File Audit Report</div>
    <div style="font-size:14px;opacity:0.9;margin-top:6px;">${now} — Found ${candidates.length} candidates (${statusLabel})</div>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="color:#444;font-size:15px;line-height:1.6;margin-bottom:24px;">
      The script has identified the following files as potential junk (signatures, footers, etc.). 
      <strong>They have NOT been deleted yet.</strong> Go to the <a href="${getOrCreateDashboard().spreadsheet.getUrl()}" style="color:#1a73e8;">Junk Audit Sheet</a>, review the list, set the status to <code>CONFIRMED</code> for the ones you want to remove, and run <code>deleteConfirmedJunkFiles()</code>.
    </p>
    ${truncatedWarning}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">
      <tr style="background:#f8f9fa;">
        <th style="padding:10px;text-align:center;color:#666;font-size:12px;text-transform:uppercase;">Preview</th>
        <th style="padding:10px;text-align:left;color:#666;font-size:12px;text-transform:uppercase;">File</th>
        <th style="padding:10px;text-align:left;color:#666;font-size:12px;text-transform:uppercase;">Reason</th>
        <th style="padding:10px;text-align:right;color:#666;font-size:12px;text-transform:uppercase;">Size</th>
      </tr>
      ${rows}
    </table>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;

    MailApp.sendEmail({ to: recipient, subject: subject, htmlBody: html });
    Logger.log(`Audit report emailed to: ${recipient}`);
  } catch (err) {
    Logger.log(`Error sending audit report: ${err}`);
  }
}

/**
 * Sends an HTML email with the list of files successfully moved to Trash.
 */
function _sendJunkDeletedReportHtml(deletedItems) {
  try {
    const recipient = CONFIG.REPORT_EMAIL || Session.getActiveUser().getEmail();
    if (!recipient) return;

    const modeStr = CONFIG.DRY_RUN ? '[DRY RUN] ' : '';
    const subject = `${modeStr}🗑️ Gmail Cleanup — ${deletedItems.length} Junk Files Trashed`;
    const now = new Date().toISOString().substring(0, 10);
    
    let totalSavedKb = 0;
    const rows = deletedItems.map(c => {
      totalSavedKb += parseFloat(c.sizeKb);
      return `<tr>
        <td style="padding:10px;border-bottom:1px solid #eee;word-break:break-all;">
          <a href="${c.url}" style="color:#d32f2f;text-decoration:none;font-weight:600;">${c.name}</a><br>
          <span style="font-size:11px;color:#777;">${c.path}</span>
        </td>
        <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#555;">${c.sizeKb} KB</td>
      </tr>`;
    }).join('');

    const totalSavedMb = (totalSavedKb / 1024).toFixed(2);
    const dryRunBanner = CONFIG.DRY_RUN 
      ? `<div style="background:#fff3e0;color:#e65100;padding:12px;text-align:center;font-weight:bold;">DRY RUN MODE — No files were actually deleted.</div>`
      : '';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
  ${dryRunBanner}
  <tr><td style="background:#d32f2f;padding:32px;color:#fff;">
    <div style="font-size:24px;font-weight:700;">🗑️ Junk Files Trashed</div>
    <div style="font-size:14px;opacity:0.9;margin-top:6px;">${now} — Cleared ${totalSavedMb} MB</div>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="color:#444;font-size:15px;line-height:1.6;margin-bottom:24px;">
      The following <strong>${deletedItems.length}</strong> files have been moved to the Google Drive Trash. You can recover them from the Trash within 30 days if needed.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">
      <tr style="background:#f8f9fa;">
        <th style="padding:10px;text-align:left;color:#666;font-size:12px;text-transform:uppercase;">File</th>
        <th style="padding:10px;text-align:right;color:#666;font-size:12px;text-transform:uppercase;">Size</th>
      </tr>
      ${rows}
    </table>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;

    MailApp.sendEmail({ to: recipient, subject: subject, htmlBody: html });
    Logger.log(`Deletion report emailed to: ${recipient}`);
  } catch (err) {
    Logger.log(`Error sending deletion report: ${err}`);
  }
}
