'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once, EventEmitter } = require('node:events');
const test = require('node:test');
const { createWebSocketHub } = require('../src/server/ws');

async function openUpgradedConnection(t, { halfOpen = false } = {}) {
  const hub = createWebSocketHub({ closeTimeoutMs: 40 });
  const context = { state: { sockets: new Set() }, getState: () => ({}) };
  const server = http.createServer();
  let upgraded;
  let client;
  t.after(async () => {
    hub.stop();
    client?.destroy();
    upgraded?.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  });
  server.on('upgrade', (req, socket) => {
    upgraded = socket;
    hub.handleUpgrade(context, req, socket);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  client = net.createConnection({
    host: '127.0.0.1', port: server.address().port, allowHalfOpen: true,
  });
  const chunks = [];
  client.on('data', (chunk) => chunks.push(chunk));
  client.on('end', () => { if (!halfOpen) client.end(); });
  await once(client, 'connect');
  const firstData = once(client, 'data');
  client.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
    'Connection: Upgrade\r\nUpgrade: websocket\r\n' +
    'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
  await firstData;
  assert.match(Buffer.concat(chunks).toString(), /101 Switching Protocols/);
  return { hub, context, server, client, upgraded, chunks };
}

async function closeHttpServer(server) {
  let timeout;
  try {
    await Promise.race([
      new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('upgraded connection prevented HTTP close')), 500);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

for (const halfOpen of [false, true]) {
  test(`hub stop closes HTTP with ${halfOpen ? 'uncooperative half-open' : 'cooperative'} peer`, async (t) => {
    const { hub, context, server, upgraded, chunks } = await openUpgradedConnection(t, { halfOpen });
    const shutdownPayload = { type: 'shutdown', reason: 'manual' };
    hub.stop({ shutdownPayload });
    await closeHttpServer(server);
    assert.equal(upgraded.destroyed, true);
    assert.equal(context.state.sockets.size, 0);
    const received = Buffer.concat(chunks);
    assert.ok(received.includes(Buffer.from(JSON.stringify(shutdownPayload))));
    assert.ok(received.includes(Buffer.from([0x88, 2, 0x03, 0xe9])), 'going-away close follows shutdown');
  });
}

test('protocol rejection reaps a real half-open connection without hub stop', async (t) => {
  const { hub, server, client, upgraded, context, chunks } = await openUpgradedConnection(t, { halfOpen: true });
  const response = once(client, 'data');
  client.write(Buffer.concat([Buffer.from([0x89, 0xfe, 0, 200, 0, 0, 0, 0]), Buffer.alloc(200)]));
  await response;
  assert.ok(Buffer.concat(chunks).includes(Buffer.from([0x88, 2, 0x03, 0xea])));
  assert.equal(context.state.sockets.size, 0);
  hub.broadcast({ type: 'should-not-reach-closing-client' });
  await closeHttpServer(server);
  assert.equal(upgraded.destroyed, true);
});

test('standard WebSocket client receives shutdown before a clean going-away close', async (t) => {
  const hub = createWebSocketHub({ closeTimeoutMs: 200 });
  const server = http.createServer();
  let upgraded;
  let client;
  t.after(async () => {
    hub.stop();
    upgraded?.destroy();
    if (client?.readyState === WebSocket.OPEN) client.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  });
  server.on('upgrade', (req, socket) => {
    upgraded = socket;
    hub.handleUpgrade({ getState: () => ({}) }, req, socket);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  client = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  const messages = [];
  client.addEventListener('message', (event) => messages.push(JSON.parse(event.data)));
  await once(client, 'open');
  const closed = once(client, 'close');
  client.send('正常文本');
  hub.stop({ shutdownPayload: { type: 'shutdown', reason: 'manual' } });
  const [event] = await closed;
  await closeHttpServer(server);
  assert.equal(event.code, 1001);
  assert.equal(event.wasClean, true);
  assert.equal(messages.at(-1).type, 'shutdown');
});

test('stop retains the first close deadline and rejects subsequent upgrades', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hub = createWebSocketHub({ closeTimeoutMs: 100 });
  t.after(() => hub.stop());
  const socket = new EventEmitter();
  socket.writes = [];
  socket.write = (data) => { socket.writes.push(data); return true; };
  socket.end = () => {};
  let destroyed = 0;
  socket.destroy = () => { destroyed += 1; socket.destroyed = true; socket.emit('close'); };
  const context = { getState: () => ({}) };
  const request = { url: '/ws', headers: { 'sec-websocket-key': 'test' } };
  hub.handleUpgrade(context, request, socket);
  hub.stop({ shutdownPayload: { type: 'shutdown', reason: 'first' } });
  const writes = socket.writes.length;
  t.mock.timers.tick(90);
  hub.stop({ shutdownPayload: { type: 'shutdown', reason: 'second' } });
  assert.equal(socket.writes.length, writes);
  assert.equal(destroyed, 0);
  t.mock.timers.tick(10);
  assert.equal(destroyed, 1);
  const lateSocket = { destroy() { this.destroyed = true; } };
  hub.handleUpgrade(context, request, lateSocket);
  assert.equal(lateSocket.destroyed, true);
});

test('physical close cancels the reap timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hub = createWebSocketHub({ closeTimeoutMs: 100 });
  const socket = new EventEmitter();
  socket.write = () => true;
  socket.end = () => {};
  let destroyed = 0;
  socket.destroy = () => { destroyed += 1; };
  hub.handleUpgrade({ getState: () => ({}) }, {
    url: '/ws', headers: { 'sec-websocket-key': 'test' },
  }, socket);
  hub.stop();
  socket.emit('close');
  t.mock.timers.tick(1000);
  assert.equal(destroyed, 0);
});
