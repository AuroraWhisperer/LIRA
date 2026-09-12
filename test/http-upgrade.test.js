'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHttpServer } = require('../src/server/http-server');

test('malformed upgrade URLs are rejected without escaping the transport handler', () => {
  let upgrades = 0;
  const server = createHttpServer({
    host: '127.0.0.1',
    startPort: 3000,
    getPhase: () => 'ready',
    getStartedPort: () => 3000,
    isLicenseAuthorized: () => true,
    getWebSocketContext: () => ({}),
    getWebSocketHub: () => ({ handleUpgrade() { upgrades += 1; } }),
  });
  for (const [host, url] of [['[', '/ws'], ['127.0.0.1:3000', 'http://[']]) {
    let response = '';
    assert.doesNotThrow(() => server.emit('upgrade', {
      url, headers: { host },
    }, { end(value) { response = value; } }));
    assert.match(response, /^HTTP\/1\.1 400 /);
  }
  assert.equal(upgrades, 0);
  server.emit('upgrade', { url: '/ws', headers: { host: '127.0.0.1:3000' } }, {});
  assert.equal(upgrades, 1);
});
