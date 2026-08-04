'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const TERMINAL_LOG_METHODS = ['log', 'info', 'debug', 'warn', 'error'];

function installTerminalLog(filePath, options = {}) {
  if (!filePath) return () => {};
  const context = normalizeLogContext(options);

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf8');
  } catch (_) {
    // Keep terminal output available even when the log file cannot be opened.
  }

  const restorers = [];
  for (const method of TERMINAL_LOG_METHODS) {
    const original = console[method];
    if (typeof original !== 'function') continue;

    const wrapped = function (...args) {
      original.apply(console, args);
      appendTerminalLine(filePath, args, method, context);
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

function appendTerminalLine(filePath, args, method, context) {
  try {
    fs.appendFileSync(filePath, formatLogLine({
      timestamp: context.now(),
      runId: context.runId,
      sequence: context.nextSequence(),
      pid: context.pid,
      processType: context.processType,
      source: `terminal:${method}`,
      message: util.format(...args)
    }), 'utf8');
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
    now: typeof options.now === 'function' ? options.now : () => new Date().toISOString(),
    nextSequence: typeof options.nextSequence === 'function'
      ? options.nextSequence
      : () => {
        fallbackSequence += 1;
        return fallbackSequence;
      }
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
