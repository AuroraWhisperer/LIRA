'use strict';

const fs = require('node:fs');
const { redactCredentials } = require('../shared/log-redaction');
const { formatLogLine } = require('./terminal-log');

function createDesktopLogger({ getLogFile, loggingState }) {
  function nextSequence() {
    loggingState.sequence += 1;
    return loggingState.sequence;
  }

  function writeLog(scope, value) {
    const redactedValue = redactCredentials(value);
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
    try {
      fs.appendFileSync(getLogFile(), line, 'utf8');
    } catch (_) {
      return;
    }
  }

  return { writeLog, nextSequence };
}

module.exports = { createDesktopLogger };
