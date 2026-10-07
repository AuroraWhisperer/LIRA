'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const test = require('node:test');
const { createHttpServer } = require('../../src/server/http-server');
const { createWebSocketHub } = require('../../src/server/ws');
const { listenHttpServer } = require('../helpers/transport-fixtures');

test('HTTP upgrade enforces the runtime Host before independent WS authorization', async (t) => {
  const token = 'synthetic-upgrade-token';
  const hub = createWebSocketHub({ closeTimeoutMs: 50 });
  let phase = 'ready';
  let authorized = true;
  let snapshots = 0;
  let upgrades = 0;
  const server = createHttpServer({
    host: '127.0.0.1',
    startPort: 3000,
    getStartedPort: () => server.address()?.port,
    getPhase: () => phase,
    isLicenseAuthorized: () => authorized,
    getWebSocketHub: () => {
      upgrades += 1;
      return hub;
    },
    getWebSocketContext: (baseUrl) => ({
      sessionToken: token,
      allowedOrigins: [baseUrl],
      getState: () => {
        snapshots += 1;
        return { marker: 'synthetic-state' };
      },
    }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    hub.stop();
    await new Promise((resolve) => server.close(resolve));
  });
  const port = server.address().port;
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;

  const cases = [
    { name: 'foreign Host, valid token, absent Origin', host: 'foreign.invalid', status: 400 },
    { name: 'foreign Host, valid token and Origin', host: 'foreign.invalid', origin, status: 400 },
    { name: 'wrong port', host: `127.0.0.1:${port + 1}`, status: 400 },
    { name: 'localhost alias is not the runtime Host', host: `localhost:${port}`, status: 400 },
    { name: 'malformed Host is rejected inside the transport handler', host: '[', status: 400 },
    { name: 'canonical Host, non-browser client', status: 101 },
    { name: 'canonical Host and Origin', origin, status: 101 },
    { name: 'valid Host does not bypass Origin', origin: 'http://foreign.invalid', status: 403 },
    { name: 'valid Host does not bypass token', token: 'wrong-token', status: 401 },
    { name: 'valid Host does not bypass license', authorized: false, status: 423 },
    { name: 'starting runtime refuses upgrade', phase: 'starting', status: 503 },
    { name: 'quiescing runtime refuses upgrade', phase: 'quiescing', status: 503 },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      phase = scenario.phase || 'ready';
      authorized = scenario.authorized !== false;
      const previousSnapshots = snapshots;
      const previousUpgrades = upgrades;
      const headers = {
        Host: scenario.host || host,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      };
      if (scenario.origin) headers.Origin = scenario.origin;
      const status = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          headers,
          path: `/ws?token=${scenario.token || token}`,
        });
        req.on('error', reject);
        req.setTimeout(2000, () => req.destroy(new Error('Upgrade timed out')));
        req.on('upgrade', (res, socket) => {
          socket.destroy();
          resolve(res.statusCode);
        });
        req.on('response', (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
          res.on('error', reject);
        });
        req.end();
      });
      assert.equal(status, scenario.status);
      assert.equal(snapshots - previousSnapshots, scenario.status === 101 ? 1 : 0);
      if ([400, 423, 503].includes(scenario.status)) {
        assert.equal(upgrades, previousUpgrades, 'rejection must happen before the hub');
      }
    });
  }

  for (const scenario of [
    { name: 'invalid Host', host: 'foreign.invalid', status: 400 },
    { name: 'starting phase', phase: 'starting', status: 503 },
    { name: 'unlicensed runtime', authorized: false, status: 423 },
    { name: 'malformed upgrade URL', path: 'http://[', status: 400 },
  ]) {
    await t.test(`${scenario.name} closes the server socket even when the peer withholds FIN`, async (t) => {
      phase = scenario.phase || 'ready';
      authorized = scenario.authorized !== false;
      const accepted = once(server, 'connection');
      const client = net.createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
      t.after(() => client.destroy());
      const [serverSocket] = await accepted;
      t.after(() => serverSocket.destroy());
      const closed = once(serverSocket, 'close');
      let deadline;
      t.after(() => clearTimeout(deadline));
      let response = '';
      client.on('data', (chunk) => {
        response += chunk.toString();
      });
      client.write(
        [
          `GET ${scenario.path || `/ws?token=${token}`} HTTP/1.1`,
          `Host: ${scenario.host || host}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          '',
          '',
        ].join('\r\n'),
      );
      await once(client, 'end');
      assert.ok(response.startsWith(`HTTP/1.1 ${scenario.status} `));
      assert.equal(client.writable, true, 'the client deliberately does not send FIN');
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Rejected upgrade retained a half-open socket')), 500);
        }),
      ]);
      assert.equal(serverSocket.destroyed, true);
    });
  }
});

test('a frame arriving with the HTTP upgrade is processed exactly once', async (t) => {
  const hub = createWebSocketHub({ closeTimeoutMs: 20 });
  t.after(() => hub.stop());
  const { port } = await listenHttpServer(t, {
    getWebSocketHub: () => hub,
    getWebSocketContext: () => ({ sessionToken: 'synthetic-token', getState: () => ({}) }),
  });
  const client = net.createConnection({ host: '127.0.0.1', port });
  t.after(() => client.destroy());
  await once(client, 'connect');
  const handshake = Buffer.from(
    [
      'GET /ws?token=synthetic-token HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      '',
      '',
    ].join('\r\n'),
  );
  // Masked ping with a zero mask, immediately followed by the close frame.
  const frames = Buffer.from([0x89, 0x84, 0, 0, 0, 0, 112, 105, 110, 103, 0x88, 0x80, 0, 0, 0, 0]);
  let received = Buffer.alloc(0);
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Upgrade head was not consumed.')), 2000);
    t.after(() => clearTimeout(timer));
    client.on('error', reject);
    client.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
    });
    client.on('end', resolve);
  });
  client.write(Buffer.concat([handshake, frames]));
  await completed;
  const pong = Buffer.from([0x8a, 4, 112, 105, 110, 103]);
  const first = received.indexOf(pong);
  assert.ok(first > 0, 'the initial ping must receive a pong');
  assert.equal(received.indexOf(pong, first + 1), -1, 'head bytes must not be processed twice');
});
