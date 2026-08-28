/**
 * Configuration object for the Gmail Attachment Processor.
 * Modify these settings to adjust the script's behavior.
 */
const AFORE_FINANCIAL_QUERY = [
  '{',
  'from:aforebanamex@banamex.com',
  'from:tustramites.afore@banamex.com',
  'from:appsar-noreply@aforemovil.com',
  'subject:"Solicitud de Estados de Cuenta Afore"',
  '}',
].join(' ');

const INFONAVIT_FINANCIAL_QUERY = '{from:infonavit.org.mx from:infonavit.gob.mx}';

const FINANCIAL_INSTITUTIONS = [
  { name: 'Santander', query: '{from:santander.com.mx from:envio.santander.com.mx}' },
  { name: 'Afore', query: AFORE_FINANCIAL_QUERY },
  { name: 'Infonavit', query: INFONAVIT_FINANCIAL_QUERY },
  {
    name: 'Banamex',
    query: [
      '{from:banamex.com from:citibanamex.com}',
      '-from:aforebanamex@banamex.com',
      '-from:tustramites.afore@banamex.com',
      '-subject:"Solicitud de Estados de Cuenta Afore"',
    ].join(' '),
  },
  { name: 'Invex', query: 'from:invextarjetas.com.mx' },
  {
    name: 'Mercado Pago',
    query: '{from:mercadopago.com.mx from:mercadopago.com from:gbm.com.mx}',
  },
  { name: 'PayPal', query: 'from:paypal.com' },
  { name: 'Hey Banco', query: '{from:hey.inc from:heybanco.com}' },
  { name: 'Nu', query: '{from:nu.com.mx from:nubank.com.mx}' },
  { name: 'Revolut', query: 'from:revolut.com' },
  { name: 'Uala', query: '{from:uala.com.mx from:uala.mx from:abccapital.com.mx}' },
  { name: 'Openbank', query: 'from:openbank' },
];

const FINANCIAL_SENDER_QUERY = [
  '{',
  'from:santander.com.mx', 'from:envio.santander.com.mx',
  'from:aforemovil.com', 'from:infonavit.org.mx', 'from:infonavit.gob.mx',
  'from:banamex.com', 'from:citibanamex.com',
  'from:invextarjetas.com.mx',
  'from:mercadopago.com.mx', 'from:mercadopago.com', 'from:gbm.com.mx', 'from:paypal.com',
  'from:hey.inc', 'from:heybanco.com',
  'from:nu.com.mx', 'from:nubank.com.mx',
  'from:revolut.com', 'from:uala.com.mx', 'from:uala.mx', 'from:abccapital.com.mx',
  'from:openbank',
  '}',
].join(' ');

/** One-time, label-only consolidation of retired institution paths. */
const FINANCIAL_LABEL_MIGRATIONS = [
  { source: 'GBM', target: 'Mercado Pago' },
];

/** Query-scoped label-only moves for products split from broader institutions. */
const FINANCIAL_INSTITUTION_REHOMES = [
  {
    source: 'Banamex',
    target: 'Afore',
    query: AFORE_FINANCIAL_QUERY,
  },
  {
    source: '',
    target: 'Infonavit',
    query: INFONAVIT_FINANCIAL_QUERY,
  },
];

/** Labels removed from the active taxonomy and deletable only after they are empty. */
const FINANCIAL_RETIRED_INSTITUTIONS = ['BBVA', 'GBM'];

/**
 * Ordered financial sublabels. Security and mortgage phrases precede broader
 * transaction/payment language so the most meaningful child label wins.
 */
const FINANCIAL_SUBLABELS = [
  {
    name: 'Seguridad',
    phrases: [
      'codigo', 'code', 'verificacion', 'verification', 'inicio de sesion',
      'nuevo dispositivo', 'contrasena', 'password', 'no reconoces',
      'no reconocida', 'unrecognized', 'sospechosa', 'suspicious', 'fraude',
      'bloqueada', 'bloqueo', 'token', 'nip', 'llave de acceso', 'passkey',
      'forma de iniciar sesion', 'app predeterminada', 'codi activado',
      'alta un destinatario', 'nuevo destinatario',
      'autorizacion de operacion que supera el monto limite',
      'consulta realizada', 'consulta de estado de cuenta',
    ],
  },
  {
    name: 'Hipoteca',
    phrases: [
      'hipoteca', 'hipotecario', 'credito hipotecario', 'amortizacion',
      'mensualidad hipotecaria', 'pago de hipoteca',
    ],
  },
  {
    name: 'Créditos',
    phrases: [
      'credito personal', 'prestamo', 'financiamiento', 'credito automotriz',
      'credito disponible', 'linea de credito', 'credit offer',
    ],
  },
  {
    name: 'Estados de cuenta',
    requiresStatementEvidence: true,
    phrases: [
      'estado de cuenta', 'estados de cuenta', 'account statement',
      'estado de cuenta integral',
      'estado de cuenta electronico', 'corte mensual', 'resumen mensual',
    ],
  },
  {
    name: 'Inversiones',
    phrases: [
      'inversion', 'portafolio', 'fondo', 'dividendo', 'rendimiento',
      'compra de acciones', 'venta de acciones', 'trading', 'afore',
      'invierte', 'mercados', 'cuenta de inversion',
    ],
  },
  {
    name: 'Pagos y vencimientos',
    phrases: [
      'fecha limite', 'vencimiento', 'pago minimo', 'pago para no generar',
      'payment due', 'domiciliacion', 'pago', 'payment',
    ],
  },
  {
    name: 'Transacciones',
    phrases: [
      'transferencia', 'spei', 'deposito', 'retiro', 'compra', 'cargo',
      'transaccion', 'transaction', 'movimiento', 'abono',
      'autorizacion de operacion', 'confirmamos tu autorizacion',
      'comprobante de operacion', 'operacion en cajero', 'retiro de efectivo',
    ],
  },
  {
    name: 'Promociones y beneficios',
    phrases: [
      'promocion', 'bonificacion', 'cashback', 'descuento', 'preventa',
      'oferta', 'recompensa', 'invita a', 'participa', 'registrate',
      'ultimo dia', 'ganar', 'beneficio', 'meses sin intereses',
    ],
  },
  {
    name: 'Tarjetas',
    phrases: [
      'tarjeta', 'card', 'linea de credito', 'limite de credito',
      'activacion', 'activada', 'reemplazo',
    ],
  },
  {
    name: 'Avisos de servicio',
    phrases: [
      'aviso de mantenimiento', 'mantenimiento', 'intermitencia',
      'indisponibilidad', 'actualizacion de terminos',
      'terminos y condiciones', 'actualizacion de tu cuenta',
      'notificacion paperless', 'nuevo diseno de tu estado de cuenta',
      'actualizacion de estado de cuenta',
      'reenvio de indicaciones importantes',
    ],
  },
  { name: 'Otros', fallback: true },
];

/**
 * Bank-specific vocabulary keeps one shared label taxonomy while allowing a
 * bank's marketing language to take precedence over generic transaction words.
 */
const FINANCIAL_INSTITUTION_SUBLABEL_OVERRIDES = {
  Afore: {
    phrases: {
      Seguridad: ['clave de acceso'],
      Inversiones: [
        'ahorro voluntario', 'aportacion voluntaria', 'siefore',
        'ahorro para el retiro',
      ],
      'Promociones y beneficios': ['webinar', 'evento exclusivo'],
      'Avisos de servicio': [
        'bienvenido a aforemovil', 'modificacion de datos',
        'manten actualizado tu expediente', 'recibe asesoria personalizada',
        'app aforemovil',
      ],
    },
    removePhrases: {
      Inversiones: ['afore'],
    },
  },
  Infonavit: {
    phrases: {
      Seguridad: ['recuperacion de contrasena', 'cambio de contrasena'],
      Transacciones: ['resumen de movimientos aportaciones vivienda'],
      'Promociones y beneficios': ['aportaciones extraordinarias'],
      'Avisos de servicio': [
        'una sola app', 'correccion de rfc', 'confirmacion de cita',
        'confirmacion de registro',
      ],
    },
  },
  Uala: {
    phrases: {
      Inversiones: [
        'inversionista', 'reserva a plazo', 'paquete recomendado',
        'ahorros no dejen de ganar', 'ya puedes invertir',
        'la cuenta se ha creado',
      ],
      'Promociones y beneficios': [
        'un ano de gasolina', 'gasolina gratis', 'tarjetas de regalo',
        'cada transaccion es una anotacion', 'trae tu nomina',
        'maximiza tus ingresos', 'participa por',
      ],
    },
    promotionsBeforeTransactions: true,
  },
};

function buildFinancialSublabelsForInstitution(institutionName) {
  const override = FINANCIAL_INSTITUTION_SUBLABEL_OVERRIDES[institutionName];
  if (!override) return FINANCIAL_SUBLABELS;

  const sublabels = FINANCIAL_SUBLABELS.map(function (subcategory) {
    const extraPhrases = (override.phrases && override.phrases[subcategory.name]) || [];
    const removedPhrases =
      (override.removePhrases && override.removePhrases[subcategory.name]) || [];
    if (!extraPhrases.length && !removedPhrases.length) return subcategory;
    const removed = new Set(removedPhrases.map(function (phrase) {
      return String(phrase).toLowerCase();
    }));
    return Object.assign({}, subcategory, {
      phrases: extraPhrases.concat((subcategory.phrases || []).filter(function (phrase) {
        return !removed.has(String(phrase).toLowerCase());
      })),
    });
  });

  if (override.promotionsBeforeTransactions) {
    const promotionIndex = sublabels.findIndex(function (subcategory) {
      return subcategory.name === 'Promociones y beneficios';
    });
    const transactionIndex = sublabels.findIndex(function (subcategory) {
      return subcategory.name === 'Transacciones';
    });
    if (promotionIndex > transactionIndex && transactionIndex >= 0) {
      const promotion = sublabels.splice(promotionIndex, 1)[0];
      sublabels.splice(transactionIndex, 0, promotion);
    }
  }
  return sublabels;
}

const FINANCIAL_SEARCH_ACCENT_REPLACEMENTS = [
  ['codigo', 'código'],
  ['verificacion', 'verificación'],
  ['sesion', 'sesión'],
  ['contrasena', 'contraseña'],
  ['autorizacion', 'autorización'],
  ['operacion', 'operación'],
  ['limite', 'límite'],
  ['credito', 'crédito'],
  ['prestamo', 'préstamo'],
  ['linea', 'línea'],
  ['electronico', 'electrónico'],
  ['notificacion', 'notificación'],
  ['inversion', 'inversión'],
  ['transaccion', 'transacción'],
  ['promocion', 'promoción'],
  ['bonificacion', 'bonificación'],
  ['registrate', 'regístrate'],
  ['ultimo dia', 'último día'],
  ['activacion', 'activación'],
  ['actualizacion', 'actualización'],
  ['terminos', 'términos'],
  ['domiciliacion', 'domiciliación'],
  ['minimo', 'mínimo'],
  ['confirmacion', 'confirmación'],
  ['diseno', 'diseño'],
  ['nomina', 'nómina'],
  ['ano', 'año'],
  ['reenvio', 'reenvío'],
];

function expandFinancialSearchPhrases(phrases) {
  const expanded = [];
  phrases.forEach(function (phrase) {
    expanded.push(phrase);
    let accented = phrase;
    FINANCIAL_SEARCH_ACCENT_REPLACEMENTS.forEach(function (replacement) {
      accented = accented.split(replacement[0]).join(replacement[1]);
    });
    if (accented !== phrase) expanded.push(accented);
  });
  return Array.from(new Set(expanded));
}

function buildFinancialSubjectOrQuery(phrases) {
  return `{ ${expandFinancialSearchPhrases(phrases).map(function (phrase) {
    return `subject:"${phrase}"`;
  }).join(' ')} }`;
}

const FINANCIAL_ACTION_REQUIRED_PHRASES = [
  'bloqueada', 'rechazada', 'declinada', 'fallida', 'failed',
  'saldo negativo', 'negative balance', 'fecha limite', 'vencimiento',
  'pago pendiente', 'payment due', 'no reconoces', 'no reconocida',
  'unrecognized', 'sospechosa', 'suspicious', 'fraude', 'verification',
  'verificacion', 'codigo', 'code',
];
const FINANCIAL_ACTION_REQUIRED_QUERY = buildFinancialSubjectOrQuery(
  FINANCIAL_ACTION_REQUIRED_PHRASES
);

const FINANCIAL_RECORD_PHRASES = [
  'estado de cuenta', 'account statement', 'transferencia', 'spei',
  'deposito', 'retiro', 'compra', 'cargo', 'transaccion', 'transaction',
  'pago exitoso', 'confirmacion de pago', 'transferencia exitosa',
  'transferencia enviada',
];
const FINANCIAL_RECORD_QUERY = buildFinancialSubjectOrQuery(FINANCIAL_RECORD_PHRASES);

const FINANCIAL_INBOX_RULES = FINANCIAL_INSTITUTIONS.map(function (institution) {
  return {
    name: `Bank/${institution.name}`,
    label: `Auto/Finance/${institution.name}`,
    query: institution.query,
    sublabels: buildFinancialSublabelsForInstitution(institution.name),
    archive: false,
    markRead: false,
    markImportant: false,
    lowValue: false,
    continueProcessing: true,
    exclusiveGroup: 'financial-institution',
  };
});

const CONFIG = {
  /**
   * Base Gmail search query. The date window is applied automatically on top of this.
   * Emails newer than ARCHIVE_AFTER_MONTHS are always excluded.
   */
  SEARCH_QUERY: 'has:attachment -in:chats',
  /** Label applied to processed threads to prevent duplicate processing. */
  PROCESSED_LABEL: 'Processed_Drive',
  /** Label applied when a thread needs manual review instead of deletion. */
  REVIEW_LABEL: 'Cleanup_Review',
  /** Base Google Drive folder name for the archive root. */
  BASE_FOLDER_NAME: 'Gmail_Attachments_Archive',
  /**
   * Minimum size for a real attachment. Keep this at 0: legitimate PDFs can be
   * smaller than 10 KB. Inline images are excluded using Gmail's attachment API.
   */
  MIN_FILE_SIZE_BYTES: 0,
  /** Exclude MIME parts embedded in the HTML body (logos and signatures). */
  SKIP_INLINE_IMAGES: true,
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
  /** Never trash a thread containing a starred message. */
  PROTECT_STARRED_THREADS: true,
  /** Protect Gmail-important threads by default; disable only after reviewing that label. */
  PROTECT_IMPORTANT_THREADS: true,
  /** Never trash a conversation that contains a message sent by this account. */
  PROTECT_SENT_THREADS: true,
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
  /**
   * Sender aliases to clean up weird names or domain names.
   * Matches domain or exact email and replaces the sender name with the alias.
   * Keys can be exact email or @domain.
   */
  SENDER_ALIASES: {
    '@uber.com': 'Uber',
    '@didi.com': 'DiDi',
    '@netflix.com': 'Netflix',
    '@amazon.com': 'Amazon',
    '@amazon.com.mx': 'Amazon',
    '@mercadolibre.com': 'Mercado Libre',
    '@mercadolibre.com.mx': 'Mercado Libre',
    '@mercadopago.com.mx': 'Mercado Pago',
    '@telcel.com': 'Telcel',
    '@cfe.mx': 'CFE',
    '@cfecontigo.com.mx': 'CFE',
    '@banamex.com': 'Banamex',
    '@citibanamex.com': 'Citibanamex',
    '@notificaciones.afore.banamex.com': 'Citibanamex',
    '@santander.com.mx': 'Santander',
    '@infonavit.gob.mx': 'Infonavit',
    '@imss.gob.mx': 'IMSS',
    '@serviciosdigitales.imss.gob.mx': 'IMSS',
    '@sat.gob.mx': 'SAT',
    '@etn.com.mx': 'ETN',
    '@primeraplus.com.mx': 'Primera Plus',
    '@autovias.com.mx': 'Autovias',
    '@unicef.org': 'Unicef',
    '@recibosunicef.org': 'Unicef',
    '@axtel.com.mx': 'AXTEL',
    '@aeromexico.com': 'Aeromexico',
    '@volaris.com': 'Volaris',
    // ── Nuevos aliases detectados en auditoría 2026-06-13 ─────────────────
    '@aforemovil.com': 'Afore Móvil',
    '@aforeweb.com.mx': 'Afore Web',
    '@rappi.com': 'Rappi',
    '@allianz.com.mx': 'Allianz',
    '@virginiasurety.com': 'Samsung Care',
    '@dentalia.com': 'Dentalia',
    '@gbm.com.mx': 'Mercado Pago',
    '@condovive.com': 'CondoVive',
    '@invextarjetas.com.mx': 'Invex Tarjetas',
    '@santander.com.mx': 'Santander',
    '@notificaciones.santander.com.mx': 'Santander',
    '@envio.santander.com.mx': 'Santander',
    '@contactosanpablo.com.mx': 'San Pablo Farmacia',
    '@enviosmail.com': 'Lab Médico del Chopo',
    '@abccapital.com.mx': 'Ualá',
    '@monederodelahorro.com.mx': 'Monedero del Ahorro',
    '@bitcodes.co': 'Bitcodes',
    '@keys4us.com': 'Keys4Us',
    '@news.paypal.com': 'PayPal',
    '@nominalia.com': 'Nominalia',
    '@ikeasistencia.com': 'IKEA Asistencia',
    '@lacomer.com.mx': 'La Comer',
  },
  /**
   * Rules for intelligent filtering. Each category is checked in order — MOST
   * SPECIFIC FIRST to prevent a broad keyword swallowing a narrow one.
   *
   * A file/email matches a category if any keyword appears in the subject,
   * filename, OR sender domain/email (all case-insensitive).
   */
  CATEGORIES: [
    /**
     * AFORE / Retirement savings — checked before Hipoteca & Importantes
     * because both of those have 'infonavit'/'aviso' keywords that would
     * otherwise swallow afore documents.
     */
    {
      name: 'Afore',
      keywords: [
        'afore', 'sar', 'ahorro retiro', 'pension', 'cuenta individual',
        'estado de cuenta afore', 'localizaafore', 'consultatuafore',
        'aforemovil', 'appsar', 'portalsar',
      ],
    },
    /**
     * Mortgage — before Gobierno so 'infonavit' avalúo docs stay here.
     */
    {
      name: 'Hipoteca',
      keywords: [
        'hipoteca', 'mortgage', 'avaluo', 'credito infonavit', 'infonavit',
        'amortizacion', 'escritura',
      ],
    },
    /**
     * Government transactions & IDs — SAT, IMSS, SRE, gob.mx portals.
     * Checked before Facturas so government receipts ('pago', 'comprobante')
     * don't land in the invoice bucket.
     */
    {
      name: 'Gobierno',
      keywords: [
        'sat', 'imss', 'nss', 'numero de seguridad social',
        'buzon tributario', 'buzontributario', 'serviciosalcontribuyente',
        'contribuyente', 'gob.mx', 'sep', 'sre', 'pasaporte',
        'acta de nacimiento', 'cedula profesional', 'tramite gobierno',
        'gobierno de la ciudad', 'gobierno del estado',
        'serviciosdigitales', 'comprobante vigencia',
        'comprobante localizacion',
        // INDAUTOR / cultura.gob.mx (detected 2026-06-13)
        'indautor', 'cultura.gob', 'sindautor', 'derechos de autor',
        'registro indautor', 'acuse',
      ],
    },
    /**
     * Donations — before Facturas since donation receipts contain 'recibo'.
     */
    {
      name: 'Donaciones',
      keywords: [
        'unicef', 'donacion', 'donativos', 'donativo', 'recibos unicef',
        'donacionesmexico',
      ],
    },
    /**
     * Utility bills (CFE, internet, phone) — before Facturas so utility
     * PDFs ('fac*', 'recibo') stay in a dedicated bucket.
     */
    {
      name: 'Servicios',
      keywords: [
        'cfe', 'luz', 'recibo de luz',
        'axtel', 'servicioaclientes axtel', 'ftth',
        'telcel', 'facturacion telcel',
        'megacable', 'telmex', 'totalplay', 'izzi',
        'internet', 'telefonia', 'cable',
      ],
    },
    /**
     * Bank statements — before generic Facturas.
     */
    {
      name: 'Estados de Cuenta',
      keywords: [
        'estado de cuenta', 'account statement', 'edos',
        'resumen de movimientos', 'resumen movimientos',
        'tu estado de cuenta',
        // GBM-origin Mercado Pago statements + INVEX (detected 2026-06-13)
        'gbm', 'invex', 'tuestadodecuenta', 'estadosdecuenta',
        'smart statement',
      ],
    },
    /**
     * Invoices & fiscal receipts (CFDI).
     */
    {
      name: 'Facturas',
      keywords: [
        'factura', 'invoice', 'recibo', 'receipt', 'comprobante',
        'cfdi', 'xml', 'comprobante de compra', 'comprobante de pago',
        'comprobante fiscal', 'nota de venta',
      ],
    },
    /**
     * Transport — ride-hailing, buses, airlines, tolls.
     * Renamed from Tickets_Viajes; old folder name kept in migration compat.
     */
    {
      name: 'Transporte',
      keywords: [
        'uber', 'didi', 'bolt', 'taxify', 'cabify',
        'etn', 'primera plus', 'futura', 'chihuahuenses', 'odm',
        'autovias', 'peaje',
        'aeromexico', 'volaris', 'vivaaerobus', 'vuelo', 'aerolinea',
        'boleto', 'itinerary', 'itinerario', 'reservacion', 'reserva de viaje',
        'pase de abordar', 'boarding pass',
        'confirmacion de viaje', 'confirmaciondeviaje',
        'axa-assistance', 'viajasistencia',
      ],
    },
    /**
     * Cinema & entertainment.
     */
    {
      name: 'Entretenimiento',
      keywords: [
        'cine', 'cinepolis', 'cinemex', 'cineticket', 'pelicula',
        'concierto', 'evento', 'smart-ticket',
      ],
    },
    /**
     * Employment & CV documents — job offers, HR onboarding, residencias.
     */
    {
      name: 'Trabajo',
      keywords: [
        'curriculum', ' cv ', 'empleo', 'oferta laboral',
        'propuesta economica', 'carta pasante', 'residencia profesional',
        'reclutamiento', 'onboarding', 'benefits', 'nomina', 'nomina',
        'softtek', 'astrazeneca', 'workday', 'intel hiring',
        'aviso de privacidad laboral',
      ],
    },
    /**
     * School / university documents.
     */
    {
      name: 'Escolar',
      keywords: [
        'tarea', 'calificaciones', 'egreso', 'titulacion', 'titulación',
        'servicios escolares', 'residencias', 'posgrado', 'maestria',
        'academico', 'instituto tecnologico', 'itm', 'seguimiento academico',
        'convocatoria', 'certificado', 'cedula', 'tramite escolar',
      ],
    },
    /**
     * Security & account recovery — tightened to avoid catching newsletters.
     */
    {
      name: 'Contrasenas',
      keywords: [
        'password', 'contraseña', 'reset password', 'account recovery',
        'security code', 'codigo de verificacion', 'two-factor', '2fa',
        'verification code', 'restablecer',
      ],
    },
    /**
     * Marketing & promotions.
     */
    {
      name: 'Marketing',
      keywords: [
        'newsletter', 'promocion', 'promo', 'oferta', 'descuento',
        'sale', 'publicidad', 'cupones', 'boletin',
      ],
    },
    /**
     * Important notices & legal.
     */
    {
      name: 'Importantes',
      keywords: [
        'importante', 'urgente', 'urgent', 'aviso de privacidad',
        'notificacion legal', 'contrato', 'poliza', 'seguro medico',
        'accidente', 'atencion medica',
        // Pólizas y cobertura médica (detected 2026-06-13)
        'allianz', 'samsung care', 'dentalia', 'gmm', 'colectivo empresarial',
        'condiciones generales', 'guia abc', 'concierge',
        // Lab médico y resultados
        'chopo', 'laboratorio', 'resultado', 'analisis clinico',
        // Aclaraciones bancarias / contratos
        'aclaracion', 'carta', 'ikea', 'ikeasistencia',
      ],
    },
    /**
     * Personal / family.
     */
    {
      name: 'Personales',
      keywords: [
        'personal', 'family', 'amigo', 'foto', 'bautizo', 'familiar',
      ],
    },
  ],
  /**
   * Rules for detecting and cleaning up junk files in the Drive archive.
   */
  JUNK_FILE_RULES: {
    /** Fragments of filenames (case-insensitive) that indicate a useless file */
    NAME_KEYWORDS: [
      'footer', 'signature', 'firma', 'untitled', 'noname',
      'image001', 'image0001', 'att00001', 'winmail',
      'inline', 'smime', 'part_',
    ],
    /** Extensions that should never be in the archive */
    BAD_EXTENSIONS: ['.p7s', '.ics', '.vcf', '.dat', '.eml', '.msg'],
    /** MIME types indicating metadata/signatures, not real documents */
    BAD_MIME_TYPES: [
      'application/pkcs7-signature',
      'application/x-pkcs7-signature',
      'message/rfc822',
      'text/calendar',
    ],
    /** Files below this size (bytes) are suspicious and marked as junk */
    TINY_FILE_THRESHOLD_BYTES: 5 * 1024,  // 5 KB
    /** Name of the sheet in the Dashboard spreadsheet to log candidates */
    JUNK_AUDIT_SHEET_NAME: 'Junk Audit',
    /**
     * Exceptions to prevent accidental deletion.
     * Includes exact file names and full/partial folder paths.
     */
    EXCEPTIONS: {
      /** Exact filenames (case-insensitive) to skip even if they match rules */
      FILENAMES: ['firma_notario.pdf', 'important_signature.png'],
      /** Substrings of folder paths to skip (e.g., 'Importantes/') */
      FOLDER_PATHS: ['Importantes/', 'Contrasenas/', 'Personales/'],
    }
  },
  /**
   * Default category for emails that don't match any rules above.
   */
  DEFAULT_CATEGORY: 'Otros',
  /**
   * When true, NO writes are made to Drive or Gmail.
   * Every operation that would create, move, label, or trash is logged as
   * "[DRY RUN] Would <action>: <target>" instead of executing.
   * Safe to toggle on for a test run against your real mailbox.
   * @type {boolean}
   */
  DRY_RUN: false,
  /**
   * When true, sends a compact HTML summary email at the end of each
   * processGmailAttachments() run — archived count, deleted count, skipped
   * count, execution time, and next-run suggestion.
   * Uses REPORT_EMAIL as the recipient (falls back to the running account).
   * Requires the gmail.send OAuth scope (already in appsscript.json).
   * @type {boolean}
   */
  ENABLE_BATCH_NOTIFICATION: false,
  /**
   * Non-document cleanup is deliberately staged, never deleted immediately.
   * Each policy targets low-value mail without real attachments and excludes
   * starred/important messages. stageBulkCleanupCandidates() archives and labels
   * matches for review. The user must manually add BULK_DELETE_LABEL before the
   * purge function can move anything to Trash.
   */
  BULK_REVIEW_LABEL_ROOT: 'Cleanup_Review',
  BULK_DELETE_LABEL: 'Cleanup_Delete',
  BULK_CLEANUP_BATCH_SIZE: 100,
  // SaneBox migration completed in 2026; new cleanup is handled by INBOX_RULES.
  BULK_CLEANUP_POLICIES: [],
  /** Number of recent days re-evaluated by the periodic inbox rules. */
  INBOX_RULE_LOOKBACK_DAYS: 30,
  /** Low-value threads remain untouched until their newest message is this old. */
  INBOX_LOW_VALUE_MIN_AGE_DAYS: 7,
  /** Maximum threads fetched per rule and execution. */
  INBOX_RULE_BATCH_SIZE: 100,
  /** Enables delayed archive only for reviewed receipt and order records. */
  ENABLE_DOCUMENT_RECORD_ARCHIVE: true,
  /**
   * Domains that low-value rules may never archive, mark read, or trash.
   * Financial domains are deliberately absent: bank classifier rules add an
   * institution label, while transaction subjects receive priority protection.
   */
  AUTOMATION_PROTECTED_DOMAINS: [
    'accounts.google.com',
    'sat.gob.mx',
    'imss.gob.mx',
    'infonavit.gob.mx',
    'npmjs.com',
    'npmjs.org',
  ],
  /**
   * Subject phrases that always block low-value archive/Trash actions. Gmail's
   * Updates category contains banking, sign-in, and purchase notifications, so
   * these checks are enforced again at runtime instead of trusting categories.
   */
  AUTOMATION_PROTECTED_SUBJECT_PHRASES: [
    'security alert',
    'alerta de seguridad',
    'verification code',
    'codigo de verificacion',
    'codigo de seguridad',
    'codigo de un solo uso',
    'one-time code',
    'passcode',
    'new device sign-in',
    'new sign in',
    'nuevo inicio de sesion',
    'inicio de sesion',
    'two-factor authentication',
    'autenticacion de dos factores',
    '2fa',
    'estado de cuenta',
    'saldo negativo',
    'negative balance',
    'fecha limite de pago',
    'payment due',
    'transferencia nacional spei',
    'confirmacion de transferencia',
    'transferencia enviada',
    'transferencia fue exitosa',
    'deposito a cuenta',
    'deposito a tarjeta',
    'deposito a tu cuenta',
    'retiro/compra con cuenta',
    'autorizacion de cargo',
    'transaccion autorizada',
    'compra autorizada',
    'cargo autorizado',
    'tarjeta bloqueada',
    'tarjeta activada',
    'confirmacion de pago',
    'pago exitoso',
    'servicio de alertas',
    'order receipt',
    'recibo de tu pedido',
    'pedido fue entregado',
    'pedido con uber eats',
    'order with uber eats',
    'ticket digital',
    'no reconocida',
    'unrecognized transaction',
    'actividad sospechosa',
    'suspicious activity',
    'security advisory',
    'security vulnerability',
    'build failed',
    'deployment failed',
    'workflow failed',
  ],
  /**
   * Ordered inbox rules. Institution classifiers are non-terminal so a bank
   * promotion can receive its bank label and still reach a later low-value rule.
   * All other rules are first-match-wins.
   */
  INBOX_RULES: [
    ...FINANCIAL_INBOX_RULES,
    {
      name: 'Security',
      label: 'Auto/Priority/Security',
      query: '{from:accounts.google.com subject:"security alert" subject:seguridad subject:verification subject:verificacion subject:"codigo de seguridad" subject:"código de verificación" subject:"verification code" subject:"one time password" subject:passcode subject:"password reset" subject:"actualizar tu contraseña" subject:"username reminder" subject:"validate your access" subject:passkey subject:"OAuth application" subject:"data exposure" subject:"inicio de sesion" subject:"inicio de sesión" subject:"new sign in" subject:"sign in" subject:"log in" subject:"nuevo inicio de sesion"}',
      archive: false,
      markRead: false,
      markImportant: true,
      lowValue: false,
    },
    {
      name: 'Finance/ActionRequired',
      label: 'Auto/Priority/Finance',
      query: `${FINANCIAL_SENDER_QUERY} ${FINANCIAL_ACTION_REQUIRED_QUERY}`,
      archive: false,
      markRead: false,
      markImportant: true,
      lowValue: false,
    },
    {
      name: 'Travel/Actionable',
      label: 'Auto/Review/Updates/Travel',
      query: '{subject:"check-in" subject:"pase de abordar" subject:"boarding pass" subject:"vuelo se acerca" subject:"flight reminder" subject:"reservation confirmation" subject:"confirmacion de reservacion" subject:itinerario subject:reservacion}',
      archive: false,
      markRead: false,
      markImportant: true,
      lowValue: false,
    },
    {
      name: 'Developer/Security',
      label: 'Auto/Priority/Developer Security',
      query: '{subject:"security advisory" subject:"security vulnerability" subject:CVE subject:"dependabot alert"}',
      archive: false,
      markRead: false,
      markImportant: true,
      lowValue: false,
    },
    {
      name: 'Developer/Failures',
      label: 'Auto/Review/Developer/Failures',
      query: '{subject:"build failed" subject:"deployment failed" subject:"workflow failed" subject:"pipeline failed"}',
      archive: false,
      markRead: false,
      markImportant: true,
      lowValue: false,
    },
    {
      name: 'Documents',
      label: 'Auto/Documents/Attachments',
      query: 'has:attachment',
      archive: false,
      markRead: false,
      markImportant: false,
      lowValue: false,
      continueProcessing: true,
    },
    {
      name: 'Receipts',
      label: 'Auto/Documents/Receipts',
      query: '{subject:factura subject:facturas subject:recibo subject:invoice subject:invoices subject:receipt subject:comprobante subject:"tu ticket" subject:"hemos recibido tu pago" subject:"gracias por comprar"}',
      archive: true,
      markRead: true,
      markImportant: false,
      lowValue: false,
      record: true,
      minimumAgeDays: 14,
      ignoreImportantProtection: true,
      allowProtectedContentArchive: true,
      archiveGate: 'ENABLE_DOCUMENT_RECORD_ARCHIVE',
    },
    {
      name: 'Orders/Records',
      label: 'Auto/Documents/Orders',
      query: '{subject:pedido subject:"order confirmation" subject:"your order" subject:"pedido fue entregado" subject:"order delivered" subject:"shipment delivered" ({from:amazon.com.mx from:mercadolibre.com.mx} {subject:"tu compra está en camino" subject:"en proceso de entrega" subject:"enviado:" subject:"entregado:" subject:"producto cancelado" subject:compraste})}',
      archive: true,
      markRead: true,
      markImportant: false,
      lowValue: false,
      record: true,
      minimumAgeDays: 14,
      ignoreImportantProtection: true,
      allowProtectedContentArchive: true,
      archiveGate: 'ENABLE_DOCUMENT_RECORD_ARCHIVE',
    },
    {
      name: 'Updates/BankMarketing',
      label: 'Auto/LowValue/Bank Promotions',
      query: '{from:boletin@invextarjetas.com.mx from:news.paypal.com from:marketingdir@banamex.com from:novedades.uala.com.mx} -has:attachment -is:starred',
      archive: true,
      markRead: true,
      markImportant: false,
      lowValue: true,
      ignoreImportantProtection: true,
    },
    {
      name: 'Updates/Digests',
      label: 'Auto/LowValue/Digests',
      query: 'category:updates {from:medium.com from:substack.com from:e.udemymail.com from:digest.bytebytego.com from:newsletter subject:digest subject:newsletter subject:"weekly update" subject:"weekly digest"} -has:attachment -is:starred -is:important',
      archive: true,
      markRead: true,
      markImportant: false,
      lowValue: true,
    },
    {
      name: 'Promotions',
      label: 'Auto/LowValue/Promotions',
      query: 'category:promotions -has:attachment -is:starred -is:important',
      archive: true,
      markRead: true,
      markImportant: false,
      lowValue: true,
    },
    {
      name: 'Social',
      label: 'Auto/LowValue/Social',
      query: 'category:social -has:attachment -is:starred -is:important',
      archive: true,
      markRead: true,
      markImportant: false,
      lowValue: true,
    },
    {
      name: 'Updates/ActionRequired',
      label: 'Auto/Priority/Action Required',
      query: 'category:updates {subject:"action required" subject:"accion requerida" subject:"requiere tu atencion" subject:"complete your" subject:"completa tu" subject:"confirm your" subject:"confirma tu" subject:"at risk of suspension" subject:"expired card" subject:"about to be deleted" subject:"data will be deleted" subject:"usage alert" subject:"will not renew" subject:"saldo negativo" subject:"negative balance" subject:"parking session is about to expire" subject:failed subject:fallo subject:rechazado}',
      archive: false,
      markRead: false,
      markImportant: true,
      lowValue: false,
    },
  ],

  /**
   * Historical Inbox drain. Auditing is read-only. Staging is reversible
   * (label + archive, never Trash) and requires the exact confirmation token.
   */
  INBOX_BACKLOG_BATCH_SIZE: 100,
  INBOX_BACKLOG_CONFIRMATION: '', // required value: ARCHIVE_INBOX_BACKLOG
  INBOX_BACKLOG_POLICIES: [
    {
      name: 'Receipts',
      label: 'Cleanup_Review/Backlog/Receipts',
      requiredSourceLabel: 'Auto/Documents/Receipts',
      query: 'in:inbox older_than:30d -has:attachment -is:starred -is:important',
      markRead: true,
      allowProtectedContentArchive: true,
    },
    {
      name: 'Financial Records',
      label: 'Cleanup_Review/Backlog/Financial Records',
      query: `in:inbox older_than:30d -has:attachment -is:starred -is:important ${FINANCIAL_SENDER_QUERY} ${FINANCIAL_RECORD_QUERY}`,
      markRead: true,
      allowProtectedContentArchive: true,
    },
  ],
  /** Label-only historical backfill for the institution/type hierarchy. */
  FINANCIAL_SUBLABEL_BACKFILL_LOOKBACK_DAYS: 3650,
  FINANCIAL_SUBLABEL_BACKFILL_BATCH_SIZE: 100,
  FINANCIAL_SUBLABEL_BACKFILL_INTERVAL_MINUTES: 10,
  FINANCIAL_SUBLABEL_BACKFILL_CONFIRMATION: '',
  FINANCIAL_LABEL_REPAIR_BATCH_SIZE: 100,
  FINANCIAL_LABEL_REPAIR_CONFIRMATION: '',
  /** One-time ad hoc finance corrections remain locked until a reviewed live run. */
  FINANCIAL_TAXONOMY_MIGRATION_CONFIRMATION: '',
  FINANCIAL_INSTITUTION_REHOME_CONFIRMATION: '',
  FINANCIAL_VERIFIED_CORRECTIONS_CONFIRMATION: '',
  FINANCIAL_RETIRED_LABEL_DELETION_CONFIRMATION: '',
  /** Auto-trash remains disabled until auditInboxRuleRetention() is reviewed. */
  ENABLE_RULE_RETENTION_TRASH: false,
  RULE_RETENTION_POLICIES: [
    { label: 'Auto/LowValue/Promotions', olderThanDays: 30 },
    { label: 'Auto/LowValue/Social', olderThanDays: 90 },
    { label: 'Auto/LowValue/Digests', olderThanDays: 60 },
    { label: 'Auto/LowValue/Bank Promotions', olderThanDays: 60 },
  ],
  /** Batch limit for retention cleanup and manual label emptying. */
  RULE_RETENTION_BATCH_SIZE: 100,
  /**
   * Optional one-label empty operation. Set both fields deliberately, run
   * emptyConfiguredLowValueLabel(), then clear the confirmation value again.
   */
  LOW_VALUE_LABEL_TO_EMPTY: '',
  EMPTY_LOW_VALUE_CONFIRMATION: '', // required value: TRASH_LOW_VALUE_LABEL
};

if (typeof module !== 'undefined') {
  module.exports = {
    CONFIG,
    FINANCIAL_INSTITUTIONS,
    AFORE_FINANCIAL_QUERY,
    INFONAVIT_FINANCIAL_QUERY,
    FINANCIAL_SENDER_QUERY,
    FINANCIAL_LABEL_MIGRATIONS,
    FINANCIAL_INSTITUTION_REHOMES,
    FINANCIAL_RETIRED_INSTITUTIONS,
    FINANCIAL_SUBLABELS,
    FINANCIAL_INSTITUTION_SUBLABEL_OVERRIDES,
    FINANCIAL_ACTION_REQUIRED_QUERY,
    FINANCIAL_RECORD_QUERY,
    FINANCIAL_INBOX_RULES,
    buildFinancialSublabelsForInstitution,
    expandFinancialSearchPhrases,
    buildFinancialSubjectOrQuery,
  };
}
