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
    rule.requiresRecordArchiveEnabled &&
    !CONFIG.ENABLE_INBOX_RECORD_ARCHIVE &&
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
  return !!rule.archive && (
    !rule.requiresRecordArchiveEnabled || CONFIG.ENABLE_INBOX_RECORD_ARCHIVE
  );
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
      const count = countThreads(query, CONFIG.MAX_COUNT_PER_QUERY);
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

// =============================================================================
// HISTORICAL CATEGORY BACKFILL
// This lane never changes the hourly runInboxRules selection window. It labels
// historical candidates first; only reviewed Promotions may later archive.
// =============================================================================

/** Builds the pending historical query. Labels make each batch idempotent. */
function buildHistoricalInboxBackfillQuery(policy, includeCompleted) {
  const queryParts = [policy.query, '-in:spam', '-in:trash'];
  const policies = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES || [];

  if (policy.fallback) {
    policies.filter(function (candidate) { return !candidate.fallback; }).forEach(function (candidate) {
      queryParts.push(`-label:"${candidate.label}"`);
    });
  }
  if (policy.protectConversationSignals) {
    queryParts.push(
      `-label:"${CONFIG.HISTORICAL_INBOX_BACKFILL_PROTECTED_LABEL}"`
    );
  }
  if (!includeCompleted) queryParts.push(`-label:"${policy.label}"`);
  return queryParts.join(' ');
}

/** Indexed approximation used to quantify attachment/star/importance exclusions. */
function buildHistoricalInboxBackfillSafeShapeQuery(policy) {
  return [
    buildHistoricalInboxBackfillQuery(policy, false),
    '-has:attachment',
    '-is:starred',
    '-is:important',
  ].join(' ');
}

/**
 * Ensures Gmail renders a historical review label as a hierarchy. Creating
 * parents first also repairs a previously created slash-delimited leaf label.
 */
function getOrCreateHistoricalReviewLabel(labelName) {
  const segments = String(labelName || '').split('/').filter(Boolean);
  let path = '';
  let label = null;
  segments.forEach(function (segment) {
    path = path ? `${path}/${segment}` : segment;
    label = getOrCreateLabel(path);
  });
  return label;
}

/** True when a subject or sender signals a person, recruiter, invitation, or reply. */
function isHistoricalConversationSubjectProtected(messages) {
  const subjectPhrases = CONFIG.HISTORICAL_SOCIAL_PROTECTED_SUBJECT_PHRASES || [];
  const senderPhrases = CONFIG.HISTORICAL_CONVERSATION_PROTECTED_SENDER_PHRASES || [];
  return (messages || []).some(function (message) {
    const subject = message && typeof message.getSubject === 'function'
      ? message.getSubject()
      : '';
    const from = message && typeof message.getFrom === 'function'
      ? message.getFrom()
      : '';
    const normalizedSubject = normalizeForMatching(subject);
    const normalizedFrom = normalizeForMatching(from);
    return subjectPhrases.some(function (phrase) {
      return normalizedSubject.indexOf(normalizeForMatching(phrase)) !== -1;
    }) || senderPhrases.some(function (phrase) {
      return normalizedFrom.indexOf(normalizeForMatching(phrase)) !== -1;
    });
  });
}

/** Backward-compatible name retained for existing tests and operational notes. */
function isHistoricalSocialSubjectProtected(messages) {
  return isHistoricalConversationSubjectProtected(messages);
}

function shouldRouteHistoricalThreadToProtectedLabel(policy, exclusion) {
  return !!(policy && policy.protectConversationSignals && exclusion);
}

/** Returns the first safety reason that blocks archival, or an empty string. */
function getHistoricalInboxBackfillExclusion(thread, messages, policy) {
  if (threadHasRealAttachments(messages)) return 'real_attachment';
  if (isThreadProtected(thread, messages)) return 'starred_important_or_sent_thread';
  if (threadHasAutomationProtectedSender(messages)) return 'protected_sender';
  if (threadHasAutomationProtectedContent(messages)) return 'protected_content';
  if (
    policy.protectConversationSignals &&
    isHistoricalConversationSubjectProtected(messages)
  ) {
    return 'personal_recruiter_invitation_or_reply_signal';
  }
  return '';
}

/**
 * Logs category counts and representative samples without changing Gmail.
 * Candidate counts are capped; sample exclusions use the same runtime checks
 * that the batch uses before deciding whether Promotions may be archived.
 */
function auditHistoricalInboxBackfill() {
  Logger.log('=== HISTORICAL INBOX BACKFILL AUDIT (READ-ONLY) ===');
  const sampleSize = CONFIG.HISTORICAL_INBOX_BACKFILL_AUDIT_SAMPLE_SIZE;
  CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES.forEach(function (policy) {
    const totalQuery = buildHistoricalInboxBackfillQuery(policy, true);
    const pendingQuery = buildHistoricalInboxBackfillQuery(policy, false);
    const safeShapeQuery = buildHistoricalInboxBackfillSafeShapeQuery(policy);
    const total = countThreads(totalQuery, CONFIG.MAX_COUNT_PER_QUERY);
    const pending = countThreads(pendingQuery, CONFIG.MAX_COUNT_PER_QUERY);
    const safeShape = countThreads(safeShapeQuery, CONFIG.MAX_COUNT_PER_QUERY);
    const cap = CONFIG.MAX_COUNT_PER_QUERY;
    Logger.log(`${policy.name}: total=${total}${total >= cap ? '+' : ''}, ` +
      `pending=${pending}${pending >= cap ? '+' : ''}, ` +
      `safe-shape=${safeShape}${safeShape >= cap ? '+' : ''}; archive=${
        policy.archive && CONFIG.HISTORICAL_INBOX_BACKFILL_ARCHIVE_PROMOTIONS
      }`);
    Logger.log(`  ${pendingQuery}`);

    const samples = GmailApp.search(pendingQuery, 0, sampleSize);
    samples.forEach(function (thread) {
      const messages = thread.getMessages();
      const exclusion = getHistoricalInboxBackfillExclusion(thread, messages, policy);
      const protectedThread = shouldRouteHistoricalThreadToProtectedLabel(policy, exclusion);
      Logger.log(
        `  [SAMPLE ${protectedThread ? `PROTECTED:${exclusion}` :
          (exclusion ? `EXCLUDE:${exclusion}` : 'archive-eligible')}] ` +
        `${thread.getFirstMessageSubject()}`
      );
    });
  });
  Logger.log('No labels, read state, archive state, triggers, or messages were changed.');
}

function getHistoricalInboxBackfillState() {
  const propertyName = CONFIG.HISTORICAL_INBOX_BACKFILL_STATE_PROPERTY;
  const raw = PropertiesService.getScriptProperties().getProperty(propertyName);
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      policyIndex: Math.max(0, Number(parsed.policyIndex) || 0),
      emptyPolicies: Math.max(0, Number(parsed.emptyPolicies) || 0),
      hadErrors: !!parsed.hadErrors,
    };
  } catch (error) {
    Logger.log(`Historical backfill state was invalid and will be reset: ${error}`);
    return { policyIndex: 0, emptyPolicies: 0, hadErrors: false };
  }
}

/** Resolves either the durable cursor policy or an explicitly pinned manual policy. */
function selectHistoricalInboxBackfillPolicy(policies, state, activePolicyName) {
  const requestedName = String(activePolicyName || '').trim();
  if (!requestedName) {
    const policyIndex = state.policyIndex % policies.length;
    return { policy: policies[policyIndex], policyIndex, pinned: false };
  }
  const policyIndex = policies.findIndex(function (policy) {
    return policy.name === requestedName;
  });
  return {
    policy: policyIndex >= 0 ? policies[policyIndex] : null,
    policyIndex,
    pinned: true,
  };
}

function isHistoricalInboxBackfillSelectionAllowed(selection, allowUnpinned) {
  return !!(selection && selection.policy && (selection.pinned || allowUnpinned));
}

function saveHistoricalInboxBackfillState(state) {
  PropertiesService.getScriptProperties().setProperty(
    CONFIG.HISTORICAL_INBOX_BACKFILL_STATE_PROPERTY,
    JSON.stringify(state)
  );
}

/** Clears only the historical category-backfill cursor; it does not alter Gmail. */
function resetHistoricalInboxBackfillState() {
  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY RUN] Historical inbox backfill state was not cleared.');
    return;
  }
  PropertiesService.getScriptProperties().deleteProperty(
    CONFIG.HISTORICAL_INBOX_BACKFILL_STATE_PROPERTY
  );
  Logger.log('Historical inbox backfill state was cleared. No Gmail messages changed.');
}

/**
 * Runs one locked, bounded historical category batch. Every selected thread is
 * first given a review label, which acts as the durable cursor. Promotions may
 * archive only after both an explicit token and the reviewed archive flag.
 */
function backfillHistoricalInbox(options) {
  if (
    !CONFIG.DRY_RUN &&
    CONFIG.HISTORICAL_INBOX_BACKFILL_CONFIRMATION !== 'APPLY_HISTORICAL_INBOX_BACKFILL'
  ) {
    Logger.log('Historical inbox backfill confirmation token missing. Nothing changed.');
    return { skipped: true, labelled: 0, archived: 0, errors: 0, empty: false };
  }

  const policies = CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES || [];
  if (!policies.length) {
    Logger.log('No historical inbox backfill policies are configured.');
    return { skipped: true, labelled: 0, archived: 0, errors: 0, empty: true };
  }

  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Historical inbox backfill skipped — another mailbox execution is running.');
    return { skipped: true, labelled: 0, archived: 0, errors: 0, empty: false };
  }

  try {
    const state = getHistoricalInboxBackfillState();
    const selection = selectHistoricalInboxBackfillPolicy(
      policies,
      state,
      CONFIG.HISTORICAL_INBOX_BACKFILL_ACTIVE_POLICY_NAME
    );
    const allowUnpinned = !!(options && options.allowUnpinned === true);
    if (!isHistoricalInboxBackfillSelectionAllowed(selection, allowUnpinned)) {
      Logger.log(
        selection.policy
          ? 'Manual historical inbox backfill requires an explicit active policy. Nothing changed.'
          : 'Historical inbox backfill active policy is invalid. Nothing changed.'
      );
      return { skipped: true, labelled: 0, archived: 0, errors: 0, empty: false };
    }
    const policyIndex = selection.policyIndex;
    const policy = selection.policy;
    const query = buildHistoricalInboxBackfillQuery(policy, false);
    const threads = GmailApp.search(query, 0, CONFIG.HISTORICAL_INBOX_BACKFILL_BATCH_SIZE);
    let labelled = 0;
    let archived = 0;
    let errors = 0;
    const startTime = Date.now();
    let stageLabel = null;
    let protectedLabel = null;
    let protectedThreads = 0;

    threads.forEach(function (thread) {
      if (Date.now() - startTime > 4.5 * 60 * 1000) return;
      try {
        const messages = thread.getMessages();
        const exclusion = getHistoricalInboxBackfillExclusion(thread, messages, policy);
        const protectedThread = shouldRouteHistoricalThreadToProtectedLabel(policy, exclusion);
        if (CONFIG.DRY_RUN) {
          if (protectedThread) {
            Logger.log(`[DRY RUN] Would route ${policy.name} to the protected label; ` +
              `reason=${exclusion}: ` +
              thread.getFirstMessageSubject());
            protectedThreads++;
          } else {
            Logger.log(`[DRY RUN] Would label ${policy.name}; exclusion=${exclusion || 'none'}: ` +
              thread.getFirstMessageSubject());
            labelled++;
          }
        } else {
          if (protectedThread) {
            protectedLabel = protectedLabel ||
              getOrCreateHistoricalReviewLabel(
                CONFIG.HISTORICAL_INBOX_BACKFILL_PROTECTED_LABEL
              );
            thread.addLabel(protectedLabel);
            protectedThreads++;
          } else {
            stageLabel = stageLabel || getOrCreateHistoricalReviewLabel(policy.label);
            thread.addLabel(stageLabel);
            if (
              policy.archive &&
              CONFIG.HISTORICAL_INBOX_BACKFILL_ARCHIVE_PROMOTIONS &&
              !exclusion
            ) {
              thread.moveToArchive();
              archived++;
            }
            labelled++;
          }
        }
      } catch (error) {
        errors++;
        Logger.log(`Historical backfill error for ${policy.name}/${thread.getId()}: ${error}`);
      }
    });

    const wasEmpty = threads.length === 0;
    const nextState = {
      policyIndex: selection.pinned ? policyIndex : (policyIndex + 1) % policies.length,
      emptyPolicies: selection.pinned ? 0 : (wasEmpty ? state.emptyPolicies + 1 : 0),
      hadErrors: selection.pinned ? errors > 0 : (state.hadErrors || errors > 0),
    };
    const cleanEmptyScan = !selection.pinned && wasEmpty && nextState.emptyPolicies >= policies.length;
    const empty = cleanEmptyScan && !nextState.hadErrors;
    if (cleanEmptyScan && nextState.hadErrors) {
      // Require one further all-empty cycle after an error before a temporary
      // trigger may remove itself.
      nextState.emptyPolicies = 0;
      nextState.hadErrors = false;
    }
    if (!CONFIG.DRY_RUN) saveHistoricalInboxBackfillState(nextState);
    Logger.log(
      `Historical inbox backfill ${policy.name} — staged=${labelled}, ` +
      `protected=${protectedThreads}, archived=${archived}, ` +
      `errors=${errors}, emptyCycle=${empty}. Nothing was trashed.`
    );
    return {
      skipped: false,
      labelled,
      protectedThreads,
      archived,
      errors,
      empty,
    };
  } finally {
    executionLock.releaseLock();
  }
}

/** Builds the exact source-label query used by the read-only staging repair audit. */
function buildHistoricalStagingLabelRepairQuery(policy) {
  return `label:"${policy.label}" -in:spam -in:trash`;
}

function getHistoricalProtectedPolicies() {
  return (CONFIG.HISTORICAL_INBOX_BACKFILL_POLICIES || []).filter(function (policy) {
    return policy.protectConversationSignals;
  });
}

/**
 * Audits historical threads that now fail any Promotions/Social safety gate.
 * The matching predicate is identical to the future backfill and changes no mail.
 */
function auditHistoricalStagingLabelRepair() {
  Logger.log('=== HISTORICAL STAGING LABEL REPAIR AUDIT (READ-ONLY) ===');
  const batchSize = CONFIG.HISTORICAL_INBOX_BACKFILL_LABEL_REPAIR_BATCH_SIZE;
  getHistoricalProtectedPolicies().forEach(function (policy) {
    const query = buildHistoricalStagingLabelRepairQuery(policy);
    const total = countThreads(query, CONFIG.MAX_COUNT_PER_QUERY);
    const threads = GmailApp.search(query, 0, batchSize);
    let matching = 0;
    let errors = 0;
    threads.forEach(function (thread) {
      try {
        const messages = thread.getMessages();
        if (getHistoricalInboxBackfillExclusion(thread, messages, policy)) matching++;
      } catch (error) {
        errors++;
        Logger.log(`Historical staging repair audit error for ${policy.name}: ${error}`);
      }
    });
    Logger.log(
      `${policy.name}: staged=${total}${total >= CONFIG.MAX_COUNT_PER_QUERY ? '+' : ''}, ` +
      `inspected=${threads.length}, matching=${matching}, errors=${errors}`
    );
    Logger.log(`  ${query}`);
  });
  Logger.log('No labels, read state, archive state, triggers, or messages were changed.');
}

/**
 * Rehomes only threads that fail the current Promotions/Social safety gates
 * from their staging labels to a neutral protected label. Mail state is untouched.
 */
function repairHistoricalStagingLabels() {
  if (
    !CONFIG.DRY_RUN &&
    CONFIG.HISTORICAL_INBOX_BACKFILL_LABEL_REPAIR_CONFIRMATION !==
      'REPAIR_HISTORICAL_STAGING_LABELS'
  ) {
    Logger.log('Historical staging label repair token missing. Nothing changed.');
    return { skipped: true, reclassified: 0, errors: 0 };
  }

  const executionLock = LockService.getScriptLock();
  if (!executionLock.tryLock(5000)) {
    Logger.log('Historical staging label repair skipped — another mailbox execution is running.');
    return { skipped: true, reclassified: 0, errors: 0 };
  }

  try {
    let reclassified = 0;
    let errors = 0;
    let protectedLabel = null;
    const batchSize = CONFIG.HISTORICAL_INBOX_BACKFILL_LABEL_REPAIR_BATCH_SIZE;
    getHistoricalProtectedPolicies().forEach(function (policy) {
      const sourceLabel = GmailApp.getUserLabelByName(policy.label);
      if (!sourceLabel) return;
      const threads = GmailApp.search(
        buildHistoricalStagingLabelRepairQuery(policy),
        0,
        batchSize
      );
      threads.forEach(function (thread) {
        try {
          const messages = thread.getMessages();
          const exclusion = getHistoricalInboxBackfillExclusion(thread, messages, policy);
          if (!exclusion) return;
          if (CONFIG.DRY_RUN) {
            Logger.log(`[DRY RUN] Would rehome protected thread from ${policy.name}; ` +
              `reason=${exclusion}: ` +
              thread.getFirstMessageSubject());
          } else {
            protectedLabel = protectedLabel || getOrCreateHistoricalReviewLabel(
              CONFIG.HISTORICAL_INBOX_BACKFILL_PROTECTED_LABEL
            );
            thread.addLabel(protectedLabel);
            sourceLabel.removeFromThreads([thread]);
          }
          reclassified++;
        } catch (error) {
          errors++;
          Logger.log(`Historical staging label repair error for ${policy.name}: ${error}`);
        }
      });
    });
    Logger.log(
      `Historical staging label repair complete — reclassified=${reclassified}, ` +
      `errors=${errors}. Read/archive state unchanged; nothing was trashed.`
    );
    return { skipped: false, reclassified, errors };
  } finally {
    executionLock.releaseLock();
  }
}

function shouldRemoveHistoricalInboxBackfillSchedule(result, dryRun) {
  return !!(
    !dryRun &&
    result &&
    !result.skipped &&
    result.empty &&
    result.errors === 0
  );
}

/** Runs the temporary worker and removes only its own trigger after a clean empty cycle. */
function runScheduledHistoricalInboxBackfill() {
  if (String(CONFIG.HISTORICAL_INBOX_BACKFILL_ACTIVE_POLICY_NAME || '').trim()) {
    Logger.log('Scheduled historical backfill requires an empty active-policy pin. Nothing changed.');
    return;
  }
  const result = backfillHistoricalInbox({ allowUnpinned: true });
  if (shouldRemoveHistoricalInboxBackfillSchedule(result, CONFIG.DRY_RUN)) {
    removeHistoricalInboxBackfillSchedule();
    Logger.log('Historical inbox backfill is complete; temporary trigger removed.');
  }
}

/** Installs the independent ten-minute historical-backfill worker. */
function installHistoricalInboxBackfillSchedule() {
  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY RUN] Historical inbox backfill trigger was not created.');
    return;
  }
  if (CONFIG.HISTORICAL_INBOX_BACKFILL_CONFIRMATION !== 'APPLY_HISTORICAL_INBOX_BACKFILL') {
    Logger.log('Historical inbox backfill confirmation token missing. Trigger was not created.');
    return;
  }
  if (String(CONFIG.HISTORICAL_INBOX_BACKFILL_ACTIVE_POLICY_NAME || '').trim()) {
    Logger.log('Clear the manual active-policy pin before installing the historical trigger.');
    return;
  }
  const handler = 'runScheduledHistoricalInboxBackfill';
  const installed = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === handler;
  });
  if (installed) {
    Logger.log('Historical inbox backfill trigger is already installed.');
    return;
  }
  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyMinutes(CONFIG.HISTORICAL_INBOX_BACKFILL_INTERVAL_MINUTES)
    .create();
  Logger.log(
    `Installed historical inbox backfill trigger every ` +
    `${CONFIG.HISTORICAL_INBOX_BACKFILL_INTERVAL_MINUTES} minute(s).`
  );
}

/** Removes only the temporary historical-backfill trigger. */
function removeHistoricalInboxBackfillSchedule() {
  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY RUN] Historical inbox backfill trigger was not removed.');
    return 0;
  }
  const handler = 'runScheduledHistoricalInboxBackfill';
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  Logger.log(`Removed ${removed} historical inbox backfill trigger(s).`);
  return removed;
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
  };
}
