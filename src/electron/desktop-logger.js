'use strict';

const { redactCredentials } = require('../shared/log-redaction');
const { appendBoundedFileSync, NORMAL_LOG_AGE_MS, ERROR_LOG_AGE_MS, NORMAL_ENTRY_BYTES, ERROR_ENTRY_BYTES,
  NORMAL_FILE_BYTES, ERROR_FILE_MULTIPLIER, ERROR_LOG_DIRECTORY } = require('../shared/log-size-limit');
const path = require('node:path');
const { formatLogLine } = require('./terminal-log');
const { createHash } = require('node:crypto');
const { createLogRateLimit } = require('../shared/log-rate-limit');

function createDesktopLogger({ getLogFile, runId = '', maxFileBytes = NORMAL_FILE_BYTES, now = Date.now }) {
  let sequence = 0;
  const normalBudget = createLogRateLimit({ now });
  const errorBudget = createLogRateLimit({ now });
  function nextSequence() {
    return ++sequence;
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
      runId,
      sequence: nextSequence(),
      pid: process.pid,
      processType: process.type || 'browser',
      source: `desktop:${scope}`,
      message,
    });
    const filePath = getLogFile();
    if (!filePath) return;
    appendBoundedFileSync(isError ? path.join(path.dirname(filePath), ERROR_LOG_DIRECTORY, path.basename(filePath)) : filePath, line, {
      maxEntryBytes: isError ? ERROR_ENTRY_BYTES : NORMAL_ENTRY_BYTES,
      maxFileBytes: isError ? maxFileBytes * ERROR_FILE_MULTIPLIER : maxFileBytes,
      maxAgeMs: isError ? ERROR_LOG_AGE_MS : NORMAL_LOG_AGE_MS,
    });
  }

  function startRun(value) {
    runId = value;
    sequence = 0;
  }

  return { writeLog, nextSequence, startRun };
}

module.exports = { createDesktopLogger };
