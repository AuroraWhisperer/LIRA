'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installDesktopDiagnostics } = require('../../src/electron/desktop-diagnostics');

test('desktop diagnostics observe local errors once, exclude remote credentials and release listeners', () => {
  const app = new EventEmitter();
  const processImpl = new EventEmitter();
  const contents = new EventEmitter();
  let url = 'http://127.0.0.1:1234/admin?token=secret';
  contents.getURL = () => url;
  const entries = [];
  const dispose = installDesktopDiagnostics({ app, processImpl, getBaseUrl: () => 'http://127.0.0.1:1234',
    writeLog: (scope, value) => entries.push({ scope, value }) });
  app.emit('web-contents-created', {}, contents);
  app.emit('web-contents-created', {}, contents);
  const errorEvent = { level: 'error', message: 'local failure', sourceId: url, frame: { url }, lineNumber: 10 };
  contents.emit('console-message', errorEvent);
  contents.emit('console-message', { ...errorEvent, frame: { url: 'https://login.example.test/' }, message: 'private iframe' });
  url = 'https://login.example.test/';
  contents.emit('console-message', { ...errorEvent, message: 'private login' });
  contents.emit('preload-error', {}, '/private/path', new Error('private preload'));
  contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 7, name: 'private' });
  contents.emit('did-fail-load', {}, -3, 'aborted', 'http://127.0.0.1:1234/admin', true);
  contents.emit('did-fail-load', {}, -105, 'private description', 'http://127.0.0.1:1234/admin?token=secret', true);
  processImpl.emit('uncaughtExceptionMonitor', new Error('fatal'));
  assert.deepEqual(entries.map((entry) => entry.scope), ['renderer-error', 'renderer-process-error', 'page-load-error', 'uncaught-error']);
  assert.doesNotMatch(JSON.stringify(entries), /private|secret/);
  assert.equal(processImpl.listenerCount('uncaughtException'), 0);
  assert.equal(processImpl.listenerCount('unhandledRejection'), 0);
  contents.emit('destroyed');
  assert.equal(contents.listenerCount('console-message'), 0);
  dispose();
  dispose();
  assert.equal(app.listenerCount('web-contents-created'), 0);
  assert.equal(processImpl.listenerCount('uncaughtExceptionMonitor'), 0);
});

test('failure of the diagnostic sink never throws into fatal observers', () => {
  const app = new EventEmitter();
  const processImpl = new EventEmitter();
  const dispose = installDesktopDiagnostics({ app, processImpl, getBaseUrl: () => '', writeLog() { throw new Error('disk'); } });
  assert.doesNotThrow(() => processImpl.emit('uncaughtExceptionMonitor', new Error('fatal')));
  app.emit('will-quit');
  dispose();
});
