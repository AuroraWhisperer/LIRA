'use strict';

const { redactCredentials } = require('../shared/log-redaction');
const { appendBoundedFileSync, NORMAL_LOG_AGE_MS, ERROR_LOG_AGE_MS } = require('../shared/log-size-limit');
const path = require('node:path');
const { formatLogLine } = require('./terminal-log');
const { createHash } = require('node:crypto');
const { createLogRateLimit } = require('../shared/log-rate-limit');

const NORMAL_ENTRY_BYTES = 2 * 1024;
const ERROR_ENTRY_BYTES = 16 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;

function createDesktopLogger({ getLogFile, loggingState, maxFileBytes = MAX_FILE_BYTES, now = Date.now }) {
  const normalBudget = createLogRateLimit({ now });
  const errorBudget = createLogRateLimit({ now });
  function nextSequence() {
    loggingState.sequence += 1;
    return loggingState.sequence;
  }

  function writeLog(scope, value) {
    try {
      const redactedValue = redactCredentials(value);
      const isError =
        redactedValue instanceof Error ||
        /(?:^|[-_.])(warn|warning|error|failed|failure|fatal)(?:$|[-_.])/i.test(String(scope || ''));
      const message =
        redactedValue instanceof Error
          ? redactedValue.stack || redactedValue.message
          : typeof redactedValue === 'string'
            ? redactedValue
            : JSON.stringify(redactedValue);
      const budget = (isError ? errorBudget : normalBudget)(createHash('sha256').update(`${scope}:${message}`).digest('hex'));
      if (budget.suppressed) append('log-suppressed', `${budget.suppressed} repeated or excess entries suppressed`, isError);
      if (budget.allowed || scope === 'uncaught-error') append(scope, message, isError);
    } catch (_) {
      return;
    }
  }

  function append(scope, message, isError) {
    const line = formatLogLine({
      timestamp: new Date().toISOString(),
      runId: loggingState.runId,
      sequence: nextSequence(),
      pid: process.pid,
      processType: process.type || 'browser',
      source: `desktop:${scope}`,
      message,
    });
    const filePath = getLogFile();
    if (!filePath) return;
    appendBoundedFileSync(isError ? path.join(path.dirname(filePath), 'errors', path.basename(filePath)) : filePath, line, {
      maxEntryBytes: isError ? ERROR_ENTRY_BYTES : NORMAL_ENTRY_BYTES,
      maxFileBytes: isError ? maxFileBytes * 3 : maxFileBytes,
      maxAgeMs: isError ? ERROR_LOG_AGE_MS : NORMAL_LOG_AGE_MS,
    });
  }

  return { writeLog, nextSequence };
}

module.exports = { createDesktopLogger };
