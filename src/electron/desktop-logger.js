'use strict';

const { redactCredentials } = require('../shared/log-redaction');
const { appendBoundedFileSync } = require('../shared/log-size-limit');
const { formatLogLine } = require('./terminal-log');

const NORMAL_ENTRY_BYTES = 2 * 1024;
const ERROR_ENTRY_BYTES = 16 * 1024;
const LEGACY_FILE_BYTES = 10 * 1024 * 1024;

function createDesktopLogger({
  getLogFile,
  loggingState,
  maxFileBytes = LEGACY_FILE_BYTES,
}) {
  function nextSequence() {
    loggingState.sequence += 1;
    return loggingState.sequence;
  }

  function writeLog(scope, value) {
    try {
      const redactedValue = redactCredentials(value);
      const isError =
        redactedValue instanceof Error ||
        /(?:^|[-_.])(error|failed|failure|fatal)(?:$|[-_.])/i.test(
          String(scope || ''),
        );
      const message =
        redactedValue instanceof Error
          ? redactedValue.stack || redactedValue.message
          : typeof redactedValue === 'string'
            ? redactedValue
            : JSON.stringify(redactedValue);
      const line = formatLogLine({
        timestamp: new Date().toISOString(),
        runId: loggingState.runId,
        sequence: nextSequence(),
        pid: process.pid,
        processType: process.type || 'browser',
        source: `desktop:${scope}`,
        message,
      });
      appendBoundedFileSync(getLogFile(), line, {
        maxEntryBytes: isError ? ERROR_ENTRY_BYTES : NORMAL_ENTRY_BYTES,
        maxFileBytes,
      });
    } catch (_) {
      return;
    }
  }

  return { writeLog, nextSequence };
}

module.exports = { createDesktopLogger };
