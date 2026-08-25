'use strict';

const {
  CONFIG,
  FINANCIAL_INSTITUTIONS,
  FINANCIAL_SUBLABELS,
  FINANCIAL_INBOX_RULES,
  expandFinancialSearchPhrases,
} = require('../src/config.gs');
const { classifyFinancialSubject } = require('../src/utils.gs');

describe('financial institution configuration', () => {
  test('covers every configured institution with one efficient classifier rule', () => {
    expect(FINANCIAL_INBOX_RULES).toHaveLength(FINANCIAL_INSTITUTIONS.length);
    expect(FINANCIAL_INBOX_RULES.length).toBeGreaterThanOrEqual(12);
    expect(FINANCIAL_INBOX_RULES.every((rule) => rule.continueProcessing)).toBe(true);
    expect(FINANCIAL_INBOX_RULES.every((rule) =>
      rule.sublabels.map((subcategory) => subcategory.name).sort().join('|') ===
      FINANCIAL_SUBLABELS.map((subcategory) => subcategory.name).sort().join('|')
    )).toBe(true);
  });

  test('includes Santander and Openbank', () => {
    expect(FINANCIAL_INSTITUTIONS.map((institution) => institution.name)).toEqual(
      expect.arrayContaining(['Santander', 'Openbank'])
    );
  });

  test('provides the requested Santander hierarchy', () => {
    const santanderRule = FINANCIAL_INBOX_RULES.find((rule) => rule.name === 'Bank/Santander');
    expect(santanderRule.label).toBe('Auto/Finance/Santander');
    expect(santanderRule.sublabels.map((subcategory) => subcategory.name)).toEqual(
      expect.arrayContaining([
        'Estados de cuenta',
        'Transacciones',
        'Hipoteca',
        'Créditos',
        'Promociones y beneficios',
        'Avisos de servicio',
      ])
    );
  });

  test('orders safety-sensitive financial labels before broad transactions', () => {
    const names = FINANCIAL_SUBLABELS.map((subcategory) => subcategory.name);
    expect(names.indexOf('Seguridad')).toBeLessThan(names.indexOf('Transacciones'));
    expect(names.indexOf('Seguridad')).toBeLessThan(names.indexOf('Promociones y beneficios'));
    expect(names.indexOf('Hipoteca')).toBeLessThan(names.indexOf('Pagos y vencimientos'));
  });

  test.each([
    ['Estado de Cuenta Santander Integral', 'Estados de cuenta'],
    ['Transferencia exitosa', 'Transacciones'],
    ['Retiro/Compra con Cuenta', 'Transacciones'],
    ['Pago de tu crédito hipotecario', 'Hipoteca'],
    ['Código de verificación de compra', 'Seguridad'],
    ['Notificación Paperless', 'Avisos de servicio'],
    ['Consulta de Estado de Cuenta de Tarjeta de Crédito', 'Seguridad'],
    ['Confirmamos tu autorización de operación', 'Transacciones'],
    ['Autorización de operación que supera el monto límite', 'Seguridad'],
    ['Agregó otra forma de iniciar sesión en PayPal', 'Seguridad'],
    ['No pierdas tus $1,000 de cashback', 'Promociones y beneficios'],
    ['Aviso de mantenimiento', 'Avisos de servicio'],
    ['Tu Crédito Personal Hey por $122,000 te espera', 'Créditos'],
  ])('classifies a real-world finance subject "%s" as %s', (subject, expected) => {
    expect(classifyFinancialSubject(subject, FINANCIAL_SUBLABELS)).toBe(expected);
  });

  test.each([
    ['Cada transacción es una anotación.', 'Promociones y beneficios'],
    ['Un año de gasolina gratis', 'Promociones y beneficios'],
    ['Aquí está tu siguiente paso como inversionista', 'Inversiones'],
    ['Que tus ahorros no dejen de ganar: pásalos a reserva a plazo', 'Inversiones'],
  ])('uses Ualá-specific language for "%s"', (subject, expected) => {
    const ualaRule = FINANCIAL_INBOX_RULES.find((rule) => rule.name === 'Bank/Uala');
    expect(classifyFinancialSubject(subject, ualaRule.sublabels)).toBe(expected);
  });

  test('expands historical Gmail searches with accented Spanish variants', () => {
    expect(expandFinancialSearchPhrases([
      'autorizacion de operacion que supera el monto limite',
    ])).toContain('autorización de operación que supera el monto límite');
  });
});

describe('mailbox safety configuration', () => {
  test('keeps destructive retention disabled', () => {
    expect(CONFIG.ENABLE_RULE_RETENTION_TRASH).toBe(false);
    expect(CONFIG.ENABLE_INBOX_RECORD_ARCHIVE).toBe(false);
  });

  test('requires an explicit token before reversible backlog staging', () => {
    expect(CONFIG.INBOX_BACKLOG_CONFIRMATION).toBe('');
    expect(CONFIG.INBOX_BACKLOG_POLICIES.length).toBeGreaterThan(0);
  });

  test('replaces the catch-all actionable rule with explicit action and routine lanes', () => {
    const names = CONFIG.INBOX_RULES.map((rule) => rule.name);
    expect(names).toContain('Updates/ActionRequired');
    expect(names).toContain('Updates/Routine');
    expect(names).toContain('Developer/Security');
    expect(names).toContain('Developer/Failures');
    expect(names).not.toContain('Updates/Actionable');
  });
});
