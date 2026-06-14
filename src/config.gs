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
    '@bbva.com': 'BBVA',
    '@bbva.com.mx': 'BBVA',
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
    '@gbm.com.mx': 'GBM',
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
        // GBM inversiones + INVEX (detected 2026-06-13)
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
};
