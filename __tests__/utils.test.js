'use strict';

/**
 * @fileoverview Unit tests for utils.gs pure utility functions.
 * Run with: npm test
 *
 * These tests run in Node.js — no Google Apps Script environment needed.
 * utils.gs exports its functions via the module.exports block at the bottom
 * of the file, which is ignored by GAS but picked up by Jest here.
 */

const {
  sanitizeFilename,
  extractEmailAddress,
  extractDisplayName,
  extractLocalPart,
  extractEmailDomain,
  isProtectedSenderEmail,
  pad,
  getDateString,
  getYearString,
  formatDateForQuery,
  computeThresholdDate,
  parseOldFilename,
  getFriendlySenderName,
  determineCategory,
  normalizeForMatching,
  containsCategoryKeyword,
  isProtectedAutomationSubject,
  classifyFinancialSubject,
  decideThreadAction,
  decideInboxRuleAction,
} = require('../src/utils.gs');

// =============================================================================
// sanitizeFilename
// =============================================================================

describe('sanitizeFilename', () => {
  test.each([
    ['file/name',    'file_name'],
    ['file\\name',   'file_name'],
    ['file:name',    'file_name'],
    ['file*name',    'file_name'],
    ['file?name',    'file_name'],
    ['file"name',    'file_name'],
    ['file<name',    'file_name'],
    ['file>name',    'file_name'],
    ['file|name',    'file_name'],
  ])('replaces illegal char in "%s" → "%s"', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  test('collapses multiple spaces into a single underscore', () => {
    expect(sanitizeFilename('hello  world')).toBe('hello_world');
    expect(sanitizeFilename('a   b   c')).toBe('a_b_c');
  });

  test('replaces a single space', () => {
    expect(sanitizeFilename('hello world')).toBe('hello_world');
  });

  test('leaves safe characters untouched', () => {
    expect(sanitizeFilename('valid-name_123.pdf')).toBe('valid-name_123.pdf');
  });

  test('handles empty string', () => {
    expect(sanitizeFilename('')).toBe('');
  });

  test('sanitizes a realistic email address for Drive folder use', () => {
    expect(sanitizeFilename('info@company.com')).toBe('info@company.com');
  });
});

// =============================================================================
// extractEmailAddress
// =============================================================================

describe('extractEmailAddress', () => {
  test('extracts email from "Display Name <email@domain.com>"', () => {
    expect(extractEmailAddress('John Doe <john@example.com>')).toBe('john@example.com');
  });

  test('extracts email from quoted display name form', () => {
    expect(extractEmailAddress('"Company, Inc." <billing@company.com>')).toBe('billing@company.com');
  });

  test('returns the string as-is when no angle brackets are present', () => {
    expect(extractEmailAddress('plain@email.com')).toBe('plain@email.com');
  });

  test('handles angle brackets with no display name', () => {
    expect(extractEmailAddress('<only@email.com>')).toBe('only@email.com');
  });

  test('handles extra spaces around the email', () => {
    expect(extractEmailAddress('Name < spaced@email.com >')).toBe(' spaced@email.com ');
  });
});

// =============================================================================
// extractDisplayName
// =============================================================================

describe('extractDisplayName', () => {
  test('extracts display name from standard "Name <email>" format', () => {
    expect(extractDisplayName('John Doe <john@example.com>')).toBe('John Doe');
  });

  test('extracts display name with punctuation', () => {
    expect(extractDisplayName('G2A.com <noreply@g2a.com>')).toBe('G2A.com');
  });

  test('strips surrounding double-quotes from display name', () => {
    expect(extractDisplayName('"Company Inc." <info@company.com>')).toBe('Company Inc.');
  });

  test('falls back to email local part when input is a plain email', () => {
    expect(extractDisplayName('plain@email.com')).toBe('plain');
  });

  test('falls back to local part when angle-bracket form has no display name', () => {
    expect(extractDisplayName('<only@email.com>')).toBe('only');
  });

  test('returns non-empty display name when it consists of a single word', () => {
    expect(extractDisplayName('Shopify <no-reply@shopify.com>')).toBe('Shopify');
  });
});

// =============================================================================
// extractLocalPart
// =============================================================================

describe('extractLocalPart', () => {
  test('returns the part before @', () => {
    expect(extractLocalPart('user@example.com')).toBe('user');
    expect(extractLocalPart('info@domain.co.uk')).toBe('info');
  });

  test('returns the full string if no @ symbol is found', () => {
    expect(extractLocalPart('noatsign')).toBe('noatsign');
  });

  test('uses only the first @ for addresses with multiple @ signs', () => {
    // Edge case — not a valid email, but should not throw
    expect(extractLocalPart('a@b@c')).toBe('a');
  });
});

describe('protected sender domains', () => {
  test('extracts a lowercase domain from a formatted sender', () => {
    expect(extractEmailDomain('Bank <Alerts@Envio.Santander.com.mx>')).toBe('envio.santander.com.mx');
  });

  test('protects subdomains of a configured financial domain', () => {
    expect(isProtectedSenderEmail(
      'alerts@envio.santander.com.mx',
      ['santander.com.mx']
    )).toBe(true);
  });

  test('does not protect a lookalike suffix domain', () => {
    expect(isProtectedSenderEmail(
      'offers@fakesantander.com.mx',
      ['santander.com.mx']
    )).toBe(false);
  });
});

describe('protected automation subjects', () => {
  const phrases = [
    'codigo de verificacion',
    'codigo de un solo uso',
    'estado de cuenta',
    'two-factor authentication',
  ];

  test('matches case and accent-insensitively', () => {
    expect(isProtectedAutomationSubject('Tu CÓDIGO de verificación', phrases)).toBe(true);
  });

  test('protects financial and security notifications', () => {
    expect(isProtectedAutomationSubject('Ya está disponible tu estado de cuenta', phrases)).toBe(true);
    expect(isProtectedAutomationSubject('Enabling two-factor authentication (2FA)', phrases)).toBe(true);
    expect(isProtectedAutomationSubject('Este es tu código de un solo uso', phrases)).toBe(true);
  });

  test('does not protect an unrelated promotion', () => {
    expect(isProtectedAutomationSubject('Mid-Season Sale is ending soon', phrases)).toBe(false);
  });
});

describe('financial subject subcategories', () => {
  const subcategories = [
    { name: 'Seguridad', phrases: ['codigo', 'verificacion', 'no reconoces'] },
    { name: 'Hipoteca', phrases: ['hipoteca', 'credito hipotecario'] },
    { name: 'Estados de cuenta', phrases: ['estado de cuenta'] },
    { name: 'Pagos y vencimientos', phrases: ['fecha limite', 'pago minimo'] },
    { name: 'Transacciones', phrases: ['transferencia', 'compra', 'cargo'] },
    { name: 'Otros', fallback: true },
  ];

  test('gives security precedence over purchase language', () => {
    expect(classifyFinancialSubject(
      '8037 es tu código de verificación de compra',
      subcategories
    )).toBe('Seguridad');
  });

  test('gives mortgage precedence over generic payment language', () => {
    expect(classifyFinancialSubject(
      'Confirmación de pago de tu crédito hipotecario',
      subcategories
    )).toBe('Hipoteca');
  });

  test.each([
    ['Tu estado de cuenta ya está disponible', 'Estados de cuenta'],
    ['Tu fecha límite de pago se acerca', 'Pagos y vencimientos'],
    ['Transferencia exitosa', 'Transacciones'],
    ['Información general para clientes', 'Otros'],
  ])('classifies "%s" as %s', (subject, expected) => {
    expect(classifyFinancialSubject(subject, subcategories)).toBe(expected);
  });
});

// =============================================================================
// pad
// =============================================================================

describe('pad', () => {
  test('total line length is 2 (indent) + width (default 48)', () => {
    const result = pad('Label', 42);
    expect(result.length).toBe(2 + 48);
  });

  test('respects custom width', () => {
    const result = pad('X', 'Y', 20);
    expect(result.length).toBe(2 + 20);
  });

  test('output starts with two spaces', () => {
    expect(pad('A', 'B').startsWith('  ')).toBe(true);
  });

  test('ends with the stringified value', () => {
    expect(pad('Label', 99).endsWith('99')).toBe(true);
    expect(pad('Label', 'hello').endsWith('hello')).toBe(true);
  });

  test('uses at least one dot even when label + value fills the width', () => {
    // 'AB' (2 chars) + value 'CD' (2 chars) + 1 dot = 5, in width 4: dots = max(1, 0) = 1
    const result = pad('AB', 'CD', 4);
    expect(result).toBe('  AB·CD');
  });
});

// =============================================================================
// getDateString
// =============================================================================

describe('getDateString', () => {
  test('formats a mid-year date as YYYYMMDD', () => {
    expect(getDateString(new Date(2024, 5, 7))).toBe('20240607'); // June 7
  });

  test('zero-pads single-digit month', () => {
    expect(getDateString(new Date(2023, 0, 15))).toBe('20230115'); // Jan
  });

  test('zero-pads single-digit day', () => {
    expect(getDateString(new Date(2024, 8, 9))).toBe('20240909'); // Sep 9
  });

  test('handles year-end boundary', () => {
    expect(getDateString(new Date(2024, 11, 31))).toBe('20241231'); // Dec 31
  });

  test('handles year-start boundary', () => {
    expect(getDateString(new Date(2025, 0, 1))).toBe('20250101'); // Jan 1
  });
});

// =============================================================================
// getYearString
// =============================================================================

describe('getYearString', () => {
  test('returns a 4-digit string', () => {
    expect(getYearString(new Date(2024, 5, 7))).toBe('2024');
    expect(getYearString(new Date(1999, 11, 31))).toBe('1999');
  });

  test('return type is string, not number', () => {
    expect(typeof getYearString(new Date(2024, 0, 1))).toBe('string');
  });
});

// =============================================================================
// formatDateForQuery
// =============================================================================

describe('formatDateForQuery', () => {
  test('formats as YYYY/MM/DD', () => {
    expect(formatDateForQuery(new Date(2024, 5, 7))).toBe('2024/06/07');
  });

  test('zero-pads month and day', () => {
    expect(formatDateForQuery(new Date(2023, 0, 1))).toBe('2023/01/01');
    expect(formatDateForQuery(new Date(2024, 8, 9))).toBe('2024/09/09');
  });

  test('year-end boundary', () => {
    expect(formatDateForQuery(new Date(2024, 11, 31))).toBe('2024/12/31');
  });
});

// =============================================================================
// computeThresholdDate
// =============================================================================

describe('computeThresholdDate', () => {
  test('returns a Date instance', () => {
    expect(computeThresholdDate(3)).toBeInstanceOf(Date);
  });

  test('result is in the past', () => {
    expect(computeThresholdDate(1).getTime()).toBeLessThan(Date.now());
  });

  test('3-month threshold is approximately 88-95 days ago', () => {
    const threshold = computeThresholdDate(3);
    const diffDays  = (Date.now() - threshold.getTime()) / (1000 * 60 * 60 * 24);
    // Month lengths vary (28-31 days), so allow a generous window
    expect(diffDays).toBeGreaterThan(85);
    expect(diffDays).toBeLessThan(97);
  });

  test('6-month threshold is further in the past than 3-month threshold', () => {
    expect(computeThresholdDate(6).getTime()).toBeLessThan(computeThresholdDate(3).getTime());
  });

  test('0-month threshold is approximately now', () => {
    const threshold = computeThresholdDate(0);
    const diffMs    = Math.abs(Date.now() - threshold.getTime());
    expect(diffMs).toBeLessThan(1000); // within 1 second of now
  });
});

// =============================================================================
// parseOldFilename
// =============================================================================

describe('parseOldFilename', () => {
  test('parses a valid old-format filename', () => {
    const result = parseOldFilename('20240607_info@example.com_document.pdf');
    expect(result).not.toBeNull();
    expect(result.dateStr).toBe('20240607');
    expect(result.senderEmail).toBe('info@example.com');
    expect(result.senderLocal).toBe('info');
    expect(result.restOfName).toBe('document.pdf');
  });

  test('restores dots in email addresses that had underscores substituted', () => {
    // Old script may have sanitized "first.last@x.com" to "first_last@x.com"
    // Note: the regex [^_]+ after @ assumes the domain itself didn't have dots replaced with underscores
    const result = parseOldFilename('20231201_first_last@x.com_file.docx');
    expect(result).not.toBeNull();
    expect(result.senderEmail).toBe('first.last@x.com'); // underscores → dots
  });

  test('returns null for a random filename with no date prefix', () => {
    expect(parseOldFilename('randomfile.pdf')).toBeNull();
  });

  test('returns null when no @ is present in the sender segment', () => {
    expect(parseOldFilename('20240607_nosender_file.pdf')).toBeNull();
  });

  test('returns null for a filename that is too short', () => {
    expect(parseOldFilename('2024_x@y_f')).toBeNull(); // date not 8 digits
  });

  test('handles a real-world compound filename', () => {
    const result = parseOldFilename('20230315_noreply@amazon.com_Invoice_2023-03-15.pdf');
    expect(result).not.toBeNull();
    expect(result.dateStr).toBe('20230315');
    expect(result.senderEmail).toBe('noreply@amazon.com');
    expect(result.restOfName).toBe('Invoice_2023-03-15.pdf');
  });
});


// =============================================================================
// getFriendlySenderName
// =============================================================================

describe('getFriendlySenderName', () => {
  beforeAll(() => {
    global.CONFIG = {
      SENDER_ALIASES: {
        '@uber.com': 'Uber',
        'no-reply@amazon.com': 'Amazon',
      }
    };
  });
  
  afterAll(() => {
    delete global.CONFIG;
  });

  test('returns alias for domain match', () => {
    expect(getFriendlySenderName('receipts@uber.com', 'Uber Receipts')).toBe('Uber');
  });

  test('returns alias for exact email match', () => {
    expect(getFriendlySenderName('no-reply@amazon.com', 'Amazon')).toBe('Amazon');
  });

  test('falls back to display name if no alias', () => {
    expect(getFriendlySenderName('info@unknown.com', 'Unknown Store')).toBe('Unknown Store');
  });

  test('falls back to capitalized domain name if no display name', () => {
    expect(getFriendlySenderName('info@unknown.com', '')).toBe('Unknown');
  });
});

// =============================================================================
// determineCategory
// =============================================================================

describe('determineCategory', () => {
  beforeAll(() => {
    global.CONFIG = {
      CATEGORIES: [
        { name: 'Facturas', keywords: ['factura', 'invoice'] },
        { name: 'Tickets', keywords: ['uber', 'vuelo'] },
      ],
      DEFAULT_CATEGORY: 'Otros'
    };
  });
  
  afterAll(() => {
    delete global.CONFIG;
  });

  test('matches subject keyword', () => {
    expect(determineCategory('Tu factura mensual', 'info@telcel.com', 'doc.pdf')).toBe('Facturas');
  });

  test('matches filename keyword', () => {
    expect(determineCategory('Documento', 'info@unknown.com', 'invoice_123.pdf')).toBe('Facturas');
  });

  test('matches sender email keyword', () => {
    expect(determineCategory('Recibo', 'receipts@uber.com', 'recibo.pdf')).toBe('Tickets');
  });

  test('returns default category if no match', () => {
    expect(determineCategory('Hola', 'amigo@test.com', 'foto.jpg')).toBe('Otros');
  });
});

describe('category keyword matching', () => {
  test('matches accented and unaccented text consistently', () => {
    expect(normalizeForMatching('Titulación')).toBe('titulacion');
    expect(containsCategoryKeyword(normalizeForMatching('Proceso de titulación'), 'titulacion')).toBe(true);
  });

  test('does not match a short code inside another word', () => {
    expect(containsCategoryKeyword(normalizeForMatching('Saturday sale'), 'sat')).toBe(false);
  });

  test('matches a short code as its own token', () => {
    expect(containsCategoryKeyword(normalizeForMatching('Constancia del SAT 2026'), 'sat')).toBe(true);
  });
});

// =============================================================================
// decideThreadAction — data-loss guard
// =============================================================================

describe('decideThreadAction', () => {
  const archiveDate = new Date('2026-05-01T00:00:00Z');
  const deleteDate = new Date('2026-02-01T00:00:00Z');

  function input(overrides) {
    return Object.assign({
      newestMessageDate: new Date('2026-03-01T00:00:00Z'),
      archiveDate,
      deleteDate,
      eligibleAttachments: 2,
      completedAttachments: 2,
      failedAttachments: 0,
      excludedMessages: 0,
      protectedThread: false,
    }, overrides);
  }

  test('keeps mixed/recent threads completely untouched', () => {
    expect(decideThreadAction(input({ newestMessageDate: archiveDate }))).toEqual({
      action: 'skip', reason: 'thread_has_recent_messages'
    });
  });

  test('routes excluded senders to review', () => {
    expect(decideThreadAction(input({ excludedMessages: 1 })).action).toBe('review');
  });

  test('never trashes a thread when one attachment failed', () => {
    expect(decideThreadAction(input({
      newestMessageDate: new Date('2025-01-01T00:00:00Z'),
      failedAttachments: 1,
      completedAttachments: 1,
    }))).toEqual({ action: 'review', reason: 'attachment_backup_failed' });
  });

  test('routes threads with no real attachments to review', () => {
    expect(decideThreadAction(input({
      eligibleAttachments: 0,
      completedAttachments: 0,
    })).reason).toBe('no_archivable_attachments');
  });

  test('detects an incomplete backup even without a thrown error', () => {
    expect(decideThreadAction(input({ completedAttachments: 1 }))).toEqual({
      action: 'review', reason: 'attachment_backup_incomplete'
    });
  });

  test('trashes an expired thread only after a complete verified backup', () => {
    expect(decideThreadAction(input({
      newestMessageDate: new Date('2025-01-01T00:00:00Z'),
    })).action).toBe('trash');
  });

  test('keeps a protected expired thread after archiving its attachments', () => {
    expect(decideThreadAction(input({
      newestMessageDate: new Date('2025-01-01T00:00:00Z'),
      protectedThread: true,
    }))).toEqual({ action: 'archive_keep', reason: 'protected_thread' });
  });
});

describe('decideInboxRuleAction', () => {
  test('allows a priority rule to keep and label a thread', () => {
    expect(decideInboxRuleAction({ lowValue: false, archive: false })).toEqual({
      action: 'label_only', reason: 'priority_rule'
    });
  });

  test('allows safe low-value mail to be archived', () => {
    expect(decideInboxRuleAction({
      lowValue: true,
      archive: true,
      hasRealAttachments: false,
      protectedThread: false,
      protectedSender: false,
      protectedContent: false,
    })).toEqual({ action: 'archive', reason: 'low_value_rule' });
  });

  test.each([
    ['real attachment', { hasRealAttachments: true }, 'real_attachment'],
    ['protected thread', { protectedThread: true }, 'protected_thread'],
    ['protected sender', { protectedSender: true }, 'protected_sender'],
    ['protected content', { protectedContent: true }, 'protected_content'],
  ])('blocks low-value archive for a %s', (_, override, reason) => {
    const input = Object.assign({
      lowValue: true,
      archive: true,
      hasRealAttachments: false,
      protectedThread: false,
      protectedSender: false,
      protectedContent: false,
    }, override);
    expect(decideInboxRuleAction(input)).toEqual({ action: 'label_only', reason });
  });

  test('archives a trusted record despite known record-content phrases', () => {
    expect(decideInboxRuleAction({
      record: true,
      lowValue: false,
      archive: true,
      hasRealAttachments: false,
      protectedThread: false,
      protectedSender: false,
      protectedContent: true,
      allowProtectedContentArchive: true,
    })).toEqual({ action: 'archive', reason: 'record_rule' });
  });

  test('still blocks a trusted record when it has a real attachment', () => {
    expect(decideInboxRuleAction({
      record: true,
      lowValue: false,
      archive: true,
      hasRealAttachments: true,
      protectedThread: false,
      protectedSender: false,
      protectedContent: true,
      allowProtectedContentArchive: true,
    })).toEqual({ action: 'label_only', reason: 'real_attachment' });
  });
});
