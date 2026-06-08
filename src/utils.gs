/**
 * @fileoverview Pure utility functions shared across all Gmail Cleanup Script modules.
 *
 * These functions have NO dependency on Google Apps Script APIs (GmailApp, DriveApp,
 * Logger, etc.) and can be unit-tested directly in a Node.js / Jest environment.
 *
 * In Google Apps Script: loaded automatically alongside cleanup-attachments.gs —
 *   all functions are in the shared global scope.
 * In Node.js / Jest:    imported via the module.exports block at the bottom of
 *   this file (ignored by GAS, which has no `module` global).
 */

// =============================================================================
// STRING UTILITIES
// =============================================================================

/**
 * Replaces characters illegal in Google Drive file/folder names with underscores.
 * Also collapses consecutive whitespace to a single underscore.
 * @param {string} name Raw string to sanitize.
 * @returns {string} Safe string for use as a Drive filename or folder name.
 */
function sanitizeFilename(name) {
  return name.replace(/[\/\\:\*\?"<>\|]/g, '_').replace(/\s+/g, '_');
}

/**
 * Extracts a clean email address from a raw "Display Name <email@domain.com>" string.
 * Returns the original string unchanged if no angle brackets are present.
 * @param {string} senderString Raw sender string from a Gmail message's From header.
 * @returns {string} Extracted email address, or the original string as fallback.
 */
function extractEmailAddress(senderString) {
  const match = senderString.match(/<([^>]+)>/);
  return match ? match[1] : senderString;
}

/**
 * Extracts the display name from a raw "Display Name <email@domain.com>" string.
 * Strips surrounding double-quotes from the display name if present.
 * Falls back to the local part of the email address if no display name is found.
 * @param {string} senderString Raw sender string from a Gmail message's From header.
 * @returns {string} Display name (e.g. "G2A.com") or local part (e.g. "info").
 */
function extractDisplayName(senderString) {
  const nameMatch = senderString.match(/^([^<]+)</);
  if (nameMatch) {
    const name = nameMatch[1].trim().replace(/^"|"$/g, ''); // strip surrounding quotes
    if (name.length > 0) return name;
  }
  // Fallback: use local part of the email address
  return extractLocalPart(extractEmailAddress(senderString));
}

/**
 * Extracts the local part (the substring before @) from an email address.
 * Returns the full string if no @ symbol is found.
 * @param {string} email Full email address string.
 * @returns {string} Local part, or the full email string if no @ is present.
 */
function extractLocalPart(email) {
  const atIndex = email.indexOf('@');
  return atIndex !== -1 ? email.substring(0, atIndex) : email;
}

/**
 * Formats a key-value pair as a padded log line for the text-mode report.
 * Uses middle-dot (·) characters to fill the space between label and value.
 * @param {string} label Left-side label text.
 * @param {string|number} value Right-side value.
 * @param {number} [width=48] Total inner width (label + dots + value).
 * @returns {string} Formatted log line prefixed with two spaces.
 */
function pad(label, value, width) {
  const w   = width || 48;
  const str = String(value);
  const dots = Math.max(1, w - label.length - str.length);
  return `  ${label}${'·'.repeat(dots)}${str}`;
}

// =============================================================================
// DATE UTILITIES
// =============================================================================

/**
 * Formats a Date as YYYYMMDD (used in file naming).
 * @param {Date} date Date to format.
 * @returns {string} Date string in YYYYMMDD format, e.g. "20240607".
 */
function getDateString(date) {
  const year  = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day   = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Extracts the 4-digit year from a Date as a string.
 * @param {Date} date Date object.
 * @returns {string} Year, e.g. "2024".
 */
function getYearString(date) {
  return String(date.getFullYear());
}

/**
 * Formats a Date as YYYY/MM/DD for use in Gmail search query operators
 * (e.g. `before:2024/06/07` or `after:2024/01/01`).
 * @param {Date} date Date to format.
 * @returns {string} Date string in YYYY/MM/DD format.
 */
function formatDateForQuery(date) {
  const year  = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day   = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/**
 * Computes a threshold Date by subtracting a number of months from today (UTC).
 * ⚠️  Google Apps Script runs in UTC — be aware of midnight boundary effects.
 * @param {number} months Number of months to subtract from the current date.
 * @returns {Date} The resulting threshold Date object.
 */
function computeThresholdDate(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

// =============================================================================
// FILENAME / MIGRATION UTILITIES
// =============================================================================

/**
 * Parses a filename produced by the original (v1) version of the script.
 * Expected pattern: YYYYMMDD_localpart@domain.tld_OriginalName.ext
 *
 * Returns null if the filename does not match the expected pattern.
 * @param {string} filename Filename to parse.
 * @returns {{dateStr: string, senderEmail: string, senderLocal: string,
 *   restOfName: string}|null} Parsed components, or null on no match.
 */
function parseOldFilename(filename) {
  // Match: (8 digits) _ (anything with @) _ (rest)
  const match = filename.match(/^(\d{8})_(.+?@[^_]+)_(.+)$/);
  if (!match) return null;

  const dateStr     = match[1];
  const senderEmail = match[2].replace(/_/g, '.'); // restore dots that may have been replaced
  const restOfName  = match[3];
  const senderLocal = extractLocalPart(senderEmail);

  return { dateStr, senderEmail, senderLocal, restOfName };
}

// =============================================================================
// INTELLIGENT FILTERING UTILITIES
// =============================================================================

/**
 * Uses the SENDER_ALIASES configuration to find a friendly sender name.
 * If no alias matches, it falls back to the provided display name, or the domain name, or local part.
 * @param {string} email Sender's email address.
 * @param {string} displayName Extracted display name.
 * @returns {string} Friendly sender name.
 */
function getFriendlySenderName(email, displayName) {
  if (typeof CONFIG !== 'undefined' && CONFIG.SENDER_ALIASES) {
    const lowerEmail = email.toLowerCase();
    
    // Check exact email match
    if (CONFIG.SENDER_ALIASES[lowerEmail]) {
      return CONFIG.SENDER_ALIASES[lowerEmail];
    }
    
    // Check domain match
    const atIndex = lowerEmail.indexOf('@');
    if (atIndex !== -1) {
      const domain = lowerEmail.substring(atIndex);
      if (CONFIG.SENDER_ALIASES[domain]) {
        return CONFIG.SENDER_ALIASES[domain];
      }
    }
  }
  
  // If no alias, use display name if it's not the email local part itself or empty
  if (displayName && displayName !== extractLocalPart(email)) {
    return displayName;
  }
  
  // As a last resort, try to extract a capitalized domain name or use local part
  const atIndex = email.indexOf('@');
  if (atIndex !== -1) {
    const domainPart = email.substring(atIndex + 1);
    const domainName = domainPart.split('.')[0];
    if (domainName && domainName.length > 2) {
      return domainName.charAt(0).toUpperCase() + domainName.slice(1);
    }
  }
  
  return extractLocalPart(email);
}

/**
 * Determines the category of an email based on CONFIG.CATEGORIES rules.
 * @param {string} subject Email subject.
 * @param {string} senderEmail Sender's email address.
 * @param {string} filename Attachment filename.
 * @returns {string} The determined category.
 */
function determineCategory(subject, senderEmail, filename) {
  if (typeof CONFIG === 'undefined' || !CONFIG.CATEGORIES) {
    return 'Otros';
  }
  
  const searchString = `${subject} ${senderEmail} ${filename}`.toLowerCase();
  
  for (let i = 0; i < CONFIG.CATEGORIES.length; i++) {
    const category = CONFIG.CATEGORIES[i];
    for (let j = 0; j < category.keywords.length; j++) {
      if (searchString.indexOf(category.keywords[j].toLowerCase()) !== -1) {
        return category.name;
      }
    }
  }
  
  return CONFIG.DEFAULT_CATEGORY || 'Otros';
}

// =============================================================================
// NODE.JS / JEST EXPORT
// This block is ignored by Google Apps Script (which has no `module` global).
// It allows Jest to import and unit-test these functions directly.
// =============================================================================
if (typeof module !== 'undefined') {
  module.exports = {
    sanitizeFilename,
    extractEmailAddress,
    extractDisplayName,
    extractLocalPart,
    pad,
    getDateString,
    getYearString,
    formatDateForQuery,
    computeThresholdDate,
    parseOldFilename,
    getFriendlySenderName,
    determineCategory,
  };
}
