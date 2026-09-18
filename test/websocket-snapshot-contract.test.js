'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createWebSocketHub } = require('../src/server/ws');

test('full snapshots reach all clients while danmaku increments require a topic', { timeout: 5000 }, async (t) => {
  const hub = createWebSocketHub({ closeTimeoutMs: 50 });
  let state = { queue: { current: 'initial' }, danmakuFeed: [] };
  const context = { sessionToken: 'synthetic-token', getState: () => state };
  const server = http.createServer();
  server.on('upgrade', (req, socket) => hub.handleUpgrade(context, req, socket));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.socket.close()); hub.stop();
    await new Promise((resolve) => server.close(resolve));
  });
  function connect(topic) {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws?token=synthetic-token${topic}`);
    const messages = [];
    const waiters = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data); messages.push(message);
      waiters.get(message.type)?.(message);
    });
    const client = { socket, messages, next: (type) => new Promise((resolve) => waiters.set(type, resolve)) };
    clients.push(client); return client;
  }
  const ordinary = connect(''); const topic = connect('&topic=danmaku');
  for (const message of await Promise.all(clients.map((client) => client.next('snapshot')))) {
    assert.equal(message.reason, 'connect'); assert.deepEqual(message.state, state);
  }
  const incrementsDone = clients.map((client) => client.next('barrier'));
  hub.broadcast({ type: 'danmaku:message', item: { id: 'one' } }, { topic: 'danmaku' });
  hub.broadcast({ type: 'barrier' });
  await Promise.all(incrementsDone);
  assert.equal(ordinary.messages.some((message) => message.type === 'danmaku:message'), false);
  assert.equal(topic.messages.filter((message) => message.type === 'danmaku:message').length, 1);
  const snapshots = clients.map((client) => client.next('snapshot'));
  state = { queue: { current: 'changed' }, danmakuFeed: [{ id: 'one' }] };
  hub.broadcastSnapshot(context, 'queue:update');
  for (const message of await Promise.all(snapshots)) {
    assert.deepEqual(message.state, state); assert.equal(message.reason, 'queue:update');
  }
});
