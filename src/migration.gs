// =============================================================================
// MIGRATION SCRIPTS
// =============================================================================
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
      const displayFolder = CONFIG.DRY_RUN ? null : getOrCreateFolder(baseFolder, sanitizeFilename(displayName));
      const newEmailFolder = CONFIG.DRY_RUN ? null : getOrCreateFolder(displayFolder, sanitizeFilename(emailAddress));

      // Move each year subfolder's files into the new location
      const yearFolders = emailFolder.getFolders();
      while (yearFolders.hasNext()) {
        const yearFolder = yearFolders.next();
        const newYearFolder = CONFIG.DRY_RUN ? null : getOrCreateFolder(newEmailFolder, yearFolder.getName());
        const filesIter = yearFolder.getFiles();
        const filesToMove = [];
        while (filesIter.hasNext()) {
          filesToMove.push(filesIter.next());
        }

        for (let i = 0; i < filesToMove.length; i++) {
          const file = filesToMove[i];
          if (file.isTrashed()) continue;
          try {
            if (CONFIG.DRY_RUN) {
              Logger.log(`  [DRY RUN] Would move: ${file.getName()} -> ${displayName}/${emailAddress}/${yearFolder.getName()}/`);
            } else {
              newYearFolder.addFile(file);
              yearFolder.removeFile(file);
              Logger.log(`  Moved: ${file.getName()} -> ${displayName}/${emailAddress}/${yearFolder.getName()}/`);
            }
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
        const filesIter = monthFolder.getFiles();
        const filesToMigrate = [];

        while (filesIter.hasNext()) {
          filesToMigrate.push(filesIter.next());
        }

        for (let i = 0; i < filesToMigrate.length; i++) {
          const file = filesToMigrate[i];
          if (file.isTrashed()) continue;
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
    const senderFolder = CONFIG.DRY_RUN ? null : getOrCreateFolder(baseFolder, sanitizeFilename(senderEmail));
    const yearFolder = CONFIG.DRY_RUN ? null : getOrCreateFolder(senderFolder, year);

    // Build new filename: YYYYMMDD_localpart_restofname
    const newName = `${dateStr}_${sanitizeFilename(senderLocal)}_${restOfName}`;

    // Move file by adding it to new parent and removing from old parent
    const oldParent = file.getParents().next();
    if (CONFIG.DRY_RUN) {
      Logger.log(`  [DRY RUN] Would move: ${currentName} -> ${senderEmail}/${year}/${newName}`);
    } else {
      yearFolder.addFile(file);
      oldParent.removeFile(file);
      file.setName(newName);
      Logger.log(`  -> ${senderEmail}/${year}/${newName}`);
    }
    return true;
  } catch (error) {
    Logger.log(`  Error migrating file "${file.getName()}": ${error}`);
    return false;
  }
}


/**
 * STAGE 3 MIGRATION — Intelligent Categorization
 * Reorganizes existing files into the new Category / FriendlyName / YYYY structure.
 *
 * Handles BOTH source structures:
 *   OLD: DisplayName / email@domain.com / YYYY / files  (pre-Stage-3)
 *   NEW: Category    / FriendlyName    / YYYY / files  (post-Stage-3, re-categorization)
 *
 * Run repeatedly until it reports 0 files moved — each run processes as many
 * files as possible within the 4.5-minute GAS time budget.
 */
function migrateToIntelligentCategories() {
  const startTime = Date.now();
  const TIME_LIMIT_MS = 4.5 * 60 * 1000;

  try {
    const baseFolder = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    const categoryFolders = baseFolder.getFolders();

    let migratedCount = 0;
    let skippedCount  = 0;
    let dupCount      = 0;
    let errorCount    = 0;
    let timedOut      = false;

    Logger.log('=== Stage 3 Migration START ===');
    if (CONFIG.DRY_RUN) {
      Logger.log('⚠️  DRY RUN MODE ENABLED — no files will be moved or trashed.');
    }
    Logger.log('(Only moves and errors are logged — silent skips mean the file is already correct)');

    const validCategories = new Set(
      CONFIG.CATEGORIES.map(function(c) { return c.name.toLowerCase(); })
    );
    validCategories.add(CONFIG.DEFAULT_CATEGORY.toLowerCase());

    while (categoryFolders.hasNext()) {
      const topFolder     = categoryFolders.next();
      const topFolderName = topFolder.getName();

      if (validCategories.has(topFolderName.toLowerCase())) {
        // Skip already-intelligent categories to speed up migration
        continue;
      }

      const subFolders = topFolder.getFolders();
      while (subFolders.hasNext()) {
        const subFolder     = subFolders.next();
        const subFolderName = subFolder.getName();

        const yearFolders = subFolder.getFolders();
        while (yearFolders.hasNext()) {
          const yearFolder     = yearFolders.next();
          const yearFolderName = yearFolder.getName();

          const filesIter      = yearFolder.getFiles();
          const filesToMigrate = [];
          while (filesIter.hasNext()) {
            filesToMigrate.push(filesIter.next());
          }
          if (filesToMigrate.length === 0) continue;

          for (let i = 0; i < filesToMigrate.length; i++) {
            if (Date.now() - startTime > TIME_LIMIT_MS) {
              Logger.log(`⏱  Time limit reached inside ${topFolderName}/${subFolderName}/${yearFolderName}. Stopping safely.`);
              timedOut = true;
              break;
            }

            const file = filesToMigrate[i];
            if (file.isTrashed()) { skippedCount++; continue; }

            const result = migrateFileToCategory(file, baseFolder);
            if (result === 'moved')     migratedCount++;
            else if (result === 'dup')  dupCount++;
            else if (result === 'skip') skippedCount++;
            else                        errorCount++;
          }

          if (timedOut) break;
        }
        if (timedOut) break;
      }
      if (timedOut) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    Logger.log('');
    Logger.log('=== Stage 3 Migration SUMMARY ===');
    Logger.log(`  Elapsed      : ${elapsed}s`);
    Logger.log(`  Moved        : ${migratedCount}`);
    Logger.log(`  Duplicates   : ${dupCount} (trashed)`);
    Logger.log(`  Skipped      : ${skippedCount} (already correct or trashed)`);
    Logger.log(`  Errors       : ${errorCount}`);

    if (timedOut) {
      Logger.log('');
      Logger.log('⚠️  Time limit hit — run migrateToIntelligentCategories() again to continue.');
    } else {
      if (migratedCount === 0) {
        Logger.log('✅ 0 files moved. Migration is complete!');
      } else {
        Logger.log('✅ All folders processed. Files were moved — run again to re-check.');
      }
    }
  } catch (error) {
    Logger.log(`Critical error in migrateToIntelligentCategories: ${error}`);
  }
}

/**
 * Moves a file to the correct Category / FriendlyName / YYYY location.
 * Detects which folder structure the file currently lives in:
 *
 *   OLD structure: DisplayName / email@domain.com / YYYY  (grandparent has '@')
 *     → classifies using email address + filename
 *
 *   NEW structure: Category / FriendlyName / YYYY  (grandparent has no '@')
 *     → re-classifies using friendlyName + filename as keyword signals
 *     → silently skips if the current category is already correct (no log noise)
 *     → moves if the file belongs in a different category
 *
 * Returns: 'moved' | 'dup' | 'skip' | 'error'
 */
function migrateFileToCategory(file, baseFolder) {
  let filename = '(unknown)';
  try {
    filename = file.getName();

    // Level 1 — year folder
    const fileParents = file.getParents();
    if (!fileParents.hasNext()) return 'skip';
    const yearFolder = fileParents.next();
    const yearName   = yearFolder.getName();

    // Level 2 — sender/friendly-name folder
    const yearParents = yearFolder.getParents();
    if (!yearParents.hasNext()) return 'skip';
    const level2Folder = yearParents.next();
    const level2Name   = level2Folder.getName();

    let category, friendlyName, currentPath;

    if (level2Name.includes('@')) {
      // ── OLD STRUCTURE: DisplayName / email@domain / YYYY ──────────────────
      const senderEmail   = level2Name;
      category            = determineCategory('', senderEmail, filename);
      friendlyName        = getFriendlySenderName(senderEmail, '');

      const emailParents      = level2Folder.getParents();
      const displayFolderName = emailParents.hasNext() ? emailParents.next().getName() : '(unknown)';
      currentPath = `${displayFolderName}/${senderEmail}/${yearName}`;

    } else {
      // ── NEW STRUCTURE: Category / FriendlyName / YYYY ─────────────────────
      friendlyName = level2Name;

      // Determine the category the file SHOULD be in, using the friendly name
      // as a keyword hint (replaces underscores with spaces for matching).
      const friendlyHint = friendlyName.replace(/_/g, ' ').toLowerCase();
      category = determineCategory('', friendlyHint, filename);

      const friendlyParents    = level2Folder.getParents();
      const currentCategoryName = friendlyParents.hasNext() ? friendlyParents.next().getName() : '(unknown)';
      currentPath = `${currentCategoryName}/${friendlyName}/${yearName}`;
    }

    const targetPath = `${category}/${friendlyName}/${yearName}`;

    // Silent skip — file is already where it belongs
    if (currentPath === targetPath) return 'skip';

    // Log only when we're actually going to do something
    Logger.log(`  [MOVE] "${filename}"`);
    Logger.log(`         from : ${currentPath}`);
    Logger.log(`         to   : ${targetPath}`);

    if (CONFIG.DRY_RUN) {
      Logger.log(`         [DRY RUN] Would move → ${targetPath}`);
      return 'moved';
    }

    const catFolder      = getOrCreateFolder(baseFolder, sanitizeFilename(category));
    const friendlyFolder = getOrCreateFolder(catFolder, sanitizeFilename(friendlyName));
    const destYearFolder = getOrCreateFolder(friendlyFolder, yearName);

    const sourceBlob = file.getBlob();
    if (findVerifiedDuplicate(destYearFolder, filename, sourceBlob)) {
      Logger.log(`         → CONTENT-VERIFIED DUPLICATE at destination — trashing source.`);
      file.setTrashed(true);
      return 'dup';
    }

    const destinationName = getCollisionSafeFilename(destYearFolder, filename, sourceBlob);
    destYearFolder.addFile(file);
    yearFolder.removeFile(file);
    if (destinationName !== filename) file.setName(destinationName);
    Logger.log(`         → MOVED ✓`);
    return 'moved';

  } catch (error) {
    Logger.log(`  [ERROR] "${filename}": ${error}`);
    return 'error';
  }
}


/**
 * Sweeps the entire Category / FriendlyName / YYYY structure and trashes duplicate files.
 * Drive allows multiple files with the exact same name. This function keeps the first one
 * it encounters and trashes subsequent ones with the same name in the same folder.
 */
function cleanUpAllDuplicates() {
  const startTime = Date.now();
  try {
    const baseFolder = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    const categoryFolders = baseFolder.getFolders();
    let totalTrashed = 0;

    while (categoryFolders.hasNext()) {
      const categoryFolder = categoryFolders.next();
      const friendlyFolders = categoryFolder.getFolders();

      while (friendlyFolders.hasNext()) {
        const friendlyFolder = friendlyFolders.next();
        const yearFolders = friendlyFolder.getFolders();

        while (yearFolders.hasNext()) {
          const yearFolder = yearFolders.next();
          const trashedInFolder = removeDuplicatesInFolder(yearFolder, startTime);
          totalTrashed += trashedInFolder;
          
          if (Date.now() - startTime > 4.5 * 60 * 1000) {
            Logger.log(`Duplicate cleanup paused due to time limit. Run again to continue.`);
            Logger.log(`Total files trashed in this run: ${totalTrashed}`);
            return;
          }
        }
      }
    }

    Logger.log(`Duplicate cleanup complete. Total files trashed: ${totalTrashed}`);
  } catch (error) {
    Logger.log(`Critical error in cleanUpAllDuplicates: ${error}`);
  }
}

/**
 * Iterates through all files in a specific folder and trashes any with duplicate names.
 * @param {GoogleAppsScript.Drive.Folder} folder 
 * @returns {number} Number of files trashed.
 */
function removeDuplicatesInFolder(folder, startTime) {
  let trashedCount = 0;
  try {
    const files = folder.searchFiles('trashed = false');
    const fingerprintsByName = {};

    const toTrash = [];

    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();

      const fingerprint = `${file.getSize()}:${getBlobFingerprint(file.getBlob())}`;
      if (!fingerprintsByName[name]) fingerprintsByName[name] = new Set();

      if (fingerprintsByName[name].has(fingerprint)) {
        toTrash.push(file);
      } else {
        if (fingerprintsByName[name].size > 0) {
          Logger.log(`    Name collision kept (different content): ${name}`);
        }
        fingerprintsByName[name].add(fingerprint);
      }
    }

    for (let i = 0; i < toTrash.length; i++) {
      if (Date.now() - startTime > 4.5 * 60 * 1000) {
        Logger.log(`    Timeout approaching! Stopping early in folder: ${folder.getName()}`);
        break;
      }
      if (CONFIG.DRY_RUN) {
        Logger.log(`    [DRY RUN] Would trash duplicate: ${toTrash[i].getName()} (ID: ${toTrash[i].getId()})`);
      } else {
        Logger.log(`    Trashing verified duplicate: ${toTrash[i].getName()} (ID: ${toTrash[i].getId()})`);
        toTrash[i].setTrashed(true);
      }
      trashedCount++;
    }
  } catch (error) {
    Logger.log(`  Error cleaning duplicates in folder "${folder.getName()}": ${error}`);
  }
  return trashedCount;
}


// =============================================================================
// POST-MIGRATION CLEANUP
// =============================================================================

/**
 * Deletes (trashes) folders inside the archive root that are NOT valid intelligent
 * category folders AND are completely empty (no files anywhere in their subtree).
 *
 * Valid top-level folders are derived from CONFIG.CATEGORIES names + CONFIG.DEFAULT_CATEGORY.
 * Any other top-level folder left over from a previous migration stage is considered
 * orphaned. Only empty orphaned folders are trashed — non-empty ones are logged as
 * warnings so you can investigate manually.
 *
 * Safe to run multiple times. Always logs every decision.
 */
function deleteOrphanedEmptyFolders() {
  try {
    const baseFolder = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);

    // Build the set of valid top-level category names (lowercase for comparison)
    const validCategories = new Set(
      CONFIG.CATEGORIES.map(function(c) { return c.name.toLowerCase(); })
    );
    validCategories.add(CONFIG.DEFAULT_CATEGORY.toLowerCase());

    const topFolders = baseFolder.getFolders();
    let trashedCount  = 0;
    let skippedCount  = 0;
    let validCount    = 0;

    while (topFolders.hasNext()) {
      const folder     = topFolders.next();
      const folderName = folder.getName();
      const lowerName  = folderName.toLowerCase();

      // --- Valid category: leave it alone ---
      if (validCategories.has(lowerName)) {
        Logger.log(`[OK]      "${folderName}" — valid category, skipping.`);
        validCount++;
        continue;
      }

      // --- Orphaned folder: check if empty recursively ---
      const fileCount = countFilesRecursive(folder);

      if (fileCount === 0) {
        Logger.log(`[TRASH]   "${folderName}" — orphaned & empty, trashing.`);
        if (CONFIG.DRY_RUN) {
          Logger.log(`          [DRY RUN] Folder kept.`);
        } else {
          folder.setTrashed(true);
        }
        trashedCount++;
      } else {
        Logger.log(`[WARNING] "${folderName}" — orphaned but has ${fileCount} file(s). NOT trashed. Investigate manually.`);
        skippedCount++;
      }
    }

    Logger.log('--- deleteOrphanedEmptyFolders summary ---');
    Logger.log(`  Valid categories kept : ${validCount}`);
    Logger.log(`  Orphaned & trashed    : ${trashedCount}`);
    Logger.log(`  Orphaned but non-empty (manual review needed): ${skippedCount}`);
  } catch (error) {
    Logger.log(`Critical error in deleteOrphanedEmptyFolders: ${error}`);
  }
}

/**
 * Recursively counts non-trashed files inside a folder and all its subfolders.
 * @param {GoogleAppsScript.Drive.Folder} folder Root folder to count from.
 * @returns {number} Total number of non-trashed files found.
 */
function countFilesRecursive(folder) {
  let count = 0;

  // Count files in this folder
  const files = folder.searchFiles('trashed = false');
  while (files.hasNext()) {
    files.next();
    count++;
  }

  // Recurse into subfolders
  const subFolders = folder.getFolders();
  while (subFolders.hasNext()) {
    count += countFilesRecursive(subFolders.next());
  }

  return count;
}

/**
 * Validates that no duplicate filenames remain in the Category / FriendlyName / YYYY
 * structure. Scans every year-level folder and reports duplicate counts.
 *
 * This function is READ-ONLY — it never modifies or trashes anything.
 * Run it after cleanUpAllDuplicates() to confirm deduplication succeeded.
 */
function validateNoDuplicates() {
  const startTime = Date.now();
  try {
    const baseFolder      = getExistingFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    if (!baseFolder) {
      Logger.log('Archive folder not found. Nothing to validate.');
      return;
    }
    const categoryFolders = baseFolder.getFolders();
    let totalDuplicates   = 0;
    let foldersScanned    = 0;
    let foldersWithDups   = 0;

    while (categoryFolders.hasNext()) {
      const categoryFolder  = categoryFolders.next();
      const friendlyFolders = categoryFolder.getFolders();

      while (friendlyFolders.hasNext()) {
        const friendlyFolder = friendlyFolders.next();
        const yearFolders    = friendlyFolder.getFolders();

        while (yearFolders.hasNext()) {
          const yearFolder = yearFolders.next();
          foldersScanned++;

          // Time-guard: GAS 6-min limit
          if (Date.now() - startTime > 4.5 * 60 * 1000) {
            Logger.log(`Validation paused due to time limit after scanning ${foldersScanned} folders.`);
            Logger.log(`Duplicates found so far: ${totalDuplicates}`);
            return;
          }

          const dupsInFolder = countDuplicatesInFolder(yearFolder);

          if (dupsInFolder > 0) {
            foldersWithDups++;
            totalDuplicates += dupsInFolder;
            Logger.log(
              `[DUP] ${categoryFolder.getName()}/${friendlyFolder.getName()}/${yearFolder.getName()} — ${dupsInFolder} duplicate(s)`
            );
          }
        }
      }
    }

    Logger.log('--- validateNoDuplicates summary ---');
    Logger.log(`  Folders scanned       : ${foldersScanned}`);
    Logger.log(`  Folders with dups     : ${foldersWithDups}`);
    Logger.log(`  Total duplicate files : ${totalDuplicates}`);

    if (totalDuplicates === 0) {
      Logger.log('✅ No duplicates found! Archive is clean.');
    } else {
      Logger.log(`⚠️  ${totalDuplicates} duplicate(s) remain. Run cleanUpAllDuplicates() again.`);
    }
  } catch (error) {
    Logger.log(`Critical error in validateNoDuplicates: ${error}`);
  }
}

/**
 * Counts how many files in a folder share a name with another file in the same folder.
 * Only counts the extras (i.e., if a name appears 3 times, that's 2 duplicates).
 * @param {GoogleAppsScript.Drive.Folder} folder Folder to inspect.
 * @returns {number} Number of extra (duplicate) files.
 */
function countDuplicatesInFolder(folder) {
  let dupCount = 0;
  try {
    const files     = folder.searchFiles('trashed = false');
    const seenNames = new Set();

    while (files.hasNext()) {
      const name = files.next().getName();
      if (seenNames.has(name)) {
        dupCount++;
      } else {
        seenNames.add(name);
      }
    }
  } catch (error) {
    Logger.log(`  Error counting duplicates in "${folder.getName()}": ${error}`);
  }
  return dupCount;
}


// =============================================================================
// PENDING MIGRATION AUDIT — READ-ONLY DIAGNOSTIC
// =============================================================================

/**
 * READ-ONLY. Scans the Gmail_Attachments_Archive root and reports every
 * top-level folder that is NOT a valid intelligent category.
 *
 * "Pending" means: the folder name is not one of CONFIG.CATEGORIES[].name
 * nor CONFIG.DEFAULT_CATEGORY — i.e., it still needs to go through
 * migrateToIntelligentCategories().
 *
 * Output format (copy-paste friendly):
 *   [PENDING] "<folderName>" — <N> sub-folder(s), <M> total file(s)
 *     [SUB]  "<subFolderName>" — <K> file(s)
 *       [FILE] <filename>          (up to MAX_SAMPLES files per sub-folder)
 *
 * Ends with a single-line summary easy to paste into a spreadsheet:
 *   SUMMARY | pendingFolders | totalFiles | elapsedSeconds
 *
 * Runs with a 4.5-min time guard; partial output is still useful if it times out.
 */
function auditPendingMigration() {
  const startTime = Date.now();
  const MAX_SAMPLES = 5; // sample filenames per sub-folder

  try {
    const baseFolder = getExistingFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    if (!baseFolder) {
      Logger.log('Archive folder not found. Nothing to audit.');
      return;
    }

    // Build the set of valid category names (case-insensitive)
    const validCategories = new Set(
      CONFIG.CATEGORIES.map(function (c) { return c.name.toLowerCase(); })
    );
    validCategories.add(CONFIG.DEFAULT_CATEGORY.toLowerCase());

    Logger.log('====== PENDING MIGRATION AUDIT START ======');
    Logger.log('Archive root : "' + CONFIG.BASE_FOLDER_NAME + '"');
    Logger.log('Valid categories (' + validCategories.size + '): ' +
      Array.from(validCategories).join(', '));
    Logger.log('');

    const topFolders      = baseFolder.getFolders();
    let pendingFolderCount = 0;
    let grandTotalFiles   = 0;
    let timedOut          = false;

    while (topFolders.hasNext()) {
      if (Date.now() - startTime > 4.5 * 60 * 1000) {
        Logger.log('[TIMEOUT] Time limit reached. Partial output above is still useful.');
        timedOut = true;
        break;
      }

      const topFolder     = topFolders.next();
      const topFolderName = topFolder.getName();

      // ── Skip valid categories ──────────────────────────────────────────────
      if (validCategories.has(topFolderName.toLowerCase())) {
        Logger.log('[OK]     "' + topFolderName + '" — valid category, skipped.');
        continue;
      }

      // ── Pending folder ─────────────────────────────────────────────────────
      pendingFolderCount++;
      const subFolders    = topFolder.getFolders();
      const subRows       = [];
      let folderFileTotal = 0;

      while (subFolders.hasNext()) {
        if (Date.now() - startTime > 4.5 * 60 * 1000) {
          Logger.log('[TIMEOUT] Time limit hit inside "' + topFolderName + '".');
          timedOut = true;
          break;
        }

        const subFolder     = subFolders.next();
        const subFolderName = subFolder.getName();
        let   subFileCount  = 0;
        const samples       = [];

        // Recurse one extra level (year folders inside sender folders)
        const hasYearFolders = subFolder.getFolders().hasNext();
        if (hasYearFolders) {
          const yearFolders = subFolder.getFolders();
          while (yearFolders.hasNext()) {
            const yearFolder = yearFolders.next();
            const files      = yearFolder.searchFiles('trashed = false');
            while (files.hasNext()) {
              const file = files.next();
              subFileCount++;
              if (samples.length < MAX_SAMPLES) { samples.push(file.getName()); }
            }
          }
        } else {
          // Files directly inside the sub-folder (flat structure)
          const files = subFolder.searchFiles('trashed = false');
          while (files.hasNext()) {
            const file = files.next();
            subFileCount++;
            if (samples.length < MAX_SAMPLES) { samples.push(file.getName()); }
          }
        }

        folderFileTotal += subFileCount;
        subRows.push({ name: subFolderName, count: subFileCount, samples: samples });
      }

      if (timedOut) break;

      grandTotalFiles += folderFileTotal;

      Logger.log('[PENDING] "' + topFolderName + '" — ' +
        subRows.length + ' sub-folder(s), ' + folderFileTotal + ' file(s)');

      for (let i = 0; i < subRows.length; i++) {
        const row = subRows[i];
        Logger.log('  [SUB]  "' + row.name + '" — ' + row.count + ' file(s)');
        for (let j = 0; j < row.samples.length; j++) {
          Logger.log('    [FILE] ' + row.samples[j]);
        }
      }
      Logger.log('');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    Logger.log('====== PENDING MIGRATION AUDIT END ======');
    Logger.log('');
    Logger.log('SUMMARY | pendingFolders=' + pendingFolderCount +
      ' | totalFiles=' + grandTotalFiles +
      ' | elapsed=' + elapsed + 's' +
      (timedOut ? ' | TIMED_OUT=true (run again)' : ''));

    if (pendingFolderCount === 0) {
      Logger.log('✅ All top-level folders are valid categories. Nothing pending migration!');
    }

  } catch (error) {
    Logger.log('Critical error in auditPendingMigration: ' + error);
  }
}


// =============================================================================
// ARCHIVE AUDIT — READ-ONLY DIAGNOSTIC
// =============================================================================

/**
 * READ-ONLY. Scans the entire Gmail_Attachments_Archive and logs a structured
 * report that can be pasted back to the AI to suggest smarter categories.
 *
 * Output per top-level folder:
 *   [CATEGORY] <name> — <N> sub-folders, <M> total files
 *     [SENDER]  <friendlyName> — <K> files
 *       [SAMPLE] <filename1>
 *       [SAMPLE] <filename2>  (up to 3 samples per sender)
 *
 * Runs with a 4.5-min guard; if it times out just run again — it logs progress
 * as it goes so partial output is still useful.
 */
function auditArchiveStructure() {
  const startTime = Date.now();
  const MAX_SAMPLES_PER_SENDER = 3;

  try {
    const baseFolder = getExistingFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    if (!baseFolder) {
      Logger.log('Archive folder not found. Nothing to audit.');
      return;
    }
    Logger.log('====== ARCHIVE AUDIT START ======');
    Logger.log(`Archive root: "${CONFIG.BASE_FOLDER_NAME}"`);
    Logger.log('');

    const categoryFolders = baseFolder.getFolders();
    let grandTotal = 0;

    while (categoryFolders.hasNext()) {
      const categoryFolder  = categoryFolders.next();
      const categoryName    = categoryFolder.getName();
      const friendlyFolders = categoryFolder.getFolders();

      // Collect sender stats before logging the header
      const senderRows = [];
      let categoryTotal = 0;

      while (friendlyFolders.hasNext()) {
        const friendlyFolder = friendlyFolders.next();
        const senderName     = friendlyFolder.getName();
        const yearFolders    = friendlyFolder.getFolders();
        let senderTotal      = 0;
        const samples        = [];

        while (yearFolders.hasNext()) {
          // Time-guard
          if (Date.now() - startTime > 4.5 * 60 * 1000) {
            Logger.log('[TIMEOUT] Scan paused. Partial output above is still useful.');
            Logger.log(`Grand total so far: ${grandTotal + categoryTotal}`);
            return;
          }

          const yearFolder = yearFolders.next();
          const files      = yearFolder.searchFiles('trashed = false');

          while (files.hasNext()) {
            const file = files.next();
            senderTotal++;
            if (samples.length < MAX_SAMPLES_PER_SENDER) {
              samples.push(file.getName());
            }
          }
        }

        categoryTotal += senderTotal;
        senderRows.push({ name: senderName, count: senderTotal, samples });
      }

      grandTotal += categoryTotal;

      // Log category header
      Logger.log(`[CATEGORY] "${categoryName}" — ${senderRows.length} sender(s), ${categoryTotal} file(s)`);

      // Log each sender + samples
      for (let i = 0; i < senderRows.length; i++) {
        const row = senderRows[i];
        Logger.log(`  [SENDER]  "${row.name}" — ${row.count} file(s)`);
        for (let j = 0; j < row.samples.length; j++) {
          Logger.log(`    [SAMPLE] ${row.samples[j]}`);
        }
      }
      Logger.log('');
    }

    Logger.log('====== ARCHIVE AUDIT END ======');
    Logger.log(`Grand total files: ${grandTotal}`);
  } catch (error) {
    Logger.log(`Critical error in auditArchiveStructure: ${error}`);
  }
}
