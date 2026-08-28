# Financial Mail Taxonomy

Financial classification separates three concepts:

1. **Institution** — parent label, derived from sender.
2. **Message type** — child label, derived from ordered rules and evidence.
3. **Required action** — separate priority/routine rules; not encoded by the institution child alone.

Every matched bank thread keeps its parent label even after receiving a child. This makes the parent a useful all-mail view and means parent counts do not shrink during backfill.

## Institutions and sender queries

| Institution | Gmail sender query |
|---|---|
| Santander | `{from:santander.com.mx from:envio.santander.com.mx}` |
| Afore | Verified Afore Banamex/AforeMóvil senders plus the exact Afore statement subject |
| Infonavit | `{from:infonavit.org.mx from:infonavit.gob.mx}` |
| Banamex | Banamex/Citibanamex domains excluding the verified Afore split patterns |
| Invex | `from:invextarjetas.com.mx` |
| Mercado Pago | `{from:mercadopago.com.mx from:mercadopago.com from:gbm.com.mx}` |
| PayPal | `from:paypal.com` |
| Hey Banco | `{from:hey.inc from:heybanco.com}` |
| Nu | `{from:nu.com.mx from:nubank.com.mx}` |
| Revolut | `from:revolut.com` |
| Uala | `{from:uala.com.mx from:uala.mx from:abccapital.com.mx}` |
| Openbank | `from:openbank` |

The Gmail label remains `Uala` for compatibility even though the brand is normally written Ualá.
GBM-origin messages are intentionally part of `Auto/Finance/Mercado Pago`; do
not create or maintain a separate GBM institution label. BBVA is intentionally
absent from this account's taxonomy.

`Afore` and `Infonavit` are dedicated parents, not shared child labels. This
preserves the useful message type below each one: an Afore statement remains
`Afore/Estados de cuenta`, while a password notice remains
`Infonavit/Seguridad`. The Afore query intentionally does not match the word
`afore` by itself because ordinary Banamex transaction messages can mention
`AFORE MOVIL` as the merchant.

## Shared child labels

- `Seguridad`
- `Hipoteca`
- `Créditos`
- `Estados de cuenta`
- `Inversiones`
- `Pagos y vencimientos`
- `Transacciones`
- `Promociones y beneficios`
- `Tarjetas`
- `Avisos de servicio`
- `Otros`

Rules are ordered. Security and other specific signals must beat broad words such as `compra`, `cargo`, `pago`, and `transacción`.

## Statement evidence rule

A message may receive `Estados de cuenta` only when its subject is statement-like and at least one of these is true:

1. The thread contains a non-inline PDF, XML, or ZIP statement document.
2. The message explicitly says the current statement is available and provides access/download language, such as `ya está disponible`, `listo para consultarse`, `ver en línea`, `para acceder`, `sección de documentos`, `descárgalo`, or their English equivalents.

A keyword mention alone is insufficient. Without evidence, the resolver reclassifies while excluding the statement category.

Known non-statement patterns include:

- `Notificación Paperless` → `Avisos de servicio`
- `Consulta realizada` → `Seguridad`
- `Consulta de Estado de Cuenta...` → `Seguridad`
- how-to, education, future digital-delivery, and design-change notices → `Otros` or `Avisos de servicio`
- `Reenvío de Indicaciones importantes` / password instructions → `Avisos de servicio`
- `Fe de erratas` without a current document → not a statement

Legitimate link-delivered patterns have been observed for Mercado Pago mail
originating from GBM, PayPal, Nu, Hey Banco, Openbank, and some Banamex mail.
Therefore attachment-only classification would be too strict; explicit
current-document access is the controlled exception.

Observed Infonavit subjects such as `Ya está disponible tu estado de cuenta`
qualify only because they explicitly announce the current document. They do
not require an attachment. Generic education or future-delivery notices remain
subject to the same evidence rejection as every other institution.

## Afore- and Infonavit-specific behavior

Afore removes the generic word `afore` from child selection so the parent name
does not force every message into `Inversiones`. Verified retirement language
such as `ahorro voluntario` and `SIEFORE` selects `Inversiones`; access keys
select `Seguridad`; webinars select `Promociones y beneficios`; and service or
profile notices select `Avisos de servicio`.

Infonavit uses its official sender domains. Password/NIP mail selects
`Seguridad`, housing-contribution summaries select `Transacciones`, current
statement notices select `Estados de cuenta`, and account/citation/registration
confirmations select `Avisos de servicio`.

## Ualá-specific behavior

Ualá uses the shared child names with institution-specific vocabulary. Its promotions are evaluated before generic transactions so marketing subjects do not win merely because they contain `transacción` or `compra`.

Examples:

| Subject | Child |
|---|---|
| `Cada transacción es una anotación.` | `Promociones y beneficios` |
| `Un año de gasolina gratis` | `Promociones y beneficios` |
| `Participa por tarjetas de regalo` | `Promociones y beneficios` |
| `Aquí está tu siguiente paso como inversionista` | `Inversiones` |
| `Que tus ahorros no dejen de ganar: pásalos a reserva a plazo` | `Inversiones` |
| `Tu paquete recomendado acaba de ser actualizado` | `Inversiones` |
| `Aviso de Mantenimiento` | `Avisos de servicio` |

Live mail has been observed from both `uala.com.mx` and `uala.mx`; both are part
of the same Ualá institution path.

## Live versus historical classification

### Incoming mail

`resolveInboxRuleLabelNames` reads thread subjects and, only for statement candidates, validates attachments/body evidence. It applies both parent and one child.

### Historical backfill

`buildFinancialSublabelSearchQueries` uses Gmail's subject index and bulk label operations for performance. Statement candidates receive an additional message-level evidence filter before labeling.

### Repair

`repairFinancialLabels` runs in bounded batches and:

1. Reclassifies known invalid statement labels.
2. Removes obsolete finance-only Actionable/Priority assignments.
3. Moves recognizable `Otros` mail into a more specific child.

It does not change read/archive state.

## Adding or changing a bank

1. Confirm real sender domains with a read-only Gmail search.
2. Add the institution to `FINANCIAL_INSTITUTIONS`.
3. Reuse the shared child taxonomy.
4. Add bank-specific vocabulary only when real examples justify it.
5. Preserve Security precedence; choose promotion/transaction ordering deliberately.
6. Add real-world tests in `__tests__/config.test.js` and evidence tests in `__tests__/inbox-rules.test.js`.
7. Run the full suite.
8. Audit live candidates before deploying or backfilling.

For a query-scoped split from an existing institution, use
`auditFinancialInstitutionRehomeAdHoc` first. The paired mutator
`rehomeFinancialInstitutionsAdHoc` is token-gated, adds the exact new
parent/child, and removes only the query-matched old finance labels. It never
changes read/archive state.

## Historical-query constraints

- Pure matching normalizes accents; Gmail historical search may not. Expand accented Spanish variants explicitly.
- Chunk large OR groups to stay below practical Gmail query-length limits.
- Direct `GmailApp.search` calls cap results; use bounded batches intentionally.
- Avoid reading every message in a large historical batch except where evidence validation is required.
