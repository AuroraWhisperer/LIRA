'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const test = require('node:test');
const { createHttpServer } = require('../src/server/http-server');
const { createWebSocketHub } = require('../src/server/ws');

test('a frame arriving with the HTTP upgrade is processed exactly once', async (t) => {
  const hub = createWebSocketHub({ closeTimeoutMs: 20 });
  const server = createHttpServer({
    host: '127.0.0.1',
    startPort: 0,
    getStartedPort: () => server.address().port,
    getPhase: () => 'ready',
    isLicenseAuthorized: () => true,
    getWebSocketHub: () => hub,
    getWebSocketContext: () => ({ sessionToken: 'synthetic-token', getState: () => ({}) }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = net.createConnection({ host: '127.0.0.1', port: server.address().port });
  t.after(async () => {
    client.destroy();
    hub.stop();
    await new Promise((resolve) => server.close(resolve));
  });
  await once(client, 'connect');
  const handshake = Buffer.from([
    'GET /ws?token=synthetic-token HTTP/1.1',
    `Host: 127.0.0.1:${server.address().port}`,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    '', '',
  ].join('\r\n'));
  // Masked ping with a zero mask, immediately followed by the close frame.
  const frames = Buffer.from([0x89, 0x84, 0, 0, 0, 0, 112, 105, 110, 103, 0x88, 0x80, 0, 0, 0, 0]);
  let received = Buffer.alloc(0);
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Upgrade head was not consumed.')), 2000);
    t.after(() => clearTimeout(timer));
    client.on('error', reject);
    client.on('data', (chunk) => { received = Buffer.concat([received, chunk]); });
    client.on('end', resolve);
  });
  client.write(Buffer.concat([handshake, frames]));
  await completed;
  const pong = Buffer.from([0x8a, 4, 112, 105, 110, 103]);
  const first = received.indexOf(pong);
  assert.ok(first > 0, 'the initial ping must receive a pong');
  assert.equal(received.indexOf(pong, first + 1), -1, 'head bytes must not be processed twice');
});
