'use strict';

const readline = require('node:readline');

function createDiagnosticTerminal(onKeypress, options = {}) {
  const input = options.input ?? process.stdin;
  const emitKeypressEvents =
    options.emitKeypressEvents ?? readline.emitKeypressEvents;
  const previousRawMode = input.isRaw === true;
  const inputWasPaused = input.isPaused();
  const readlineListeners = [];
  let rawModeEnabled = false;
  let inputResumed = false;

  function setup() {
    if (!input.isTTY) return false;
    const previousListeners = new Map(
      ['data', 'newListener'].map((event) => [
        event,
        new Set(input.listeners(event)),
      ]),
    );
    try {
      emitKeypressEvents(input);
      input.setRawMode(true);
      rawModeEnabled = true;
      input.resume();
      inputResumed = true;
      input.on('keypress', onKeypress);
    } finally {
      for (const [event, previous] of previousListeners) {
        for (const listener of input.listeners(event)) {
          if (!previous.has(listener))
            readlineListeners.push([event, listener]);
        }
      }
    }
    return true;
  }

  async function cleanup() {
    let failure = null;
    const actions = [
      () => input.off('keypress', onKeypress),
      ...readlineListeners.map(
        ([event, listener]) =>
          () =>
            input.off(event, listener),
      ),
      () => {
        if (rawModeEnabled) input.setRawMode(previousRawMode);
      },
      () => {
        if (inputResumed && inputWasPaused) input.pause();
      },
    ];
    for (const action of actions) {
      try {
        await action();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }

  return { setup, cleanup };
}

module.exports = { createDiagnosticTerminal };
