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
  pad,
  getDateString,
  getYearString,
  formatDateForQuery,
  computeThresholdDate,
  parseOldFilename,
  getFriendlySenderName,
  determineCategory,
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
