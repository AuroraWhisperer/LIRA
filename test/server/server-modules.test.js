'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('optional admin launcher handles asynchronous spawn failure and stays disabled by default', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter();
  let spawns = 0;
  let unrefs = 0;
  child.unref = () => { unrefs++; };
  const messages = [];
  const processStub = { env: {}, platform: 'win32' };
  const moduleStub = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../src/server/admin-launcher'), 'utf8'), {
    module: moduleStub,
    process: processStub,
    require: () => ({ spawn() { spawns++; return child; } }),
    console: { log: (message) => messages.push(message), warn: (message) => messages.push(message) },
  });
  moduleStub.exports.openAdminPageIfNeeded('http://127.0.0.1:5000');
  assert.equal(spawns, 0);
  processStub.env.AUTO_OPEN_ADMIN = '1';
  moduleStub.exports.openAdminPageIfNeeded('http://127.0.0.1:5000');
  assert.equal(spawns, 1);
  assert.equal(unrefs, 1);
  assert.doesNotThrow(() => child.emit('error', new Error('spawn cmd ENOENT')));
  assert.deepEqual(messages, [
    'Open admin page manually: http://127.0.0.1:5000/admin',
    'Could not open browser automatically: spawn cmd ENOENT',
  ]);
});

test('server compatibility wrappers reuse one runtime and preserve stop defaults', async () => {
  const { createServerCompatibility } = require('../../src/server/compatibility-runtime');
  const calls = [];
  const runtime = {
    start: (options) => calls.push(['start', options]),
    stop: (options) => calls.push(['stop', options]),
    setPreShutdownHook: (hook) => calls.push(['hook', hook]),
    persistPlaybackSnapshot: (payload, clientId) => ({ payload, clientId }),
    getApiToken: () => 'token',
  };
  let factoryCalls = 0;
  const compatibility = createServerCompatibility((options) => {
    factoryCalls += 1;
    calls.push(['factory', options]);
    return runtime;
  });
  const hook = () => {};

  compatibility.startServer({ dataDir: 'data-a', startPort: 0 });
  compatibility.setPreShutdownHook(hook);
  compatibility.shutdownApplication();

  assert.equal(factoryCalls, 1);
  assert.equal(compatibility.getApiToken(), 'token');
  assert.deepEqual(calls, [
    ['factory', { dataDir: 'data-a' }],
    ['start', { dataDir: 'data-a', startPort: 0 }],
    ['hook', hook],
    ['stop', { exitProcess: true }],
  ]);
});

test('retired gift debug API is not registered', async () => {
  const { handleApi } = require('../../src/server/api-routes');
  let status = 0;
  let body = '';
  const response = {
    writeHead(value) {
      status = value;
    },
    end(value) {
      body = String(value || '');
    },
  };

  await handleApi(
    { maxBodyBytes: 1024, sessionToken: 'synthetic-token' },
    { method: 'GET', headers: { authorization: 'Bearer synthetic-token' } },
    response,
    new URL('http://127.0.0.1/api/debug/gift-messages'),
  );

  assert.equal(status, 404);
  assert.ok(JSON.parse(body).error);
});
