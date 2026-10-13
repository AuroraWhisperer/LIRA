'use strict';

function installDesktopDiagnostics({ app, writeLog, getBaseUrl, processImpl = process }) {
  const disposers = new Map();
  const listeners = [];
  function log(scope, value) {
    try {
      writeLog(scope, value);
      return true;
    } catch {
      // A failed sink is a dropped diagnostic, never a lifecycle failure.
      return false;
    }
  }
  function trusted(url) {
    try {
      const base = new URL(getBaseUrl());
      return base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname) &&
        new URL(url).origin === base.origin;
    } catch { return false; }
  }
  function sourcePath(url) {
    try { return new URL(url).pathname.replace(/^\/overlay\/[^/]+/, '/overlay/[redacted]'); }
    catch { return '[unknown]'; }
  }
  function bind(contents) {
    if (disposers.has(contents)) return;
    const owned = [];
    function on(name, listener) {
      contents.on(name, listener);
      owned.push([name, listener]);
    }
    on('console-message', (event) => {
      if (!['error', 'warning'].includes(event.level) || !trusted(contents.getURL())) return;
      if (event.frame && !trusted(event.frame.url)) return;
      log(`renderer-${event.level}`, {
        page: sourcePath(contents.getURL()), source: trusted(event.sourceId) ? sourcePath(event.sourceId) : '[external]',
        line: event.lineNumber, message: event.message,
      });
    });
    on('preload-error', (_event, _preloadPath, error) => {
      if (trusted(contents.getURL())) log('preload-error', error);
    });
    on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
      if (code !== -3 && trusted(url)) log('page-load-error', { code, page: sourcePath(url), isMainFrame });
    });
    on('render-process-gone', (_event, details) => {
      log('renderer-process-error', { reason: details.reason, exitCode: details.exitCode });
    });
    const dispose = () => {
      for (const [name, listener] of owned) contents.removeListener(name, listener);
      disposers.delete(contents);
    };
    on('destroyed', dispose);
    disposers.set(contents, dispose);
  }
  function on(emitter, name, listener) {
    emitter.on(name, listener);
    listeners.push(() => emitter.removeListener(name, listener));
  }
  on(app, 'web-contents-created', (_event, contents) => bind(contents));
  on(app, 'child-process-gone', (_event, details) => {
    log('child-process-error', { type: details.type, reason: details.reason, exitCode: details.exitCode });
  });
  on(processImpl, 'uncaughtExceptionMonitor', (error) => log('uncaught-error', error));
  on(app, 'will-quit', dispose);
  function dispose() {
    for (const remove of listeners.splice(0)) remove();
    for (const remove of disposers.values()) remove();
  }
  return dispose;
}

module.exports = { installDesktopDiagnostics };
