'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const { redactCredentials } = require('../shared/log-redaction');
const { appendBoundedFileSync } = require('../shared/log-size-limit');

const TERMINAL_LOG_METHODS = ['info', 'warn', 'error'];
const NORMAL_ENTRY_BYTES = 2 * 1024;
const ERROR_ENTRY_BYTES = 16 * 1024;
const LEGACY_FILE_BYTES = 10 * 1024 * 1024;

function installTerminalLog(filePath, options = {}) {
  if (!filePath) return () => {};
  const context = normalizeLogContext(options);

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (_) {
    // Keep terminal output available even when the log file cannot be opened.
  }

  const restorers = [];
  for (const method of TERMINAL_LOG_METHODS) {
    const original = console[method];
    if (typeof original !== 'function') continue;

    const wrapped = function (...args) {
      let message;
      try {
        message = redactCredentials(util.format(...args.map(redactCredentials)));
      } catch (_) {
        message = '[Log redaction failed]';
      }
      original.call(console, message);
      if (method === 'info' && !(typeof args[0] === 'string' && args[0].startsWith('[Bilibili][Diagnostic] '))) {
        return;
      }
      appendTerminalLine(filePath, message, method, context);
    };
    console[method] = wrapped;
    restorers.push(() => {
      if (console[method] === wrapped) console[method] = original;
    });
  }

  return () => {
    for (const restore of restorers) restore();
  };
}

function appendTerminalLine(filePath, message, method, context) {
  try {
    appendBoundedFileSync(
      filePath,
      formatLogLine({
        timestamp: context.now(),
        runId: context.runId,
        sequence: context.nextSequence(),
        pid: context.pid,
        processType: context.processType,
        source: `terminal:${method}`,
        message,
      }),
      {
        maxEntryBytes: method === 'error' ? ERROR_ENTRY_BYTES : NORMAL_ENTRY_BYTES,
        maxFileBytes: context.maxFileBytes,
      },
    );
  } catch (_) {
    // Logging must never interfere with the application.
  }
}

function normalizeLogContext(options) {
  let fallbackSequence = 0;
  return {
    runId: String(options.runId || 'unknown'),
    pid: Number(options.pid) || process.pid,
    processType: String(options.processType || process.type || 'node'),
    maxFileBytes: Number(options.maxFileBytes) > 0 ? Number(options.maxFileBytes) : LEGACY_FILE_BYTES,
    now: typeof options.now === 'function' ? options.now : () => new Date().toISOString(),
    nextSequence:
      typeof options.nextSequence === 'function'
        ? options.nextSequence
        : () => {
            fallbackSequence += 1;
            return fallbackSequence;
          },
  };
}

function formatLogLine({ timestamp, runId, sequence, pid, processType, source, message }) {
  const safeTimestamp = String(timestamp || new Date().toISOString());
  const safeRunId = String(runId || 'unknown');
  const safeSequence = Math.max(0, Number(sequence) || 0);
  const safePid = Number(pid) || process.pid;
  const safeProcessType = String(processType || process.type || 'node');
  const safeSource = String(source || 'unknown');
  const safeMessage = String(message || '').replace(/[\r\n]+/g, '\\n');
  return `[${safeTimestamp}] [run=${safeRunId} seq=${safeSequence} pid=${safePid} type=${safeProcessType}] [${safeSource}] ${safeMessage}\n`;
}

module.exports = { installTerminalLog, formatLogLine };
