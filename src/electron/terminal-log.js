'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const { createHash } = require('node:crypto');
const { createLogRateLimit } = require('../shared/log-rate-limit');
const { redactCredentials } = require('../shared/log-redaction');
const { appendBoundedFileSync, NORMAL_LOG_AGE_MS, ERROR_LOG_AGE_MS } = require('../shared/log-size-limit');

const TERMINAL_LOG_METHODS = ['info', 'warn', 'error'];
const NORMAL_ENTRY_BYTES = 2 * 1024;
const ERROR_ENTRY_BYTES = 16 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;

function installTerminalLog(filePath, options = {}) {
  if (!filePath) return () => {};
  const context = normalizeLogContext(options);
  const normalBudget = createLogRateLimit({ now: options.monotonicNow });
  const errorBudget = createLogRateLimit({ now: options.monotonicNow });

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
      const budget = (method === 'error' ? errorBudget : normalBudget)(createHash('sha256').update(`${method}:${message}`).digest('hex'));
      if (budget.suppressed) appendTerminalLine(filePath, `${budget.suppressed} repeated or excess entries suppressed`, 'warn', context);
      if (budget.allowed) appendTerminalLine(filePath, message, method, context);
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
    const isError = method === 'error' || method === 'warn';
    appendBoundedFileSync(
      isError ? path.join(path.dirname(filePath), 'errors', path.basename(filePath)) : filePath,
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
        maxFileBytes: isError ? context.maxFileBytes * 3 : context.maxFileBytes,
        maxAgeMs: isError ? ERROR_LOG_AGE_MS : NORMAL_LOG_AGE_MS,
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
    maxFileBytes: Number(options.maxFileBytes) > 0 ? Number(options.maxFileBytes) : MAX_FILE_BYTES,
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
