'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const TERMINAL_LOG_METHODS = ['log', 'info', 'debug'];

function installTerminalLog(filePath) {
  if (!filePath) return () => {};

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
      appendTerminalLine(filePath, args);
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

function appendTerminalLine(filePath, args) {
  try {
    fs.appendFileSync(filePath, `${util.format(...args)}\n`, 'utf8');
  } catch (_) {
    // Logging must never interfere with the application.
  }
}

module.exports = { installTerminalLog };
