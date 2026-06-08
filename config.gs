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
