'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const util = require('node:util');
const test = require('node:test');
const { createHttpServer } = require('../src/server/http-server');

test('invalid music platform returns a stable 400 through the HTTP transport', async (t) => {
  t.mock.method(console, 'error', () => {});
  const server = createHttpServer({
    host: '127.0.0.1',
    startPort: 0,
    getPhase: () => 'ready',
    getStartedPort: () => server.address().port,
    isLicenseAuthorized: () => true,
    inflightTracker: { run: (fn) => fn() },
    createApiContext: () => ({
      sessionToken: 'synthetic-token',
      music: { registry: { healthCheck: () => ({ ok: true }) } },
    }),
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/music/health?platform=constructor`, {
    headers: { Authorization: 'Bearer synthetic-token' },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'Invalid request parameters.' });
});

test('standalone HTTP failures log only a safe path and redacted error details', async (t) => {
  const output = [];
  t.mock.method(console, 'error', (...args) => output.push(util.format(...args)));
  const server = createHttpServer({
    host: '127.0.0.1',
    startPort: 0,
    getPhase: () => 'ready',
    getStartedPort: () => server.address().port,
    isLicenseAuthorized: () => true,
    servePageOrAsset() {
      throw new Error('fixture failure /resource?token=fake-stack-secret');
    },
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/fixture.svg?token=fake-request-secret&private=unneeded-query`,
  );
  assert.equal(response.status, 500);
  await response.text();
  assert.equal(output.length, 1);
  assert.match(output[0], /fixture.svg/);
  assert.match(output[0], /fixture failure/);
  assert.doesNotMatch(output[0], /fake-(?:request|stack)-secret|unneeded-query/);
});
