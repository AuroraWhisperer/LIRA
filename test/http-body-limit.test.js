'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const test = require('node:test');
const { readRawBody, sendJson, sendStableError } = require('../src/server/http-utils');
const { createHttpServer } = require('../src/server/http-server');

test('route error wrappers preserve request-body 413 without calling domain operations', async (t) => {
  t.mock.method(console, 'error', () => {});
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0,
    getPhase: () => 'ready', getStartedPort: () => server.address().port,
    isLicenseAuthorized: () => true,
    inflightTracker: { run: (run) => run() },
    createApiContext: () => ({ maxBodyBytes: 8, dynamicLottery: {}, songs: {} }),
  });
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const routes = [
    ['POST', '/api/playback/queue-state'],
    ['POST', '/api/music/wesing/configure'],
    ['POST', '/api/overtime/action'],
    ['POST', '/api/theme/presets'],
    ['PUT', '/api/ai/config'],
    ['POST', '/api/ai/models'],
    ['POST', '/api/bilibili/dynamic-lottery/tasks'],
    ['POST', '/api/bilibili/danmaku/send'],
    ['POST', '/api/songs/import-preview'],
    ['POST', '/api/gifts/display-settings'],
  ];
  for (const [method, path] of routes) {
    const response = await fetch(origin + path, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ oversized: true }),
    });
    assert.equal(response.status, 413, path);
    assert.equal(response.headers.get('connection'), 'close', path);
    assert.deepEqual(await response.json(), { ok: false, error: 'Request body exceeds size limit.' });
  }
});

for (const mode of ['complete', 'drip', 'continue']) {
  test(`oversized ${mode} upload receives 413 and releases its connection`, { timeout: 3000 }, async (t) => {
    const server = http.createServer(async (req, res) => {
      try {
        await readRawBody(req, 8);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendStableError(res, error);
      }
    });
    t.after(() => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const socket = net.createConnection(server.address().port, '127.0.0.1');
    t.after(() => socket.destroy());
    await once(socket, 'connect');
    let response = '';
    socket.on('data', (chunk) => { response += chunk.toString(); });
    const closed = new Promise((resolve, reject) => {
      socket.once('close', resolve);
      socket.once('error', reject);
    });
    const length = mode === 'complete' ? 9 : 100000;
    socket.write(`POST /upload HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${length}\r\n\r\n123456789`);
    if (mode === 'continue') {
      const timer = setInterval(() => socket.write('more data'), 10);
      t.after(() => clearInterval(timer));
    }
    await closed;
    assert.match(response, /^HTTP\/1\.1 413 /);
    assert.match(response, /connection: close/i);
    assert.match(response, /Request body exceeds size limit\./);
  });
}
