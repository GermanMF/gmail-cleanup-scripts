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
  buildHistoricalInboxBackfillQuery,
  buildHistoricalInboxBackfillSafeShapeQuery,
  getOrCreateHistoricalReviewLabel,
  selectHistoricalInboxBackfillPolicy,
  isHistoricalInboxBackfillSelectionAllowed,
  shouldRemoveHistoricalInboxBackfillSchedule,
  buildHistoricalStagingLabelRepairQuery,
  isHistoricalConversationSubjectProtected,
  isHistoricalSocialSubjectProtected,
  shouldRouteHistoricalThreadToProtectedLabel,
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

  test('keeps historical Promotions, Social, and Updates in a separate backfill lane', () => {
    const policies = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES;
    expect(policies.find((policy) => policy.name === 'Promotions').archive).toBe(true);
    expect(policies.find((policy) => policy.name === 'Social').archive).toBe(false);
    expect(policies.filter((policy) => policy.name.startsWith('Updates/')).length).toBeGreaterThan(6);
    expect(CONFIG.HISTORICAL_INBOX_BACKFILL_CONFIRMATION).toBe('');
    expect(CONFIG.HISTORICAL_INBOX_BACKFILL_ACTIVE_POLICY_NAME).toBe('');
    expect(CONFIG.HISTORICAL_INBOX_BACKFILL_LABEL_REPAIR_CONFIRMATION).toBe('');
    expect(CONFIG.HISTORICAL_INBOX_BACKFILL_ARCHIVE_PROMOTIONS).toBe(false);
    expect(CONFIG.HISTORICAL_INBOX_BACKFILL_INTERVAL_MINUTES).toBe(10);
    expect(CONFIG.HISTORICAL_INBOX_BACKFILL_BATCH_SIZE).toBeLessThanOrEqual(25);
  });

  test('makes the historical cursor idempotent with its review label', () => {
    const promotions = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES.find(
      (policy) => policy.name === 'Promotions'
    );
    const pending = buildHistoricalInboxBackfillQuery(promotions, false);
    const audit = buildHistoricalInboxBackfillQuery(promotions, true);
    expect(pending).toContain('category:promotions');
    expect(pending).toContain(`-label:"${promotions.label}"`);
    expect(audit).not.toContain(`-label:"${promotions.label}"`);
    const safeShape = buildHistoricalInboxBackfillSafeShapeQuery(promotions);
    expect(safeShape).toContain('-has:attachment');
    expect(safeShape).toContain('-is:starred');
    expect(safeShape).toContain('-is:important');
    expect(pending).toContain(
      `-label:"${CONFIG.HISTORICAL_INBOX_BACKFILL_PROTECTED_LABEL}"`
    );
  });

  test('creates the historical review parents before the leaf label', () => {
    const originalGetOrCreateLabel = global.getOrCreateLabel;
    const calls = [];
    global.getOrCreateLabel = (name) => {
      calls.push(name);
      return { getName: () => name };
    };
    try {
      expect(getOrCreateHistoricalReviewLabel('Cleanup_Review/Historical/Promotions').getName())
        .toBe('Cleanup_Review/Historical/Promotions');
      expect(calls).toEqual([
        'Cleanup_Review',
        'Cleanup_Review/Historical',
        'Cleanup_Review/Historical/Promotions',
      ]);
    } finally {
      global.getOrCreateLabel = originalGetOrCreateLabel;
    }
  });

  test('pins a manual historical batch to its explicitly approved policy', () => {
    const policies = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES;
    const selection = selectHistoricalInboxBackfillPolicy(
      policies,
      { policyIndex: 1 },
      'Promotions'
    );
    expect(selection.policy.name).toBe('Promotions');
    expect(selection.policyIndex).toBe(0);
    expect(selection.pinned).toBe(true);
  });

  test('rejects an unknown manually selected historical policy', () => {
    const selection = selectHistoricalInboxBackfillPolicy(
      CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES,
      { policyIndex: 0 },
      'Not an approved policy'
    );
    expect(selection.policy).toBeNull();
    expect(selection.pinned).toBe(true);
  });

  test('requires a pin for manual batches and permits an unpinned scheduler cursor', () => {
    const policies = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES;
    const unpinned = selectHistoricalInboxBackfillPolicy(
      policies,
      { policyIndex: 1 },
      ''
    );
    const pinned = selectHistoricalInboxBackfillPolicy(
      policies,
      { policyIndex: 1 },
      'Promotions'
    );
    expect(isHistoricalInboxBackfillSelectionAllowed(unpinned, false)).toBe(false);
    expect(isHistoricalInboxBackfillSelectionAllowed(unpinned, true)).toBe(true);
    expect(isHistoricalInboxBackfillSelectionAllowed(pinned, false)).toBe(true);
  });

  test('never auto-removes the historical trigger during DRY_RUN', () => {
    const complete = { skipped: false, empty: true, errors: 0 };
    expect(shouldRemoveHistoricalInboxBackfillSchedule(complete, true)).toBe(false);
    expect(shouldRemoveHistoricalInboxBackfillSchedule(complete, false)).toBe(true);
    expect(shouldRemoveHistoricalInboxBackfillSchedule({ ...complete, errors: 1 }, false))
      .toBe(false);
  });

  test('leaves categorized Updates out of the Unclassified fallback', () => {
    const unclassified = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES.find(
      (policy) => policy.name === 'Updates/Unclassified'
    );
    const security = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES.find(
      (policy) => policy.name === 'Updates/Security'
    );
    expect(buildHistoricalInboxBackfillQuery(unclassified, false)).toContain(
      `-label:"${security.label}"`
    );
  });

  test('protects personal, recruiter, connection, and reply-shaped Social subjects', () => {
    expect(isHistoricalSocialSubjectProtected([
      { getSubject: () => 'New connection request from a recruiter' },
    ])).toBe(true);
    expect(isHistoricalSocialSubjectProtected([
      { getSubject: () => 'I’m still waiting for your response' },
    ])).toBe(true);
    expect(isHistoricalSocialSubjectProtected([
      { getSubject: () => 'Weekly community digest' },
    ])).toBe(false);
  });

  test('protects recruiter, invitation, connection, and reply signals in Promotions too', () => {
    const promotions = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES.find(
      (policy) => policy.name === 'Promotions'
    );
    const social = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES.find(
      (policy) => policy.name === 'Social'
    );
    const updates = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES.find(
      (policy) => policy.name === 'Updates/Digests'
    );
    const exclusion = 'personal_recruiter_invitation_or_reply_signal';
    expect(promotions.protectConversationSignals).toBe(true);
    expect(social.protectConversationSignals).toBe(true);
    expect(isHistoricalConversationSubjectProtected([
      { getSubject: () => 'Invitation: connect with your recruiter' },
    ])).toBe(true);
    expect(shouldRouteHistoricalThreadToProtectedLabel(promotions, exclusion)).toBe(true);
    expect(shouldRouteHistoricalThreadToProtectedLabel(social, exclusion)).toBe(true);
    expect(shouldRouteHistoricalThreadToProtectedLabel(updates, exclusion)).toBe(false);
    expect(shouldRouteHistoricalThreadToProtectedLabel(promotions, 'real_attachment')).toBe(true);
  });

  test('detects a recruiter signal in the sender as well as the subject', () => {
    expect(isHistoricalConversationSubjectProtected([{
      getSubject: () => 'A quick note for you',
      getFrom: () => 'Senior Recruiter <person@example.test>',
    }])).toBe(true);
    expect(isHistoricalConversationSubjectProtected([{
      getSubject: () => 'A quick note for you',
      getFrom: () => 'Recruitment Team <no-reply@example.test>',
    }])).toBe(true);
  });

  test('does not treat an ordinary no-reply sender as a response signal', () => {
    expect(isHistoricalConversationSubjectProtected([{
      getSubject: () => 'Weekly community digest',
      getFrom: () => 'Newsletter <no-reply@example.test>',
    }])).toBe(false);
  });

  test.each([
    ['Alex invited you to join their network'],
    ['A recruiter wants to connect'],
    ['You have a new connection'],
    ['Taylor replied to your message'],
    ['Morgan sent you a message'],
    ['Tienes un nuevo mensaje'],
    ['Te invitaron a conectar'],
    ['El reclutador respondió'],
  ])('protects common historical conversation variant: %s', (subject) => {
    expect(isHistoricalConversationSubjectProtected([{
      getSubject: () => subject,
      getFrom: () => 'Notifications <no-reply@example.test>',
    }])).toBe(true);
  });

  test('builds a label-only repair query for staged conversation signals', () => {
    const social = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES.find(
      (policy) => policy.name === 'Social'
    );
    expect(buildHistoricalStagingLabelRepairQuery(social)).toBe(
      `label:"${social.label}" -in:spam -in:trash`
    );
  });

  test('keeps dynamic Uber matching inside the historical lane and sender scoped', () => {
    const uber = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES.find(
      (policy) => policy.name === 'Updates/Uber records'
    );
    const generic = CONFIG.INBOX_RULES.find((rule) => rule.name === 'Orders/Records');
    expect(uber.query).toContain('from:uber.com');
    expect(uber.query).toContain('subject:"your uber receipt"');
    expect(uber.query).toContain('subject:"your uber trip"');
    expect(CONFIG.INBOX_RULES.some((rule) => rule.name === 'Orders/Uber Records')).toBe(false);
    expect(generic.query).not.toContain('subject:"your uber trip"');
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
