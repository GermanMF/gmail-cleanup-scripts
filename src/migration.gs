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
 * STAGE 3 MIGRATION — Intelligent Categorization
 * Reorganizes existing files into the new Category / FriendlyName / YYYY structure.
 */
function migrateToIntelligentCategories() {
  try {
    const baseFolder = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.BASE_FOLDER_NAME);
    const categoryFolders = baseFolder.getFolders(); // these might be the old "DisplayName" folders
    let migratedCount = 0;
    let errorCount = 0;

    while (categoryFolders.hasNext()) {
      const topFolder = categoryFolders.next();
      
      const subFolders = topFolder.getFolders();
      while (subFolders.hasNext()) {
        const subFolder = subFolders.next();
        const yearFolders = subFolder.getFolders();
        
        while (yearFolders.hasNext()) {
          const yearFolder = yearFolders.next();
          const files = yearFolder.getFiles();
          
          while (files.hasNext()) {
            const file = files.next();
            const success = migrateFileToCategory(file, baseFolder);
            if (success) migratedCount++;
            else errorCount++;
          }
        }
      }
    }
    
    Logger.log(`Stage 3 migration complete. Migrated: ${migratedCount} | Errors: ${errorCount}`);
  } catch (error) {
    Logger.log(`Critical error in migrateToIntelligentCategories: ${error}`);
  }
}

/**
 * Moves a file to the new Category / FriendlyName / YYYY hierarchy.
 */
function migrateFileToCategory(file, baseFolder) {
  try {
    const filename = file.getName();
    const parentFolder = file.getParents().next(); // year
    const emailFolder = parentFolder.getParents().next(); // email
    const senderEmail = emailFolder.getName();
    
    if (!senderEmail.includes('@')) {
      return false; // not an email folder, skip
    }
    
    const category = determineCategory('', senderEmail, filename);
    const friendlyName = getFriendlySenderName(senderEmail, ''); 
    
    const currentPath = `${emailFolder.getParents().next().getName()}/${senderEmail}/${parentFolder.getName()}`;
    const targetPath = `${category}/${friendlyName}/${parentFolder.getName()}`;
    
    if (currentPath === targetPath) {
      return false; 
    }
    
    const categoryFolder = getOrCreateFolder(baseFolder, sanitizeFilename(category));
    const friendlyFolder = getOrCreateFolder(categoryFolder, sanitizeFilename(friendlyName));
    const yearFolder = getOrCreateFolder(friendlyFolder, parentFolder.getName());
    
    if (fileExistsInFolder(yearFolder, filename)) {
      Logger.log(`  Duplicate found during migration! Trashing source file: ${filename}`);
      file.setTrashed(true);
      return true;
    }
    
    yearFolder.addFile(file);
    parentFolder.removeFile(file);
    
    Logger.log(`  Moved ${filename} to ${category}/${friendlyName}/${parentFolder.getName()}/`);
    return true;
  } catch (error) {
    Logger.log(`  Error migrating file "${file.getName()}": ${error}`);
    return false;
  }
}


/**
 * Sweeps the entire Category / FriendlyName / YYYY structure and trashes duplicate files.
 * Drive allows multiple files with the exact same name. This function keeps the first one
 * it encounters and trashes subsequent ones with the same name in the same folder.
 */
function cleanUpAllDuplicates() {
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
          const trashedInFolder = removeDuplicatesInFolder(yearFolder);
          totalTrashed += trashedInFolder;
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
function removeDuplicatesInFolder(folder) {
  let trashedCount = 0;
  try {
    const files = folder.getFiles();
    const seenNames = new Set();
    
    while (files.hasNext()) {
      const file = files.next();
      if (file.isTrashed()) continue; // Evita procesar archivos que ya están en la papelera
      
      const name = file.getName();
      
      if (seenNames.has(name)) {
        Logger.log(`    Trashing duplicate: ${name} (Folder: ${folder.getName()})`);
        file.setTrashed(true);
        trashedCount++;
      } else {
        seenNames.add(name);
      }
    }
  } catch (error) {
    Logger.log(`  Error cleaning duplicates in folder "${folder.getName()}": ${error}`);
  }
  return trashedCount;
}
