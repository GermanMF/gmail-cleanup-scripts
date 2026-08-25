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

/** Returns a stable SHA-256 fingerprint for a Gmail/Drive blob. */
function getBlobFingerprint(blob) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    blob.getBytes()
  );
  return digest.map(function (byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

/**
 * Finds an existing same-name file only when its size and SHA-256 content match.
 * A name collision with different content is not considered a duplicate.
 */
function findVerifiedDuplicate(folder, fileName, attachment) {
  const candidates = folder.getFilesByName(fileName);
  let attachmentHash = null;
  while (candidates.hasNext()) {
    const candidate = candidates.next();
    if (candidate.getSize() !== attachment.getSize()) continue;
    if (!attachmentHash) attachmentHash = getBlobFingerprint(attachment);
    if (getBlobFingerprint(candidate.getBlob()) === attachmentHash) return candidate;
  }
  return null;
}

/**
 * Produces a deterministic alternate name when the intended filename is already
 * used by different content. This prevents silently dropping a real document.
 */
function getCollisionSafeFilename(folder, intendedName, attachment) {
  if (!fileExistsInFolder(folder, intendedName)) return intendedName;

  const dotIndex = intendedName.lastIndexOf('.');
  const stem = dotIndex > 0 ? intendedName.substring(0, dotIndex) : intendedName;
  const extension = dotIndex > 0 ? intendedName.substring(dotIndex) : '';
  const shortHash = getBlobFingerprint(attachment).substring(0, 10);
  let candidate = `${stem}_${shortHash}${extension}`;
  let suffix = 2;
  while (fileExistsInFolder(folder, candidate)) {
    candidate = `${stem}_${shortHash}_${suffix}${extension}`;
    suffix++;
  }
  return candidate;
}

/**
 * Gets or creates a Gmail label by name.
 * @param {string} labelName Name of the label.
 * @returns {GoogleAppsScript.Gmail.GmailLabel} Label object.
 */
function getOrCreateLabel(labelName) {
  try {
    let label = findUserLabelCaseInsensitive(labelName);
    if (!label) {
      if (CONFIG.DRY_RUN) {
        throw new Error(`DRY RUN blocked creation of Gmail label "${labelName}"`);
      }
      try {
        label = GmailApp.createLabel(labelName);
        Logger.log(`Created Gmail label: ${labelName}`);
      } catch (createError) {
        // Another execution may create the label between the read and create.
        // Re-read before treating Gmail's "exists or conflicts" as a failure.
        Utilities.sleep(250);
        label = findUserLabelCaseInsensitive(labelName);
        if (!label) throw createError;
        Logger.log(`Gmail label became available concurrently: ${labelName}`);
      }
    }
    return label;
  } catch (error) {
    Logger.log(`Error getting/creating label "${labelName}": ${error}`);
    throw error;
  }
}

/** Finds a user label without relying on Gmail's case-sensitive name lookup. */
function findUserLabelCaseInsensitive(labelName) {
  const wanted = String(labelName || '').toLowerCase();
  const direct = GmailApp.getUserLabelByName(labelName);
  if (direct) return direct;
  const labels = GmailApp.getUserLabels();
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].getName().toLowerCase() === wanted) return labels[i];
  }
  return null;
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
    if (CONFIG.DRY_RUN) {
      throw new Error(`DRY RUN blocked creation of Drive folder "${folderName}"`);
    }
    return parentFolder.createFolder(folderName);
  } catch (error) {
    Logger.log(`Error getting/creating folder "${folderName}": ${error}`);
    throw error;
  }
}

/** Returns an existing child folder without creating anything. */
function getExistingFolder(parentFolder, folderName) {
  const existing = parentFolder.getFoldersByName(folderName);
  return existing.hasNext() ? existing.next() : null;
}
