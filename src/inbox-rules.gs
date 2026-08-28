// =============================================================================
// PERIODIC INBOX RULES
// Gmail has native filters, but this module supports ordered, code-reviewed rules
// with attachment/sender/thread safety checks and configurable retention.
// =============================================================================

/** Read-only candidate counts for every configured incoming-mail rule. */
function auditInboxRules() {
  Logger.log('=== INBOX RULE AUDIT (READ-ONLY) ===');
  CONFIG.INBOX_RULES.forEach(function (rule) {
    const query = buildInboxRuleQuery(rule);
    const count = countThreads(query, CONFIG.MAX_COUNT_PER_QUERY);
    const capped = count >= CONFIG.MAX_COUNT_PER_QUERY ? '+' : '';
    Logger.log(`${rule.name}: ${count}${capped} recent Inbox thread(s)`);
    Logger.log(`  ${query}`);
  });
}

/**
 * Applies ordered labels to recent Inbox threads. First match wins per run,
 * except non-terminal classifier rules, which may add an institution label and
 * let a later rule decide whether the same thread should stay or be archived.
 * Low-value actions are blocked for real attachments and protection signals.
 */
function runInboxRules() {
  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Inbox rules skipped — another execution is already running.');
    return;
  }

  try {
  const startTime = Date.now();
  const handledThreadIds = new Set();
  const handledRuleGroupsByThreadId = new Map();
  const counters = { labelled: 0, archived: 0, markedRead: 0, protected: 0, errors: 0 };

  if (CONFIG.DRY_RUN) {
    Logger.log('⚠️ DRY RUN — inbox rules will only log planned actions.');
  }

  CONFIG.INBOX_RULES.forEach(function (rule) {
    if (Date.now() - startTime > 4.5 * 60 * 1000) return;

    const query = buildInboxRuleQuery(rule);
    const threads = GmailApp.search(query, 0, CONFIG.INBOX_RULE_BATCH_SIZE);
    const ruleLabels = {};

    threads.forEach(function (thread) {
      if (Date.now() - startTime > 4.5 * 60 * 1000) return;
      const threadId = thread.getId();
      if (handledThreadIds.has(threadId)) return;
      const handledGroups = handledRuleGroupsByThreadId.get(threadId) || new Set();
      if (rule.exclusiveGroup && handledGroups.has(rule.exclusiveGroup)) return;

      try {
        const messages = thread.getMessages();
        const minimumAgeDays = Number(
          rule.minimumAgeDays || (rule.lowValue ? CONFIG.INBOX_LOW_VALUE_MIN_AGE_DAYS : 0)
        );
        if (
          minimumAgeDays > 0 &&
          threadHasMessageInsideMinimumAge(messages, minimumAgeDays)
        ) {
          Logger.log(
            `[RECENT] ${rule.name} left untouched (<${minimumAgeDays}d): ` +
            thread.getFirstMessageSubject()
          );
          if (!rule.continueProcessing) handledThreadIds.add(threadId);
          return;
        }
        const effectiveArchive = isInboxRuleArchiveEnabled(rule);
        const archiveFeatureDisabled = !!rule.archive && !effectiveArchive;
        const decision = archiveFeatureDisabled
          ? { action: 'label_only', reason: 'record_archive_disabled' }
          : decideInboxRuleAction({
          lowValue: rule.lowValue,
          record: rule.record,
          archive: effectiveArchive,
          hasRealAttachments: threadHasRealAttachments(messages),
          protectedThread: isThreadProtected(thread, messages, {
            ignoreImportant: !!rule.ignoreImportantProtection,
          }),
          protectedSender: threadHasAutomationProtectedSender(messages),
          protectedContent: threadHasAutomationProtectedContent(messages),
          allowProtectedContentArchive: !!rule.allowProtectedContentArchive,
        });
        const archiveBlocked =
          effectiveArchive && (rule.lowValue || rule.record) && decision.action !== 'archive';
        const needsReview = rule.lowValue && archiveBlocked;
        const targetLabelNames = resolveInboxRuleLabelNames(rule, messages, needsReview);

        if (CONFIG.DRY_RUN) {
          Logger.log(
            `[DRY RUN] ${rule.name} → ${targetLabelNames.join(', ')}; action=${decision.action}; ` +
            `reason=${decision.reason}; subject=${thread.getFirstMessageSubject()}`
          );
        } else {
          targetLabelNames.forEach(function (labelName) {
            ruleLabels[labelName] = ruleLabels[labelName] || getOrCreateLabel(labelName);
            thread.addLabel(ruleLabels[labelName]);
          });
          if (rule.markImportant && typeof thread.markImportant === 'function') {
            thread.markImportant();
          }
          if (decision.action === 'archive') {
            if (rule.markRead) {
              thread.markRead();
              counters.markedRead++;
            }
            thread.moveToArchive();
          }
        }

        counters.labelled++;
        if (decision.action === 'archive') counters.archived++;
        if (archiveBlocked) counters.protected++;
        if (rule.exclusiveGroup) {
          handledGroups.add(rule.exclusiveGroup);
          handledRuleGroupsByThreadId.set(threadId, handledGroups);
        }
        if (!rule.continueProcessing) handledThreadIds.add(threadId);
      } catch (error) {
        counters.errors++;
        Logger.log(`Inbox rule error for thread ${threadId}: ${error}`);
      }
    });
  });

  Logger.log(
    `Inbox rules complete — labelled=${counters.labelled}, archived=${counters.archived}, ` +
    `markedRead=${counters.markedRead}, protected=${counters.protected}, errors=${counters.errors}`
  );
  } finally {
    executionLock.releaseLock();
  }
}

/** Builds the complete recent-Inbox query for a rule. */
function buildInboxRuleQuery(rule) {
  const queryParts = [
    'in:inbox',
    `newer_than:${CONFIG.INBOX_RULE_LOOKBACK_DAYS}d`,
    '-in:spam',
    '-in:trash',
  ];

  const minimumAgeDays = Number(
    rule.minimumAgeDays || (rule.lowValue ? CONFIG.INBOX_LOW_VALUE_MIN_AGE_DAYS : 0)
  );
  if (minimumAgeDays > 0) queryParts.push(`older_than:${minimumAgeDays}d`);

  if (
    rule.archiveGate &&
    !CONFIG[rule.archiveGate] &&
    GmailApp.getUserLabelByName(rule.label)
  ) {
    // During the sampling phase, label once and avoid reprocessing hourly.
    // Enabling the feature removes this exclusion so labelled Inbox records
    // can be archived without removing their labels first.
    queryParts.push(`-label:"${rule.label}"`);
  } else if (rule.lowValue || rule.record) {
    const protectedLabelName = `${CONFIG.BULK_REVIEW_LABEL_ROOT}/Protected`;
    if (GmailApp.getUserLabelByName(protectedLabelName)) {
      queryParts.push(`-label:"${protectedLabelName}"`);
    }
  } else if (GmailApp.getUserLabelByName(rule.label)) {
    // Priority/review rules leave mail in Inbox, so exclude completed work.
    queryParts.push(`-label:"${rule.label}"`);
  }

  queryParts.push(rule.query);
  return queryParts.join(' ');
}

/** True when an archive rule is active under the current rollout gates. */
function isInboxRuleArchiveEnabled(rule) {
  return !!rule.archive && (!rule.archiveGate || !!CONFIG[rule.archiveGate]);
}

/** Resolves the parent and optional subject-specific child label for a rule. */
function resolveInboxRuleLabelNames(rule, messages, needsReview) {
  if (needsReview) return [`${CONFIG.BULK_REVIEW_LABEL_ROOT}/Protected`];
  const labelNames = [rule.label];
  if (rule.sublabels && rule.sublabels.length) {
    const subjectText = messages.map(function (message) { return message.getSubject(); }).join(' | ');
    let sublabel = classifyFinancialSubject(subjectText, rule.sublabels);
    const matchedSubcategory = rule.sublabels.find(function (subcategory) {
      return subcategory.name === sublabel;
    });
    if (
      matchedSubcategory &&
      matchedSubcategory.requiresStatementEvidence &&
      !financialThreadHasStatementEvidence(messages, matchedSubcategory)
    ) {
      sublabel = classifyFinancialSubject(subjectText, rule.sublabels.filter(function (subcategory) {
        return !subcategory.requiresStatementEvidence;
      }));
    }
    labelNames.push(`${rule.label}/${sublabel}`);
  }
  return Array.from(new Set(labelNames));
}

const FINANCIAL_STATEMENT_DISQUALIFYING_SUBJECT_PHRASES = [
  'notificacion paperless', 'consulta realizada',
  'consulta de estado de cuenta', 'guia para abrir',
  'quieres solicitar tu estado de cuenta', 'conoce el nuevo estado de cuenta',
  'conoces el estado de cuenta', 'consulta tu estado de cuenta',
  'tu estado de cuenta sera digital', 'se vuelve digital',
  'desde ahora tu estado de cuenta es digital',
  'recibe solo un estado de cuenta electronico',
  'nuevo diseno de tu estado de cuenta',
  'reenvio de indicaciones importantes', 'fe de erratas',
];

const FINANCIAL_STATEMENT_REPAIR_SUBJECT_PHRASES = [
  'notificacion paperless', 'consulta realizada',
  'consulta de estado de cuenta', 'nuevo diseno de tu estado de cuenta',
  'reenvio de indicaciones importantes',
];

const FINANCIAL_STATEMENT_ACCESS_PHRASES = [
  'ya esta disponible', 'esta listo para que lo consulte',
  'esta listo para su consulta', 'listo para consultarse',
  'lista para consultarse', 'ver en linea', 'para acceder',
  'seccion de documentos', 'descargarlo', 'descargalo',
  'descarga tu estado de cuenta',
  'descarga el estado de cuenta', 'consulta y descarga',
  'now available', 'ready to view', 'view online',
  'download your statement', 'available in the app', 'documents section',
];

/** True when an attachment looks like an actual statement document. */
function financialMessageHasStatementDocument(message) {
  if (!message || typeof message.getAttachments !== 'function') return false;
  let attachments = [];
  try {
    attachments = message.getAttachments({
      includeInlineImages: false,
      includeAttachments: true,
    });
  } catch (error) {
    try {
      attachments = message.getAttachments();
    } catch (fallbackError) {
      attachments = [];
    }
  }
  return (attachments || []).some(function (attachment) {
    const name = String(
      attachment && typeof attachment.getName === 'function' ? attachment.getName() : ''
    ).toLowerCase();
    const contentType = String(
      attachment && typeof attachment.getContentType === 'function'
        ? attachment.getContentType()
        : ''
    ).toLowerCase();
    return /\.(pdf|xml|zip)$/.test(name) ||
      contentType === 'application/pdf' ||
      contentType === 'application/xml' ||
      contentType === 'text/xml' ||
      contentType.indexOf('application/zip') === 0;
  });
}

/**
 * A statement needs a document attachment, or an explicit message saying the
 * current statement is ready to access/download. Merely mentioning statements
 * in a consultation, paperless, education, or design notice is insufficient.
 */
function financialThreadHasStatementEvidence(messages, subcategory) {
  const threadMessages = messages || [];
  if (threadMessages.some(financialMessageHasStatementDocument)) return true;

  const statementPhrases = (subcategory && subcategory.phrases) || [
    'estado de cuenta', 'account statement', 'corte mensual', 'resumen mensual',
  ];
  return threadMessages.some(function (message) {
    const subject = normalizeForMatching(
      message && typeof message.getSubject === 'function' ? message.getSubject() : ''
    );
    if (FINANCIAL_STATEMENT_DISQUALIFYING_SUBJECT_PHRASES.some(function (phrase) {
      return subject.indexOf(normalizeForMatching(phrase)) !== -1;
    })) return false;
    if (!statementPhrases.some(function (phrase) {
      return subject.indexOf(normalizeForMatching(phrase)) !== -1;
    })) return false;

    let body = '';
    try {
      if (message && typeof message.getPlainBody === 'function') body = message.getPlainBody();
      else if (message && typeof message.getBody === 'function') body = message.getBody();
    } catch (error) {
      body = '';
    }
    const searchText = normalizeForMatching(`${subject} ${body}`);
    return FINANCIAL_STATEMENT_ACCESS_PHRASES.some(function (phrase) {
      return searchText.indexOf(normalizeForMatching(phrase)) !== -1;
    });
  });
}

function filterFinancialThreadsForSubcategory(threads, subcategory) {
  if (!subcategory || !subcategory.requiresStatementEvidence) return threads;
  return threads.filter(function (thread) {
    return financialThreadHasStatementEvidence(thread.getMessages(), subcategory);
  });
}

/** True when a thread contains any message inside the protected recent window. */
function threadHasMessageInsideMinimumAge(messages, minimumAgeDays) {
  const threshold = Date.now() - Number(minimumAgeDays) * 24 * 60 * 60 * 1000;
  return messages.some(function (message) {
    return message.getDate().getTime() >= threshold;
  });
}

/** True when any message is from a configured protected domain. */
function threadHasAutomationProtectedSender(messages) {
  return messages.some(function (message) {
    return isProtectedSenderEmail(message.getFrom(), CONFIG.AUTOMATION_PROTECTED_DOMAINS);
  });
}

/** True when any message subject signals security, finance, or purchase data. */
function threadHasAutomationProtectedContent(messages) {
  return messages.some(function (message) {
    return isProtectedAutomationSubject(
      message.getSubject(),
      CONFIG.AUTOMATION_PROTECTED_SUBJECT_PHRASES
    );
  });
}

/** Read-only counts for historical bank mail still missing a financial child label. */
function auditFinancialSublabelBackfill() {
  Logger.log('=== FINANCIAL SUBLABEL BACKFILL AUDIT (READ-ONLY) ===');
  FINANCIAL_INBOX_RULES.forEach(function (rule) {
    const query = buildFinancialSublabelBackfillQuery(rule);
    const count = countThreads(query, CONFIG.MAX_COUNT_PER_QUERY);
    const capped = count >= CONFIG.MAX_COUNT_PER_QUERY ? '+' : '';
    Logger.log(`${rule.name}: ${count}${capped} thread(s) missing a child label`);
    Logger.log(`  ${query}`);
  });
  Logger.log('No labels or messages were changed.');
}

/**
 * Adds parent + subject-derived child labels to historical bank mail. It never
 * changes read/archive state and requires an explicit token outside DRY_RUN.
 */
function backfillFinancialSublabels() {
  if (
    !CONFIG.DRY_RUN &&
    CONFIG.FINANCIAL_SUBLABEL_BACKFILL_CONFIRMATION !== 'APPLY_FINANCIAL_SUBLABELS'
  ) {
    Logger.log('Financial sublabel confirmation token missing. Nothing changed.');
    return { labelled: 0, errors: 0, skipped: true };
  }

  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Financial backfill skipped — another mailbox execution is running.');
    return { labelled: 0, errors: 0, skipped: true };
  }

  try {
    let remaining = CONFIG.FINANCIAL_SUBLABEL_BACKFILL_BATCH_SIZE;
    let labelled = 0;
    let errors = 0;
    const handledThreadIds = new Set();

    FINANCIAL_INBOX_RULES.forEach(function (rule) {
      if (remaining <= 0) return;
      rule.sublabels.forEach(function (subcategory) {
        if (remaining <= 0) return;
        buildFinancialSublabelSearchQueries(rule, subcategory).forEach(function (query) {
          if (remaining <= 0) return;
          const searchLimit = subcategory.requiresStatementEvidence
            ? Math.min(CONFIG.MAX_COUNT_PER_QUERY, Math.max(remaining * 5, remaining))
            : remaining;
          let threads = GmailApp.search(query, 0, searchLimit).filter(function (thread) {
            return !handledThreadIds.has(thread.getId());
          });
          threads = filterFinancialThreadsForSubcategory(threads, subcategory).slice(0, remaining);
          if (!threads.length) return;

          try {
            const childLabelName = `${rule.label}/${subcategory.name}`;
            if (CONFIG.DRY_RUN) {
              Logger.log(
                `[DRY RUN] Would add ${rule.label}, ${childLabelName} to ` +
                `${threads.length} thread(s).`
              );
            } else {
              getOrCreateLabel(rule.label).addToThreads(threads);
              getOrCreateLabel(childLabelName).addToThreads(threads);
            }
            threads.forEach(function (thread) {
              handledThreadIds.add(thread.getId());
            });
            labelled += threads.length;
            remaining -= threads.length;
          } catch (error) {
            errors += threads.length;
            Logger.log(
              `Financial bulk-label error for ${rule.name}/${subcategory.name} ` +
              `(${threads.length} thread(s)): ${error}`
            );
          }
        });
      });
    });

    Logger.log(
      `Financial sublabel backfill complete — labelled=${labelled}, errors=${errors}, ` +
      'read/archive state unchanged.'
    );
    return { labelled, errors, skipped: false };
  } finally {
    executionLock.releaseLock();
  }
}

/**
 * Repairs misclassified financial children and removes obsolete finance-only
 * priority/actionable labels in reversible batches.
 */
function repairFinancialLabels() {
  if (
    !CONFIG.DRY_RUN &&
    CONFIG.FINANCIAL_LABEL_REPAIR_CONFIRMATION !== 'REPAIR_FINANCIAL_LABELS'
  ) {
    Logger.log('Financial label repair confirmation token missing. Nothing changed.');
    return { changed: 0, errors: 0, skipped: true };
  }

  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Financial label repair skipped — another mailbox execution is running.');
    return { changed: 0, errors: 0, skipped: true };
  }

  try {
    let remaining = CONFIG.FINANCIAL_LABEL_REPAIR_BATCH_SIZE;
    let reclassified = 0;
    let legacyRemoved = 0;
    let errors = 0;

    FINANCIAL_INBOX_RULES.forEach(function (rule) {
      if (remaining <= 0) return;
      const statementSubcategory = rule.sublabels.find(function (subcategory) {
        return subcategory.requiresStatementEvidence;
      });
      if (!statementSubcategory) return;
      const statementLabelName = `${rule.label}/${statementSubcategory.name}`;
      const statementLabel = GmailApp.getUserLabelByName(statementLabelName);
      if (!statementLabel) return;

      const candidates = GmailApp.search(
        [
          `label:"${statementLabelName}"`,
          buildFinancialSublabelSubjectQuery({
            phrases: FINANCIAL_STATEMENT_REPAIR_SUBJECT_PHRASES,
          }),
          '-in:spam',
          '-in:trash',
        ].join(' '),
        0,
        CONFIG.MAX_COUNT_PER_QUERY
      );
      const invalidThreads = candidates.filter(function (thread) {
        return !financialThreadHasStatementEvidence(
          thread.getMessages(),
          statementSubcategory
        );
      }).slice(0, remaining);
      const threadsByTarget = {};
      invalidThreads.forEach(function (thread) {
        const messages = thread.getMessages();
        const subjectText = messages.map(function (message) {
          return message.getSubject();
        }).join(' | ');
        const targetSublabel = classifyFinancialSubject(
          subjectText,
          rule.sublabels.filter(function (subcategory) {
            return !subcategory.requiresStatementEvidence;
          })
        );
        const targetLabelName = `${rule.label}/${targetSublabel}`;
        threadsByTarget[targetLabelName] = threadsByTarget[targetLabelName] || [];
        threadsByTarget[targetLabelName].push(thread);
      });

      Object.keys(threadsByTarget).forEach(function (targetLabelName) {
        if (remaining <= 0) return;
        const threads = threadsByTarget[targetLabelName].slice(0, remaining);
        try {
          if (CONFIG.DRY_RUN) {
            Logger.log(
              `[DRY RUN] Would move ${threads.length} invalid statement thread(s) from ` +
              `${statementLabelName} to ${targetLabelName}.`
            );
          } else {
            getOrCreateLabel(targetLabelName).addToThreads(threads);
            statementLabel.removeFromThreads(threads);
          }
          reclassified += threads.length;
          remaining -= threads.length;
        } catch (error) {
          errors += threads.length;
          Logger.log(
            `Financial statement-evidence repair error for ${rule.name} ` +
            `(${threads.length} thread(s)): ${error}`
          );
        }
      });
    });

    const legacyPolicies = [
      {
        label: 'Auto/Review/Updates/Actionable',
        query: FINANCIAL_SENDER_QUERY,
      },
      {
        label: 'Auto/Priority/Finance',
        query: `${FINANCIAL_SENDER_QUERY} -${FINANCIAL_ACTION_REQUIRED_QUERY}`,
      },
    ];
    legacyPolicies.forEach(function (policy) {
      if (remaining <= 0) return;
      const label = GmailApp.getUserLabelByName(policy.label);
      if (!label) return;
      const threads = GmailApp.search(
        `label:"${policy.label}" ${policy.query} -in:spam -in:trash`,
        0,
        remaining
      );
      if (!threads.length) return;
      try {
        if (CONFIG.DRY_RUN) {
          Logger.log(
            `[DRY RUN] Would remove obsolete ${policy.label} from ` +
            `${threads.length} financial thread(s).`
          );
        } else {
          label.removeFromThreads(threads);
        }
        legacyRemoved += threads.length;
        remaining -= threads.length;
      } catch (error) {
        errors += threads.length;
        Logger.log(
          `Financial legacy-label repair error for ${policy.label} ` +
          `(${threads.length} thread(s)): ${error}`
        );
      }
    });

    FINANCIAL_INBOX_RULES.forEach(function (rule) {
      if (remaining <= 0) return;
      const otherLabelName = `${rule.label}/Otros`;
      const otherLabel = GmailApp.getUserLabelByName(otherLabelName);
      if (!otherLabel) return;

      rule.sublabels.filter(function (subcategory) {
        return !subcategory.fallback;
      }).forEach(function (subcategory) {
        if (remaining <= 0) return;
        const query = [
          `label:"${otherLabelName}"`,
          buildFinancialSublabelSubjectQuery(subcategory),
          '-in:spam',
          '-in:trash',
        ].join(' ');
        const searchLimit = subcategory.requiresStatementEvidence
          ? Math.min(CONFIG.MAX_COUNT_PER_QUERY, Math.max(remaining * 5, remaining))
          : remaining;
        let threads = GmailApp.search(query, 0, searchLimit);
        threads = filterFinancialThreadsForSubcategory(threads, subcategory).slice(0, remaining);
        if (!threads.length) return;

        try {
          const childLabelName = `${rule.label}/${subcategory.name}`;
          if (CONFIG.DRY_RUN) {
            Logger.log(
              `[DRY RUN] Would move ${threads.length} thread(s) from ` +
              `${otherLabelName} to ${childLabelName}.`
            );
          } else {
            getOrCreateLabel(childLabelName).addToThreads(threads);
            otherLabel.removeFromThreads(threads);
          }
          reclassified += threads.length;
          remaining -= threads.length;
        } catch (error) {
          errors += threads.length;
          Logger.log(
            `Financial repair error for ${rule.name}/${subcategory.name} ` +
            `(${threads.length} thread(s)): ${error}`
          );
        }
      });
    });

    const changed = reclassified + legacyRemoved;
    Logger.log(
      `Financial label repair complete — reclassified=${reclassified}, ` +
      `legacyRemoved=${legacyRemoved}, errors=${errors}. ` +
      'Read/archive state unchanged.'
    );
    return { changed, errors, skipped: false };
  } finally {
    executionLock.releaseLock();
  }
}

/** Read-only counts for targeted finance repairs and obsolete finance labels. */
function auditFinancialLabelRepair() {
  Logger.log('=== FINANCIAL LABEL REPAIR AUDIT (READ-ONLY) ===');
  FINANCIAL_INBOX_RULES.forEach(function (rule) {
    const otherLabelName = `${rule.label}/Otros`;
    if (!GmailApp.getUserLabelByName(otherLabelName)) return;
    rule.sublabels.filter(function (subcategory) {
      return !subcategory.fallback;
    }).forEach(function (subcategory) {
      const query = [
        `label:"${otherLabelName}"`,
        buildFinancialSublabelSubjectQuery(subcategory),
        '-in:spam',
        '-in:trash',
      ].join(' ');
      const count = subcategory.requiresStatementEvidence
        ? filterFinancialThreadsForSubcategory(
          GmailApp.search(query, 0, CONFIG.MAX_COUNT_PER_QUERY),
          subcategory
        ).length
        : countThreads(query, CONFIG.MAX_COUNT_PER_QUERY);
      if (count) Logger.log(`${rule.name}: Otros -> ${subcategory.name}: ${count}`);
    });
  });
  [
    {
      label: 'Auto/Review/Updates/Actionable',
      query: FINANCIAL_SENDER_QUERY,
    },
    {
      label: 'Auto/Priority/Finance',
      query: `${FINANCIAL_SENDER_QUERY} -${FINANCIAL_ACTION_REQUIRED_QUERY}`,
    },
  ].forEach(function (policy) {
    if (!GmailApp.getUserLabelByName(policy.label)) return;
    const query = `label:"${policy.label}" ${policy.query} -in:spam -in:trash`;
    const count = countThreads(query, CONFIG.MAX_COUNT_PER_QUERY);
    const capped = count >= CONFIG.MAX_COUNT_PER_QUERY ? '+' : '';
    Logger.log(`${policy.label}: ${count}${capped} obsolete financial assignment(s)`);
  });
  Logger.log('No labels or messages were changed.');
}

function buildFinancialTaxonomyMigrationMappings(migration) {
  const sourceParent = `Auto/Finance/${migration.source}`;
  const targetParent = `Auto/Finance/${migration.target}`;
  return FINANCIAL_SUBLABELS.map(function (subcategory) {
    return {
      source: `${sourceParent}/${subcategory.name}`,
      target: `${targetParent}/${subcategory.name}`,
      targetParent,
    };
  }).concat([{ source: sourceParent, target: targetParent, targetParent }]);
}

function listFinancialInstitutionLabelNames(labelNames, institutionName) {
  const parent = `Auto/Finance/${institutionName}`;
  return labelNames.filter(function (labelName) {
    return labelName === parent || labelName.indexOf(`${parent}/`) === 0;
  }).sort();
}

function buildFinancialInstitutionRehomeSourceLabelNames(policy) {
  if (!policy || !policy.source) return [];
  const parent = `Auto/Finance/${policy.source}`;
  return [parent].concat(FINANCIAL_SUBLABELS.map(function (subcategory) {
    return `${parent}/${subcategory.name}`;
  }));
}

/** Read-only inventory for query-scoped institution/product rehoming. */
function auditFinancialInstitutionRehomeAdHoc() {
  Logger.log('=== FINANCIAL INSTITUTION REHOME AUDIT (READ-ONLY) ===');
  const maximum = CONFIG.MAX_COUNT_PER_QUERY;
  FINANCIAL_INSTITUTION_REHOMES.forEach(function (policy) {
    const targetParent = `Auto/Finance/${policy.target}`;
    const total = countThreads(`${policy.query} -in:spam -in:trash`, maximum);
    const assigned = countThreads(
      `${policy.query} label:"${targetParent}" -in:spam -in:trash`,
      maximum
    );
    Logger.log(
      `${policy.target}: total=${total}, targetParent=${assigned}, missingParent=${total - assigned}`
    );
    buildFinancialInstitutionRehomeSourceLabelNames(policy).forEach(function (labelName) {
      const count = countThreads(
        `${policy.query} label:"${labelName}" -in:spam -in:trash`,
        maximum
      );
      if (count) Logger.log(`${labelName}: ${count} stale assignment(s)`);
    });
  });
  Logger.log('No labels or messages were changed.');
}

/**
 * Adds the exact target parent/child and removes only query-matched source
 * finance labels. Read, archive, spam, Trash, and all unrelated labels remain
 * untouched.
 */
function rehomeFinancialInstitutionsAdHoc() {
  if (
    !CONFIG.DRY_RUN &&
    CONFIG.FINANCIAL_INSTITUTION_REHOME_CONFIRMATION !== 'REHOME_AFORE_AND_INFONAVIT'
  ) {
    Logger.log('Financial institution rehome confirmation token missing. Nothing changed.');
    return { changed: 0, errors: 0, skipped: true };
  }

  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Financial institution rehome skipped — another mailbox execution is running.');
    return { changed: 0, errors: 0, skipped: true };
  }

  try {
    const rulesByInstitution = {};
    FINANCIAL_INBOX_RULES.forEach(function (rule) {
      rulesByInstitution[rule.name.replace(/^Bank\//, '')] = rule;
    });
    const labelsByName = {};
    GmailApp.getUserLabels().forEach(function (label) {
      labelsByName[label.getName()] = label;
    });
    let remaining = CONFIG.FINANCIAL_LABEL_REPAIR_BATCH_SIZE;
    let changed = 0;
    let errors = 0;

    FINANCIAL_INSTITUTION_REHOMES.forEach(function (policy) {
      if (remaining <= 0) return;
      const targetRule = rulesByInstitution[policy.target];
      if (!targetRule) {
        errors++;
        Logger.log(`Financial institution rehome missing target rule: ${policy.target}`);
        return;
      }
      const threads = GmailApp.search(
        `${policy.query} -in:spam -in:trash`,
        0,
        remaining
      );
      threads.forEach(function (thread) {
        if (remaining <= 0) return;
        try {
          const currentLabelNames = new Set(thread.getLabels().map(function (label) {
            return label.getName();
          }));
          const targetLabelNames = resolveInboxRuleLabelNames(
            targetRule,
            thread.getMessages(),
            false
          );
          const sourceLabelNames = buildFinancialInstitutionRehomeSourceLabelNames(policy)
            .filter(function (labelName) { return currentLabelNames.has(labelName); });
          const missingTargetNames = targetLabelNames.filter(function (labelName) {
            return !currentLabelNames.has(labelName);
          });
          if (!sourceLabelNames.length && !missingTargetNames.length) return;

          if (CONFIG.DRY_RUN) {
            Logger.log(
              `[DRY RUN] Would rehome subject=${thread.getFirstMessageSubject()} ` +
              `add=${missingTargetNames.join(', ') || 'none'} ` +
              `remove=${sourceLabelNames.join(', ') || 'none'}`
            );
          } else {
            missingTargetNames.forEach(function (labelName) {
              thread.addLabel(getOrCreateLabel(labelName));
            });
            sourceLabelNames.forEach(function (labelName) {
              const label = labelsByName[labelName];
              if (label) thread.removeLabel(label);
            });
          }
          changed++;
          remaining--;
        } catch (error) {
          errors++;
          Logger.log(
            `Financial institution rehome error for subject=${thread.getFirstMessageSubject()}: ` +
            error
          );
        }
      });
    });

    Logger.log(
      `Financial institution rehome complete — changed=${changed}, errors=${errors}. ` +
      'Read/archive state unchanged.'
    );
    return { changed, errors, skipped: false };
  } finally {
    executionLock.releaseLock();
  }
}

function countFinancialLabelThreadsForAudit(label, maximum) {
  if (!label) return 0;
  return label.getThreads(0, maximum).length;
}

/** Read-only preflight for the one-time GBM -> Mercado Pago label migration. */
function auditFinancialTaxonomyMigrationAdHoc() {
  Logger.log('=== FINANCIAL TAXONOMY MIGRATION AUDIT (READ-ONLY) ===');
  const labelsByName = {};
  GmailApp.getUserLabels().forEach(function (label) {
    labelsByName[label.getName()] = label;
  });
  const maximum = CONFIG.MAX_COUNT_PER_QUERY;

  FINANCIAL_LABEL_MIGRATIONS.forEach(function (migration) {
    buildFinancialTaxonomyMigrationMappings(migration).forEach(function (mapping) {
      const label = labelsByName[mapping.source];
      if (!label) return;
      const count = countFinancialLabelThreadsForAudit(label, maximum);
      const capped = count >= maximum ? '+' : '';
      Logger.log(`${mapping.source} -> ${mapping.target}: ${count}${capped} thread(s)`);
    });
  });

  FINANCIAL_RETIRED_INSTITUTIONS.forEach(function (institutionName) {
    const labelNames = listFinancialInstitutionLabelNames(
      Object.keys(labelsByName),
      institutionName
    );
    if (!labelNames.length) {
      Logger.log(`Retired label ${institutionName}: absent`);
      return;
    }
    labelNames.forEach(function (labelName) {
      const count = countFinancialLabelThreadsForAudit(labelsByName[labelName], maximum);
      const capped = count >= maximum ? '+' : '';
      Logger.log(`Retired label ${labelName}: ${count}${capped} thread(s)`);
    });
  });
  Logger.log('No labels or messages were changed.');
}

/**
 * Consolidates retired GBM labels into Mercado Pago in bounded label-only batches.
 * Unknown GBM children block the run instead of being guessed or discarded.
 */
function migrateFinancialTaxonomyAdHoc() {
  if (
    !CONFIG.DRY_RUN &&
    CONFIG.FINANCIAL_TAXONOMY_MIGRATION_CONFIRMATION !== 'MIGRATE_GBM_TO_MERCADO_PAGO'
  ) {
    Logger.log('Financial taxonomy migration confirmation token missing. Nothing changed.');
    return { changed: 0, errors: 0, skipped: true };
  }

  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Financial taxonomy migration skipped — another mailbox execution is running.');
    return { changed: 0, errors: 0, skipped: true };
  }

  try {
    const labelsByName = {};
    GmailApp.getUserLabels().forEach(function (label) {
      labelsByName[label.getName()] = label;
    });
    let remaining = CONFIG.FINANCIAL_LABEL_REPAIR_BATCH_SIZE;
    let changed = 0;
    let errors = 0;

    FINANCIAL_LABEL_MIGRATIONS.forEach(function (migration) {
      if (remaining <= 0) return;
      const mappings = buildFinancialTaxonomyMigrationMappings(migration);
      const allowedSources = new Set(mappings.map(function (mapping) {
        return mapping.source;
      }));
      const existingSourceNames = listFinancialInstitutionLabelNames(
        Object.keys(labelsByName),
        migration.source
      );
      const unknownSources = existingSourceNames.filter(function (labelName) {
        return !allowedSources.has(labelName);
      });
      if (unknownSources.length) {
        errors += unknownSources.length;
        Logger.log(
          `Financial taxonomy migration blocked by unknown ${migration.source} label(s): ` +
          unknownSources.join(', ')
        );
        return;
      }

      mappings.forEach(function (mapping) {
        if (remaining <= 0) return;
        const sourceLabel = labelsByName[mapping.source];
        if (!sourceLabel) return;
        const threads = sourceLabel.getThreads(
          0,
          Math.min(remaining, CONFIG.FINANCIAL_LABEL_REPAIR_BATCH_SIZE)
        );
        if (!threads.length) return;
        try {
          if (CONFIG.DRY_RUN) {
            Logger.log(
              `[DRY RUN] Would move ${threads.length} thread(s) from ` +
              `${mapping.source} to ${mapping.target}.`
            );
          } else {
            getOrCreateLabel(mapping.targetParent).addToThreads(threads);
            if (mapping.target !== mapping.targetParent) {
              getOrCreateLabel(mapping.target).addToThreads(threads);
            }
            sourceLabel.removeFromThreads(threads);
          }
          changed += threads.length;
          remaining -= threads.length;
        } catch (error) {
          errors += threads.length;
          Logger.log(
            `Financial taxonomy migration error for ${mapping.source} ` +
            `(${threads.length} thread(s)): ${error}`
          );
        }
      });
    });

    Logger.log(
      `Financial taxonomy migration complete — labelMoves=${changed}, errors=${errors}. ` +
      'Read/archive state unchanged.'
    );
    return { changed, errors, skipped: false };
  } finally {
    executionLock.releaseLock();
  }
}

function buildVerifiedFinancialCorrectionPolicies() {
  return [{
    source: 'Auto/Finance/Uala/Transacciones',
    target: 'Auto/Finance/Uala/Promociones y beneficios',
    parent: 'Auto/Finance/Uala',
    exactSubject: 'Cada transacción es una anotación.',
  }];
}

/** Read-only count of the exact, manually verified Ualá correction. */
function auditVerifiedFinancialCorrectionsAdHoc() {
  Logger.log('=== VERIFIED FINANCIAL CORRECTIONS AUDIT (READ-ONLY) ===');
  buildVerifiedFinancialCorrectionPolicies().forEach(function (policy) {
    const sourceLabel = GmailApp.getUserLabelByName(policy.source);
    if (!sourceLabel) {
      Logger.log(`${policy.source}: source label absent`);
      return;
    }
    const exactSubject = normalizeForMatching(policy.exactSubject);
    const count = sourceLabel.getThreads(0, CONFIG.MAX_COUNT_PER_QUERY).filter(function (thread) {
      return thread.getMessages().some(function (message) {
        return normalizeForMatching(message.getSubject()) === exactSubject;
      });
    }).length;
    Logger.log(`${policy.source} -> ${policy.target}: ${count} verified thread(s)`);
  });
  Logger.log('No labels or messages were changed.');
}

/** Applies only exact-subject corrections already verified by the live audit. */
function repairVerifiedFinancialCorrectionsAdHoc() {
  if (
    !CONFIG.DRY_RUN &&
    CONFIG.FINANCIAL_VERIFIED_CORRECTIONS_CONFIRMATION !== 'APPLY_VERIFIED_FINANCE_FIXES'
  ) {
    Logger.log('Verified financial correction token missing. Nothing changed.');
    return { changed: 0, errors: 0, skipped: true };
  }

  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Verified financial corrections skipped — another mailbox execution is running.');
    return { changed: 0, errors: 0, skipped: true };
  }

  try {
    let changed = 0;
    let errors = 0;
    buildVerifiedFinancialCorrectionPolicies().forEach(function (policy) {
      const sourceLabel = GmailApp.getUserLabelByName(policy.source);
      if (!sourceLabel) return;
      const exactSubject = normalizeForMatching(policy.exactSubject);
      const threads = sourceLabel.getThreads(0, CONFIG.FINANCIAL_LABEL_REPAIR_BATCH_SIZE)
        .filter(function (thread) {
          return thread.getMessages().some(function (message) {
            return normalizeForMatching(message.getSubject()) === exactSubject;
          });
        });
      if (!threads.length) return;
      try {
        if (CONFIG.DRY_RUN) {
          Logger.log(
            `[DRY RUN] Would move ${threads.length} verified thread(s) from ` +
            `${policy.source} to ${policy.target}.`
          );
        } else {
          getOrCreateLabel(policy.parent).addToThreads(threads);
          getOrCreateLabel(policy.target).addToThreads(threads);
          sourceLabel.removeFromThreads(threads);
        }
        changed += threads.length;
      } catch (error) {
        errors += threads.length;
        Logger.log(
          `Verified financial correction error for ${policy.source} ` +
          `(${threads.length} thread(s)): ${error}`
        );
      }
    });
    Logger.log(
      `Verified financial corrections complete — changed=${changed}, errors=${errors}. ` +
      'Read/archive state unchanged.'
    );
    return { changed, errors, skipped: false };
  } finally {
    executionLock.releaseLock();
  }
}

/**
 * Deletes only empty labels retired from the finance taxonomy. This must run
 * after migration and is independently confirmation-gated.
 */
function deleteRetiredFinancialLabelsAdHoc() {
  if (
    !CONFIG.DRY_RUN &&
    CONFIG.FINANCIAL_RETIRED_LABEL_DELETION_CONFIRMATION !== 'DELETE_EMPTY_RETIRED_FINANCE_LABELS'
  ) {
    Logger.log('Retired finance label deletion token missing. Nothing changed.');
    return { deleted: 0, blockers: 0, errors: 0, skipped: true };
  }

  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Retired finance label deletion skipped — another mailbox execution is running.');
    return { deleted: 0, blockers: 0, errors: 0, skipped: true };
  }

  try {
    const labelsByName = {};
    GmailApp.getUserLabels().forEach(function (label) {
      labelsByName[label.getName()] = label;
    });
    let retiredLabelNames = [];
    FINANCIAL_RETIRED_INSTITUTIONS.forEach(function (institutionName) {
      retiredLabelNames = retiredLabelNames.concat(listFinancialInstitutionLabelNames(
        Object.keys(labelsByName),
        institutionName
      ));
    });
    const blockers = retiredLabelNames.filter(function (labelName) {
      return labelsByName[labelName].getThreads(0, 1).length > 0;
    });
    if (blockers.length) {
      Logger.log(
        'Retired finance label deletion blocked; non-empty label(s): ' + blockers.join(', ')
      );
      return { deleted: 0, blockers: blockers.length, errors: 0, skipped: true };
    }

    retiredLabelNames.sort(function (left, right) {
      const depthDifference = right.split('/').length - left.split('/').length;
      return depthDifference || left.localeCompare(right);
    });
    let deleted = 0;
    let errors = 0;
    retiredLabelNames.forEach(function (labelName) {
      try {
        if (CONFIG.DRY_RUN) {
          Logger.log(`[DRY RUN] Would delete empty retired label ${labelName}.`);
        } else {
          labelsByName[labelName].deleteLabel();
        }
        deleted++;
      } catch (error) {
        errors++;
        Logger.log(`Retired finance label deletion error for ${labelName}: ${error}`);
      }
    });
    Logger.log(
      `Retired finance label deletion complete — deleted=${deleted}, errors=${errors}. ` +
      'Messages and read/archive state unchanged.'
    );
    return { deleted, blockers: 0, errors, skipped: false };
  } finally {
    executionLock.releaseLock();
  }
}

/** Runs repair first, then backfill, and removes the trigger after both finish. */
function runScheduledFinancialSublabelBackfill() {
  const repairResult = repairFinancialLabels();
  if (!repairResult || repairResult.skipped) return;
  if (repairResult.changed > 0 || repairResult.errors > 0) return;

  const result = backfillFinancialSublabels();
  if (!result || result.skipped) return;

  if (result.labelled === 0 && result.errors === 0) {
    removeFinancialSublabelBackfillSchedule();
    Logger.log('Financial sublabel backfill is complete; temporary trigger removed.');
  }
}

/** Installs one idempotent minute-based trigger using the configured interval. */
function installFinancialSublabelBackfillSchedule() {
  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY RUN] Financial backfill trigger was not created.');
    return;
  }
  if (CONFIG.FINANCIAL_SUBLABEL_BACKFILL_CONFIRMATION !== 'APPLY_FINANCIAL_SUBLABELS') {
    Logger.log('Financial sublabel confirmation token missing. Trigger was not created.');
    return;
  }

  const handler = 'runScheduledFinancialSublabelBackfill';
  const alreadyInstalled = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === handler;
  });
  if (alreadyInstalled) {
    Logger.log('Financial sublabel backfill trigger is already installed.');
    return;
  }

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyMinutes(CONFIG.FINANCIAL_SUBLABEL_BACKFILL_INTERVAL_MINUTES)
    .create();
  Logger.log(
    `Installed financial sublabel backfill trigger every ` +
    `${CONFIG.FINANCIAL_SUBLABEL_BACKFILL_INTERVAL_MINUTES} minute(s).`
  );
}

/** Removes only the temporary financial backfill trigger. */
function removeFinancialSublabelBackfillSchedule() {
  const handler = 'runScheduledFinancialSublabelBackfill';
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  Logger.log(`Removed ${removed} financial sublabel backfill trigger(s).`);
}

function buildFinancialSublabelBackfillQuery(rule) {
  const queryParts = [
    rule.query,
    `newer_than:${CONFIG.FINANCIAL_SUBLABEL_BACKFILL_LOOKBACK_DAYS}d`,
    '-in:spam',
    '-in:trash',
  ];
  rule.sublabels.forEach(function (subcategory) {
    const childLabelName = `${rule.label}/${subcategory.name}`;
    if (GmailApp.getUserLabelByName(childLabelName)) {
      queryParts.push(`-label:"${childLabelName}"`);
    }
  });
  return queryParts.join(' ');
}

/** Uses Gmail's subject index so historical classification needs no per-thread reads. */
function buildFinancialSublabelSearchQuery(rule, subcategory) {
  const baseQuery = buildFinancialSublabelBackfillQuery(rule);
  if (subcategory.fallback) return baseQuery;
  return `${baseQuery} ${buildFinancialSublabelSubjectQuery(subcategory)}`;
}

/** Keeps historical Gmail queries below practical length limits. */
function buildFinancialSublabelSearchQueries(rule, subcategory) {
  const baseQuery = buildFinancialSublabelBackfillQuery(rule);
  if (subcategory.fallback) return [baseQuery];
  const terms = expandFinancialSearchPhrases(subcategory.phrases).map(function (phrase) {
    return `subject:"${phrase}"`;
  });
  const groups = [];
  let current = [];
  let currentLength = 0;
  terms.forEach(function (term) {
    if (current.length && currentLength + term.length + 1 > 500) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(term);
    currentLength += term.length + 1;
  });
  if (current.length) groups.push(current);
  return groups.map(function (group) {
    return `${baseQuery} {${group.join(' ')}}`;
  });
}

function buildFinancialSublabelSubjectQuery(subcategory) {
  const subjectQuery = expandFinancialSearchPhrases(subcategory.phrases).map(function (phrase) {
    return `subject:"${phrase}"`;
  }).join(' ');
  return `{${subjectQuery}}`;
}

/** Read-only counts for each historical Inbox drain policy. */
function auditInboxBacklog() {
  Logger.log('=== INBOX BACKLOG AUDIT (READ-ONLY) ===');
  CONFIG.INBOX_BACKLOG_POLICIES.forEach(function (policy) {
    const query = buildInboxBacklogQuery(policy);
    if (!query) {
      Logger.log(`${policy.name}: source label does not exist yet`);
      return;
    }
    const count = countThreads(query, CONFIG.MAX_COUNT_PER_QUERY);
    const capped = count >= CONFIG.MAX_COUNT_PER_QUERY ? '+' : '';
    Logger.log(`${policy.name}: ${count}${capped} staged-archive candidate(s)`);
    Logger.log(`  ${query}`);
  });
  Logger.log('No labels, read state, archive state, or messages were changed.');
}

/**
 * Labels and archives historical Inbox records in protected batches. This is
 * reversible and never sends anything to Trash. A confirmation token is still
 * required outside DRY_RUN because mark-read and archive are mailbox writes.
 */
function stageInboxBacklog() {
  if (!CONFIG.DRY_RUN && CONFIG.INBOX_BACKLOG_CONFIRMATION !== 'ARCHIVE_INBOX_BACKLOG') {
    Logger.log('Backlog confirmation token missing. Nothing changed.');
    return;
  }

  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Backlog staging skipped — another mailbox execution is running.');
    return;
  }

  try {
    let archived = 0;
    let markedRead = 0;
    let protectedCount = 0;
    let errors = 0;

    CONFIG.INBOX_BACKLOG_POLICIES.forEach(function (policy) {
      const query = buildInboxBacklogQuery(policy);
      if (!query) return;
      const threads = GmailApp.search(query, 0, CONFIG.INBOX_BACKLOG_BATCH_SIZE);
      const stageLabel = CONFIG.DRY_RUN ? null : getOrCreateLabel(policy.label);

      threads.forEach(function (thread) {
        try {
          const messages = thread.getMessages();
          const unsafe = threadHasRealAttachments(messages) ||
            isThreadProtected(thread, messages) ||
            threadHasAutomationProtectedSender(messages) ||
            (
              !policy.allowProtectedContentArchive &&
              threadHasAutomationProtectedContent(messages)
            );
          if (unsafe) {
            protectedCount++;
            Logger.log(`[PROTECTED] Backlog kept in Inbox: ${thread.getFirstMessageSubject()}`);
            return;
          }

          if (CONFIG.DRY_RUN) {
            Logger.log(`[DRY RUN] Would stage/archive ${policy.name}: ${thread.getFirstMessageSubject()}`);
          } else {
            thread.addLabel(stageLabel);
            if (policy.markRead) {
              thread.markRead();
              markedRead++;
            }
            thread.moveToArchive();
          }
          archived++;
        } catch (error) {
          errors++;
          Logger.log(`Backlog staging error for thread ${thread.getId()}: ${error}`);
        }
      });
    });

    Logger.log(
      `Backlog staging complete — archived=${archived}, markedRead=${markedRead}, ` +
      `protected/skipped=${protectedCount}, errors=${errors}. Nothing was trashed.`
    );
  } finally {
    executionLock.releaseLock();
  }
}

/** Builds a backlog policy query and skips policies whose source label is absent. */
function buildInboxBacklogQuery(policy) {
  const queryParts = [policy.query, '-in:spam', '-in:trash'];
  if (policy.requiredSourceLabel) {
    if (!GmailApp.getUserLabelByName(policy.requiredSourceLabel)) return '';
    queryParts.push(`label:"${policy.requiredSourceLabel}"`);
  }
  if (GmailApp.getUserLabelByName(policy.label)) {
    queryParts.push(`-label:"${policy.label}"`);
  }
  return queryParts.join(' ');
}

/** Read-only counts for mail old enough to expire under each retention policy. */
function auditInboxRuleRetention() {
  Logger.log('=== INBOX RULE RETENTION AUDIT (READ-ONLY) ===');
  CONFIG.RULE_RETENTION_POLICIES.forEach(function (policy) {
    if (!GmailApp.getUserLabelByName(policy.label)) {
      Logger.log(`${policy.label}: label does not exist yet`);
      return;
    }
    const query = buildRetentionQuery(policy.label, policy.olderThanDays);
    const count = countThreads(query, CONFIG.MAX_COUNT_PER_QUERY);
    const capped = count >= CONFIG.MAX_COUNT_PER_QUERY ? '+' : '';
    Logger.log(`${policy.label}: ${count}${capped} safe-shape expiration candidate(s)`);
  });
  Logger.log(`Automatic retention Trash enabled: ${CONFIG.ENABLE_RULE_RETENTION_TRASH}`);
}

/**
 * Moves expired low-value threads to Trash in small batches. Disabled by default
 * and protected again at runtime against attachments, protected senders/threads.
 */
function purgeExpiredInboxRuleMail() {
  if (!CONFIG.ENABLE_RULE_RETENTION_TRASH) {
    Logger.log('Retention Trash is disabled. Review auditInboxRuleRetention(), then enable it deliberately.');
    return;
  }

  let trashed = 0;
  let protectedCount = 0;
  CONFIG.RULE_RETENTION_POLICIES.forEach(function (policy) {
    if (!GmailApp.getUserLabelByName(policy.label)) return;
    const result = trashSafeRuleThreads(
      buildRetentionQuery(policy.label, policy.olderThanDays),
      CONFIG.RULE_RETENTION_BATCH_SIZE
    );
    trashed += result.trashed;
    protectedCount += result.protected;
  });
  Logger.log(`Retention complete — trashed=${trashed}, protected/skipped=${protectedCount}.`);
}

/**
 * Empties one configured Auto/LowValue label in protected batches. Requires an
 * exact confirmation token and still refuses attachments/protected mail.
 */
function emptyConfiguredLowValueLabel() {
  if (CONFIG.EMPTY_LOW_VALUE_CONFIRMATION !== 'TRASH_LOW_VALUE_LABEL') {
    Logger.log('Confirmation token missing. Nothing changed.');
    return;
  }
  const labelName = String(CONFIG.LOW_VALUE_LABEL_TO_EMPTY || '');
  if (!labelName.startsWith('Auto/LowValue/')) {
    Logger.log('Only labels below Auto/LowValue/ may be emptied by this function.');
    return;
  }
  if (!GmailApp.getUserLabelByName(labelName)) {
    Logger.log(`Label "${labelName}" does not exist. Nothing changed.`);
    return;
  }

  const query = [
    `label:"${labelName}"`,
    '-has:attachment',
    '-is:starred',
    '-is:important',
    '-in:spam',
    '-in:trash',
  ].join(' ');
  const result = trashSafeRuleThreads(query, CONFIG.RULE_RETENTION_BATCH_SIZE);
  Logger.log(`Label empty batch — trashed=${result.trashed}, protected/skipped=${result.protected}.`);
}

/** Runtime-protected Trash operation shared by retention and manual emptying. */
function trashSafeRuleThreads(query, maxThreads) {
  const threads = GmailApp.search(query, 0, maxThreads);
  const result = { trashed: 0, protected: 0 };
  threads.forEach(function (thread) {
    const messages = thread.getMessages();
    if (
      threadHasRealAttachments(messages) ||
      isThreadProtected(thread, messages) ||
      threadHasAutomationProtectedSender(messages) ||
      threadHasAutomationProtectedContent(messages)
    ) {
      result.protected++;
      Logger.log(`[PROTECTED] Not trashed: ${thread.getFirstMessageSubject()}`);
      return;
    }
    if (CONFIG.DRY_RUN) {
      Logger.log(`[DRY RUN] Would trash: ${thread.getFirstMessageSubject()}`);
    } else {
      thread.moveToTrash();
    }
    result.trashed++;
  });
  return result;
}

function buildRetentionQuery(labelName, olderThanDays) {
  return [
    `label:"${labelName}"`,
    `older_than:${olderThanDays}d`,
    '-has:attachment',
    '-is:starred',
    '-is:important',
    '-in:spam',
    '-in:trash',
  ].join(' ');
}

/** Installs idempotent hourly classification and optional daily retention triggers. */
function installInboxAutomation() {
  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY RUN] Triggers were not created.');
    return;
  }
  const existingHandlers = new Set(
    ScriptApp.getProjectTriggers().map(function (trigger) { return trigger.getHandlerFunction(); })
  );
  if (!existingHandlers.has('runInboxRules')) {
    ScriptApp.newTrigger('runInboxRules').timeBased().everyHours(1).create();
    Logger.log('Installed hourly runInboxRules trigger.');
  }
  if (CONFIG.ENABLE_RULE_RETENTION_TRASH && !existingHandlers.has('purgeExpiredInboxRuleMail')) {
    ScriptApp.newTrigger('purgeExpiredInboxRuleMail').timeBased().everyDays(1).atHour(3).create();
    Logger.log('Installed daily purgeExpiredInboxRuleMail trigger.');
  }
}

/** Removes only triggers owned by this inbox automation module. */
function removeInboxAutomation() {
  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY RUN] Triggers were not removed.');
    return;
  }
  const ownedHandlers = new Set(['runInboxRules', 'purgeExpiredInboxRuleMail']);
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (ownedHandlers.has(trigger.getHandlerFunction())) ScriptApp.deleteTrigger(trigger);
  });
  Logger.log('Inbox automation triggers removed.');
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildInboxRuleQuery,
    isInboxRuleArchiveEnabled,
    resolveInboxRuleLabelNames,
    financialMessageHasStatementDocument,
    financialThreadHasStatementEvidence,
    filterFinancialThreadsForSubcategory,
    threadHasMessageInsideMinimumAge,
    buildInboxBacklogQuery,
    buildFinancialSublabelBackfillQuery,
    buildFinancialSublabelSearchQuery,
    buildFinancialSublabelSearchQueries,
    buildFinancialSublabelSubjectQuery,
    buildFinancialTaxonomyMigrationMappings,
    listFinancialInstitutionLabelNames,
    buildFinancialInstitutionRehomeSourceLabelNames,
    buildVerifiedFinancialCorrectionPolicies,
  };
}
