'use strict';

const configModule = require('../src/config.gs');
const utils = require('../src/utils.gs');

global.CONFIG = configModule.CONFIG;
global.classifyFinancialSubject = utils.classifyFinancialSubject;
global.normalizeForMatching = utils.normalizeForMatching;
global.expandFinancialSearchPhrases = configModule.expandFinancialSearchPhrases;

const existingLabels = new Set();
global.GmailApp = {
  getUserLabelByName: (name) => existingLabels.has(name) ? { getName: () => name } : null,
};

const {
  buildInboxRuleQuery,
  isInboxRuleArchiveEnabled,
  resolveInboxRuleLabelNames,
  financialMessageHasStatementDocument,
  financialThreadHasStatementEvidence,
  threadHasMessageInsideMinimumAge,
  buildInboxBacklogQuery,
  buildFinancialSublabelBackfillQuery,
  buildFinancialSublabelSearchQuery,
  buildFinancialSublabelSearchQueries,
  buildFinancialSublabelSubjectQuery,
} = require('../src/inbox-rules.gs');

describe('inbox rule queries', () => {
  beforeEach(() => existingLabels.clear());

  test('excludes institution mail already handled by the hourly classifier', () => {
    const rule = configModule.FINANCIAL_INBOX_RULES.find(
      (candidate) => candidate.name === 'Bank/Santander'
    );
    existingLabels.add(rule.label);

    const query = buildInboxRuleQuery(rule);

    expect(query).toContain('in:inbox');
    expect(query).toContain(`-label:"${rule.label}"`);
  });

  test('uses a rule-specific minimum age for trusted records', () => {
    const rule = configModule.CONFIG.INBOX_RULES.find(
      (candidate) => candidate.name === 'Finance/Records'
    );
    expect(buildInboxRuleQuery(rule)).toContain('older_than:14d');
  });

  test('labels gated record mail once during the sampling phase', () => {
    const rule = configModule.CONFIG.INBOX_RULES.find(
      (candidate) => candidate.name === 'Finance/Records'
    );
    existingLabels.add(rule.label);
    expect(buildInboxRuleQuery(rule)).toContain(`-label:"${rule.label}"`);
  });

  test('reconsiders labelled Inbox records when record archiving is enabled', () => {
    const rule = configModule.CONFIG.INBOX_RULES.find(
      (candidate) => candidate.name === 'Finance/Records'
    );
    existingLabels.add(rule.label);
    CONFIG.ENABLE_INBOX_RECORD_ARCHIVE = true;
    try {
      expect(buildInboxRuleQuery(rule)).not.toContain(`-label:"${rule.label}"`);
    } finally {
      CONFIG.ENABLE_INBOX_RECORD_ARCHIVE = false;
    }
  });

  test('keeps new record archives gated without pausing established low-value rules', () => {
    const financeRecords = configModule.CONFIG.INBOX_RULES.find(
      (candidate) => candidate.name === 'Finance/Records'
    );
    const promotions = configModule.CONFIG.INBOX_RULES.find(
      (candidate) => candidate.name === 'Promotions'
    );
    expect(isInboxRuleArchiveEnabled(financeRecords)).toBe(false);
    expect(isInboxRuleArchiveEnabled(promotions)).toBe(true);
  });
});

describe('financial child label resolution', () => {
  test('returns both parent and Santander statement child labels', () => {
    const rule = configModule.FINANCIAL_INBOX_RULES.find(
      (candidate) => candidate.name === 'Bank/Santander'
    );
    const messages = [{
      getSubject: () => 'Estado de Cuenta Santander Integral',
      getAttachments: () => [{
        getName: () => 'estado-de-cuenta.pdf',
        getContentType: () => 'application/pdf',
      }],
    }];

    expect(resolveInboxRuleLabelNames(rule, messages, false)).toEqual([
      'Auto/Finance/Santander',
      'Auto/Finance/Santander/Estados de cuenta',
    ]);
  });

  test('does not treat Santander consultation and paperless notices as statements', () => {
    const rule = configModule.FINANCIAL_INBOX_RULES.find(
      (candidate) => candidate.name === 'Bank/Santander'
    );
    expect(resolveInboxRuleLabelNames(rule, [{
      getSubject: () => 'Consulta de Estado de Cuenta de Tarjeta de Crédito',
    }], false)).toEqual([
      'Auto/Finance/Santander',
      'Auto/Finance/Santander/Seguridad',
    ]);
    expect(resolveInboxRuleLabelNames(rule, [{
      getSubject: () => 'Notificación Paperless',
    }], false)).toEqual([
      'Auto/Finance/Santander',
      'Auto/Finance/Santander/Avisos de servicio',
    ]);
    expect(resolveInboxRuleLabelNames(rule, [{
      getSubject: () => 'Estado de cuenta Santander - Reenvío de Indicaciones importantes',
      getPlainBody: () => 'Ya cuentas con tu contraseña para consultar tus estados de cuenta.',
    }], false)).toEqual([
      'Auto/Finance/Santander',
      'Auto/Finance/Santander/Avisos de servicio',
    ]);
  });

  test('accepts an explicit app-access notice without an attachment', () => {
    const rule = configModule.FINANCIAL_INBOX_RULES.find(
      (candidate) => candidate.name === 'Bank/Openbank'
    );
    const messages = [{
      getSubject: () => 'Estado de Cuenta',
      getPlainBody: () =>
        'Tu Estado de Cuenta ya está disponible en la sección de documentos de tu App Openbank.',
    }];
    expect(resolveInboxRuleLabelNames(rule, messages, false)).toEqual([
      'Auto/Finance/Openbank',
      'Auto/Finance/Openbank/Estados de cuenta',
    ]);
  });

  test.each([
    [
      'PayPal',
      'Tu estado de cuenta de julio está listo para consultarse',
      'Ya tenemos tu estado de cuenta de este mes. Ver en línea.',
    ],
    [
      'Nu',
      'Ya está disponible el estado de cuenta de tu tarjeta de crédito Nu',
      'El estado de cuenta de tu tarjeta de crédito Nu ya está disponible.',
    ],
    [
      'Hey Banco',
      'Estado de Cuenta [07/2026]',
      'Te enviamos el Estado de Cuenta digital. Para acceder deberás ingresar.',
    ],
    [
      'GBM',
      'Estado de Cuenta',
      'Tu estado de cuenta del mes ya está disponible. Descárgalo aquí.',
    ],
  ])('keeps %s link-delivered statements', (bank, subject, body) => {
    const rule = configModule.FINANCIAL_INBOX_RULES.find(
      (candidate) => candidate.name === `Bank/${bank}`
    );
    expect(resolveInboxRuleLabelNames(rule, [{
      getSubject: () => subject,
      getPlainBody: () => body,
    }], false)).toContain(`${rule.label}/Estados de cuenta`);
  });

  test('rejects educational statement mentions without a document or access notice', () => {
    const statements = configModule.FINANCIAL_SUBLABELS.find(
      (subcategory) => subcategory.name === 'Estados de cuenta'
    );
    const message = {
      getSubject: () => '¡Nuevo diseño de tu Estado de Cuenta!',
      getPlainBody: () => 'Te compartimos esta próxima actualización de diseño.',
      getAttachments: () => [],
    };
    expect(financialMessageHasStatementDocument(message)).toBe(false);
    expect(financialThreadHasStatementEvidence([message], statements)).toBe(false);
  });

  test('rejects a Banamex how-to even when its body mentions downloading the app', () => {
    const statements = configModule.FINANCIAL_SUBLABELS.find(
      (subcategory) => subcategory.name === 'Estados de cuenta'
    );
    const message = {
      getSubject: () => 'Consulta tu Estado de Cuenta desde BancaNet',
      getPlainBody: () => 'Descarga nuestra app para realizar tus operaciones.',
      getAttachments: () => [],
    };
    expect(financialThreadHasStatementEvidence([message], statements)).toBe(false);
  });

  test('routes a protected record to the manual review label', () => {
    expect(resolveInboxRuleLabelNames(
      { label: 'Auto/Finance/Records' },
      [],
      true
    )).toEqual(['Cleanup_Review/Protected']);
  });
});

describe('age and backlog safeguards', () => {
  beforeEach(() => existingLabels.clear());

  test('detects a message inside the protected age window', () => {
    const recent = { getDate: () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) };
    const old = { getDate: () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    expect(threadHasMessageInsideMinimumAge([old, recent], 14)).toBe(true);
    expect(threadHasMessageInsideMinimumAge([old], 14)).toBe(false);
  });

  test('skips a source-label policy until that label exists', () => {
    const policy = {
      label: 'Cleanup_Review/Backlog/Receipts',
      requiredSourceLabel: 'Auto/Documents/Receipts',
      query: 'in:inbox older_than:30d',
    };
    expect(buildInboxBacklogQuery(policy)).toBe('');

    existingLabels.add(policy.requiredSourceLabel);
    expect(buildInboxBacklogQuery(policy)).toContain(
      'label:"Auto/Documents/Receipts"'
    );
  });

  test('financial history query excludes child labels already applied', () => {
    const rule = configModule.FINANCIAL_INBOX_RULES[0];
    existingLabels.add(`${rule.label}/Transacciones`);
    expect(buildFinancialSublabelBackfillQuery(rule)).toContain(
      `-label:"${rule.label}/Transacciones"`
    );
  });

  test('financial backfill uses Gmail subject queries instead of reading every thread', () => {
    const rule = configModule.FINANCIAL_INBOX_RULES[0];
    const statements = configModule.FINANCIAL_SUBLABELS.find(
      (subcategory) => subcategory.name === 'Estados de cuenta'
    );
    const query = buildFinancialSublabelSearchQuery(rule, statements);
    expect(query).toContain('subject:"estado de cuenta"');
    expect(query).toContain(rule.query);
  });

  test('financial fallback query accepts all remaining institution mail', () => {
    const rule = configModule.FINANCIAL_INBOX_RULES[0];
    const fallback = configModule.FINANCIAL_SUBLABELS.find(
      (subcategory) => subcategory.fallback
    );
    expect(buildFinancialSublabelSearchQuery(rule, fallback)).toBe(
      buildFinancialSublabelBackfillQuery(rule)
    );
  });

  test('builds an OR subject query for targeted financial repairs', () => {
    const promotions = configModule.FINANCIAL_SUBLABELS.find(
      (subcategory) => subcategory.name === 'Promociones y beneficios'
    );
    expect(buildFinancialSublabelSubjectQuery(promotions)).toContain(
      'subject:"cashback"'
    );
    expect(buildFinancialSublabelSubjectQuery(promotions)).toContain(
      'subject:"promoción"'
    );
  });

  test('chunks long historical finance queries below the subject-term limit', () => {
    const security = configModule.FINANCIAL_SUBLABELS.find(
      (subcategory) => subcategory.name === 'Seguridad'
    );
    const queries = buildFinancialSublabelSearchQueries(
      configModule.FINANCIAL_INBOX_RULES[0],
      security
    );
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.every((query) => query.includes(configModule.FINANCIAL_INBOX_RULES[0].query)))
      .toBe(true);
  });
});
