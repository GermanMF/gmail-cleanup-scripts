// =============================================================================
// GAS-SPECIFIC UTILITIES
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

