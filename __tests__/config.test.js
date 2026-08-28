'use strict';

const {
  CONFIG,
  FINANCIAL_INSTITUTIONS,
  FINANCIAL_LABEL_MIGRATIONS,
  FINANCIAL_INSTITUTION_REHOMES,
  FINANCIAL_RETIRED_INSTITUTIONS,
  FINANCIAL_SUBLABELS,
  FINANCIAL_INBOX_RULES,
  expandFinancialSearchPhrases,
} = require('../src/config.gs');
const { classifyFinancialSubject } = require('../src/utils.gs');

describe('financial institution configuration', () => {
  test('covers every configured institution with one efficient classifier rule', () => {
    expect(FINANCIAL_INBOX_RULES).toHaveLength(FINANCIAL_INSTITUTIONS.length);
    expect(FINANCIAL_INBOX_RULES).toHaveLength(12);
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

  test('separates Afore and Infonavit into dedicated finance parents', () => {
    const names = FINANCIAL_INSTITUTIONS.map((institution) => institution.name);
    const afore = FINANCIAL_INSTITUTIONS.find((institution) => institution.name === 'Afore');
    const infonavit = FINANCIAL_INSTITUTIONS.find(
      (institution) => institution.name === 'Infonavit'
    );
    const banamex = FINANCIAL_INSTITUTIONS.find(
      (institution) => institution.name === 'Banamex'
    );

    expect(names).toEqual(expect.arrayContaining(['Afore', 'Infonavit']));
    expect(names.indexOf('Afore')).toBeLessThan(names.indexOf('Banamex'));
    expect(afore.query).toContain('from:appsar-noreply@aforemovil.com');
    expect(infonavit.query).toContain('from:infonavit.org.mx');
    expect(banamex.query).toContain('-from:aforebanamex@banamex.com');
    expect(FINANCIAL_INSTITUTION_REHOMES).toEqual([
      expect.objectContaining({ source: 'Banamex', target: 'Afore' }),
      expect.objectContaining({ source: '', target: 'Infonavit' }),
    ]);
  });

  test('consolidates GBM-origin mail into Mercado Pago and removes BBVA', () => {
    const names = FINANCIAL_INSTITUTIONS.map((institution) => institution.name);
    const mercadoPago = FINANCIAL_INSTITUTIONS.find(
      (institution) => institution.name === 'Mercado Pago'
    );

    expect(names).not.toContain('GBM');
    expect(names).not.toContain('BBVA');
    expect(mercadoPago.query).toContain('from:mercadopago.com.mx');
    expect(mercadoPago.query).toContain('from:mercadopago.com');
    expect(mercadoPago.query).toContain('from:gbm.com.mx');
    expect(FINANCIAL_LABEL_MIGRATIONS).toEqual([
      { source: 'GBM', target: 'Mercado Pago' },
    ]);
    expect(FINANCIAL_RETIRED_INSTITUTIONS).toEqual(['BBVA', 'GBM']);
  });

  test('covers the observed Ualá sender domains', () => {
    const uala = FINANCIAL_INSTITUTIONS.find((institution) => institution.name === 'Uala');
    expect(uala.query).toContain('from:uala.com.mx');
    expect(uala.query).toContain('from:uala.mx');
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

  test.each([
    ['Afore', 'Solicitud de Estados de Cuenta Afore', 'Estados de cuenta'],
    ['Afore', 'Envío de Clave de Acceso APP', 'Seguridad'],
    ['Afore', 'Te invitamos a nuestro próximo webinar', 'Promociones y beneficios'],
    ['Afore', 'Datos de Aportación voluntaria verificados', 'Inversiones'],
    ['Infonavit', 'Recuperación de contraseña de Mi Cuenta Infonavit', 'Seguridad'],
    ['Infonavit', 'Resumen de movimientos aportaciones vivienda', 'Transacciones'],
    ['Infonavit', 'Confirmación de cita', 'Avisos de servicio'],
  ])('uses %s-specific language for "%s"', (institution, subject, expected) => {
    const rule = FINANCIAL_INBOX_RULES.find(
      (candidate) => candidate.name === `Bank/${institution}`
    );
    expect(classifyFinancialSubject(subject, rule.sublabels)).toBe(expected);
  });

  test('expands historical Gmail searches with accented Spanish variants', () => {
    expect(expandFinancialSearchPhrases([
      'autorizacion de operacion que supera el monto limite',
    ])).toContain('autorización de operación que supera el monto límite');
  });
});

describe('mailbox safety configuration', () => {
  test('keeps destructive retention and document archive disabled by default', () => {
    expect(CONFIG.ENABLE_RULE_RETENTION_TRASH).toBe(false);
    expect(CONFIG.ENABLE_DOCUMENT_RECORD_ARCHIVE).toBe(false);
  });

  test('requires an explicit token before reversible backlog staging', () => {
    expect(CONFIG.INBOX_BACKLOG_CONFIRMATION).toBe('');
    expect(CONFIG.INBOX_BACKLOG_POLICIES.length).toBeGreaterThan(0);
  });

  test('leaves completed finance maintenance entry points confirmation-locked', () => {
    expect(CONFIG.FINANCIAL_SUBLABEL_BACKFILL_CONFIRMATION).toBe('');
    expect(CONFIG.FINANCIAL_LABEL_REPAIR_CONFIRMATION).toBe('');
    expect(CONFIG.FINANCIAL_TAXONOMY_MIGRATION_CONFIRMATION).toBe('');
    expect(CONFIG.FINANCIAL_INSTITUTION_REHOME_CONFIRMATION).toBe('');
    expect(CONFIG.FINANCIAL_VERIFIED_CORRECTIONS_CONFIRMATION).toBe('');
    expect(CONFIG.FINANCIAL_RETIRED_LABEL_DELETION_CONFIRMATION).toBe('');
  });

  test('uses explicit action rules without a catch-all Updates lane', () => {
    const names = CONFIG.INBOX_RULES.map((rule) => rule.name);
    expect(names).toContain('Updates/ActionRequired');
    expect(names).not.toContain('Updates/Routine');
    expect(names).toContain('Developer/Security');
    expect(names).toContain('Developer/Failures');
    expect(names).not.toContain('Updates/Actionable');
    expect(CONFIG.RULE_RETENTION_POLICIES).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Auto/LowValue/Routine Updates' }),
    ]));
    expect(CONFIG.INBOX_BACKLOG_POLICIES).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Cleanup_Review/Backlog/Routine Updates' }),
    ]));
  });
});
