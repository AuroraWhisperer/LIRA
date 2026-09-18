'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const {
  broadcastSnapshot, createWebSocketHub, handleWebSocketUpgrade, sendWebSocket,
} = require('../src/server/ws');
const { createRuntimeTransport } = require('../src/server/runtime-transport');

const ADMIN_TOKEN = 'synthetic-admin-token';

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.writableLength = 0;
    this.destroyed = false;
  }
  write(data) { this.writes.push(data); return true; }
  end() { this.ended = true; }
  destroy() { this.destroyed = true; this.emit('close'); }
}

function connect(t, { context = {}, headers = {}, query = '' } = {}) {
  const hub = createWebSocketHub({ closeTimeoutMs: 20 });
  const socket = new FakeSocket();
  hub.handleUpgrade({ getState: () => ({ secret: 'admin-only' }), ...context }, {
    url: `/ws${query}`,
    headers: { 'sec-websocket-key': 'synthetic-key', ...headers },
  }, socket);
  t.after(() => { hub.stop(); socket.destroy(); });
  return { hub, socket };
}

function messages(socket) {
  return socket.writes.filter((chunk) => Buffer.isBuffer(chunk) && (chunk[0] & 0x0f) === 1)
    .map((chunk) => {
      const length = chunk[1] & 0x7f;
      return JSON.parse(chunk.subarray(length < 126 ? 2 : length === 126 ? 4 : 10));
    });
}

function frame(payload, opcode = 1, fin = true) {
  const data = Buffer.from(payload);
  const mask = Buffer.from([1, 2, 3, 4]);
  assert.ok(data.length < 126);
  return Buffer.concat([
    Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | data.length]), mask,
    Buffer.from(data.map((value, index) => value ^ mask[index % 4])),
  ]);
}

const fullState = {
  queue: { current: { song_name: 'Requested song' }, waiting: [] },
  settings: { bilibiliCookie: 'private-cookie', unrelatedAdminValue: 'private-setting' },
  lyricState: { lineText: 'Current lyric' },
  danmakuFeed: [{ id: 'one', message: 'Public danmaku' }],
  gifts: { viewRevision: 'gift-source-version', privateGiftHistory: 'private-gift' },
  bilibiliDiagnostics: { secret: 'private-diagnostic' },
  arbitrarySecret: 'private-root',
};

function overlayConnection(t, scope, { query = '', context = {}, headers = {} } = {}) {
  const { createOverlayToken } = require('../src/server/access-policy');
  return connect(t, {
    context: { sessionToken: ADMIN_TOKEN, getState: () => fullState, ...context },
    headers: { origin: 'null', ...headers },
    query: `?token=${createOverlayToken(ADMIN_TOKEN, scope)}${query}`,
  });
}

test('a WebSocket context without an authentication owner fails closed', (t) => {
  const { socket } = connect(t);
  assert.match(String(socket.writes[0]), /401 Unauthorized/);
  assert.equal(socket.destroyed, true);
  assert.equal(socket.writes.some(Buffer.isBuffer), false);
});

test('canonical admin Bearer authentication retains the full initial snapshot', (t) => {
  const { socket } = connect(t, {
    context: { sessionToken: ADMIN_TOKEN },
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert.match(String(socket.writes[0]), /101 Switching Protocols/);
  assert.deepEqual(socket._wsPrincipal, { type: 'admin' });
  assert.equal(Object.isFrozen(socket._wsPrincipal), true);
  assert.ok(socket.writes.some((chunk) => Buffer.isBuffer(chunk) && chunk.includes('admin-only')));
});

test('exported JSON sends cannot bypass an absent socket principal', () => {
  const socket = new FakeSocket();
  assert.equal(sendWebSocket(socket, { type: 'snapshot', state: { secret: 'private' } }), false);
  assert.equal(socket.writes.length, 0);
});

test('client-supplied overlay scope cannot grant an admin opaque-origin access', (t) => {
  const { socket } = connect(t, {
    context: { sessionToken: ADMIN_TOKEN, allowedOrigins: ['null', 'http://127.0.0.1:3000'] },
    query: `?token=${ADMIN_TOKEN}&type=overlay&scope=queue`,
    headers: { origin: 'null' },
  });
  assert.match(String(socket.writes[0]), /403 Forbidden/);
  assert.equal(socket.destroyed, true);
});

test('only a verified overlay credential accepts opaque origin and fixes its own scope', (t) => {
  const { socket } = overlayConnection(t, 'queue', { query: '&scope=danmaku&type=admin' });
  assert.match(String(socket.writes[0]), /101 Switching Protocols/);
  assert.deepEqual(socket._wsPrincipal, { type: 'overlay', scope: 'queue' });
  assert.equal(Object.isFrozen(socket._wsPrincipal), true);
  assert.equal(messages(socket)[0].state.queue.current.song_name, 'Requested song');
  assert.equal(messages(socket)[0].state.danmakuFeed, undefined);
});

test('overlay authentication rejects forged and previous-runtime credentials', (t) => {
  const { createOverlayToken } = require('../src/server/access-policy');
  const valid = createOverlayToken(ADMIN_TOKEN, 'queue');
  for (const token of [
    '', `x${valid.slice(1)}`, valid.replace(':queue:', ':danmaku:'),
    createOverlayToken('expired-runtime', 'queue'),
  ]) {
    const { socket } = connect(t, {
      context: { sessionToken: ADMIN_TOKEN },
      headers: { origin: 'null' },
      query: `?token=${token}&scope=queue&type=overlay`,
    });
    assert.match(String(socket.writes[0]), /401 Unauthorized/);
    assert.equal(socket.writes.some(Buffer.isBuffer), false);
  }
});

test('an explicit invalid Bearer cannot fall back to a valid admin query credential', (t) => {
  const { socket } = connect(t, {
    context: { sessionToken: ADMIN_TOKEN },
    headers: { authorization: 'Bearer wrong' },
    query: `?token=${ADMIN_TOKEN}`,
  });
  assert.match(String(socket.writes[0]), /401 Unauthorized/);
  assert.equal(socket.writes.some(Buffer.isBuffer), false);
});

test('verified overlay credentials do not waive foreign-Origin validation', (t) => {
  const { socket } = overlayConnection(t, 'queue', {
    context: { allowedOrigins: ['http://127.0.0.1:3000'] },
    headers: { origin: 'http://foreign.invalid' },
  });
  assert.match(String(socket.writes[0]), /403 Forbidden/);
  assert.equal(socket.writes.some(Buffer.isBuffer), false);
});

for (const scope of [
  'queue', 'songlist', 'blindbox', 'overtime', 'gift-effects', 'gift-feed',
  'gift-export', 'lyrics', 'games', 'danmaku', 'wheel', 'opening', 'clock',
]) {
  test(`${scope} initial and subsequent snapshots exclude unrelated private state`, async (t) => {
    const { hub, socket } = overlayConnection(t, scope);
    hub.broadcastSnapshot({ getState: () => fullState }, 'settings:update');
    await new Promise((resolve) => queueMicrotask(resolve));
    const received = messages(socket);
    assert.equal(received.length, 2);
    assert.equal(received[0].reason, 'connect');
    assert.equal(received[1].reason, 'settings:update');
    assert.equal(JSON.stringify(received).includes('private-'), false);
    assert.deepEqual(received[0].state, received[1].state);
  });
}

test('topic subscriptions do not grant cross-overlay increments or unknown broadcasts', (t) => {
  const { hub, socket } = overlayConnection(t, 'queue', { query: '&topic=danmaku' });
  socket.writes = [];
  hub.broadcast({ type: 'danmaku:message', item: { text: 'Must not reach queue' } }, { topic: 'danmaku' });
  hub.broadcast({ type: 'lyric-state', state: { text: 'Must not reach queue' } });
  hub.broadcast({ type: 'future-admin-command', secret: 'Must not reach queue' });
  assert.equal(socket.writes.length, 0);
  assert.equal(socket.destroyed, false);
});

test('danmaku increments retain the explicit subscription requirement', (t) => {
  const subscribed = overlayConnection(t, 'danmaku', { query: '&topic=danmaku' });
  const unsubscribed = overlayConnection(t, 'danmaku');
  for (const { hub, socket } of [subscribed, unsubscribed]) {
    socket.writes = [];
    hub.broadcast({ type: 'danmaku:message', item: { id: 'one', message: 'Public danmaku' } }, { topic: 'danmaku' });
  }
  assert.equal(messages(subscribed.socket)[0].type, 'danmaku:message');
  assert.equal(messages(subscribed.socket)[0].item.message, 'Public danmaku');
  assert.equal(messages(unsubscribed.socket).length, 0);
});

test('gift feed retains source revision and catalog invalidation without catalog data', (t) => {
  const { hub, socket } = overlayConnection(t, 'gift-feed');
  assert.equal(messages(socket)[0].state.gifts.viewRevision, 'gift-source-version');
  hub.broadcast({ type: 'gift-catalog:update', snapshot: { secret: 'private-catalog' } });
  assert.equal(messages(socket).at(-1).type, 'gift-catalog:update');
  assert.equal(JSON.stringify(messages(socket)).includes('private-'), false);
});

for (const [name, data] of [
  ['clear-history', frame(JSON.stringify({ type: 'clear-history' }))],
  ['admin control', frame(JSON.stringify({ type: 'shutdown', principal: { type: 'admin' } }))],
  ['binary message', frame('control', 2)],
  ['fragmented command', frame('{"type":', 1, false)],
]) {
  test(`overlay ${name} is rejected with policy close and removed from broadcasts`, (t) => {
    const { hub, socket } = overlayConnection(t, 'queue');
    socket.writes = [];
    socket.emit('data', data);
    const close = socket.writes.at(-1);
    assert.equal(close[0], 0x88);
    assert.equal(close.readUInt16BE(2), 1008);
    assert.equal(socket._wsPrincipal, null);
    assert.equal(socket.listenerCount('data'), 0);
    hub.broadcast({ type: 'snapshot', state: fullState });
    assert.equal(socket.writes.length, 1);
  });
}

test('overlay ping/pong and projected shutdown preserve normal transport lifecycle', (t) => {
  const { hub, socket } = overlayConnection(t, 'queue');
  socket.writes = [];
  socket.emit('data', frame('ping', 9));
  assert.equal(socket.writes[0][0], 0x8a);
  socket.emit('data', frame('', 10));
  assert.equal(socket.ended, undefined);
  hub.stop({ shutdownPayload: { type: 'shutdown', reason: 'manual', secret: 'private-stop' } });
  assert.equal(messages(socket)[0].type, 'shutdown');
  assert.equal(JSON.stringify(messages(socket)).includes('private-stop'), false);
  assert.equal(socket.writes.at(-1).readUInt16BE(2), 1001);
});

test('compatibility broadcasts use the same per-socket projection', (t) => {
  const { createOverlayToken } = require('../src/server/access-policy');
  const socket = new FakeSocket();
  const context = { sessionToken: ADMIN_TOKEN, state: { sockets: new Set() }, getState: () => fullState };
  handleWebSocketUpgrade(context, {
    url: `/ws?token=${createOverlayToken(ADMIN_TOKEN, 'lyrics')}`,
    headers: { 'sec-websocket-key': 'synthetic-key', origin: 'null' },
  }, socket);
  t.after(() => socket.destroy());
  broadcastSnapshot(context, 'lyric:update');
  assert.equal(messages(socket).length, 2);
  assert.equal(messages(socket)[1].state.lyricState.lineText, 'Current lyric');
  assert.equal(JSON.stringify(messages(socket)).includes('private-'), false);
});

test('anonymous overlay HTML credentials keep real admin, queue and danmaku sockets isolated', { timeout: 5000 }, async (t) => {
  const hub = createWebSocketHub({ closeTimeoutMs: 30 });
  const transport = createRuntimeTransport({
    publicDir: path.resolve(__dirname, '../public'), getSessionToken: () => ADMIN_TOKEN,
  });
  const server = http.createServer((req, res) => {
    transport.servePageOrAsset(req, res, new URL(req.url, `http://${req.headers.host}`));
  });
  const context = { sessionToken: ADMIN_TOKEN, getState: () => fullState };
  server.on('upgrade', (req, socket) => hub.handleUpgrade(context, req, socket));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.socket.close();
    hub.stop();
    await new Promise((resolve) => server.close(resolve));
  });
  const credentials = [ADMIN_TOKEN];
  for (const scope of ['queue', 'danmaku']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${scope}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal(html.includes(ADMIN_TOKEN), false);
    const match = html.match(/\)\(("ov1:[^"]+")\);<\/script>/);
    assert.ok(match, 'anonymous overlay HTML must bootstrap only its scoped credential');
    const token = JSON.parse(match[1]);
    assert.ok(token.startsWith(`ov1:${scope}:`));
    credentials.push(token);
  }
  for (const credential of credentials) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.address().port}/ws?token=${encodeURIComponent(credential)}&topic=danmaku`,
    );
    const received = [];
    let nextSnapshot;
    const client = { socket, received, next: () => new Promise((resolve) => { nextSnapshot = resolve; }) };
    socket.addEventListener('message', ({ data }) => {
      const payload = JSON.parse(data);
      received.push(payload);
      if (payload.type === 'snapshot') nextSnapshot?.(payload);
    });
    clients.push(client);
    await client.next();
  }
  const barrier = clients.map((client) => client.next());
  hub.broadcast({ type: 'wesing-state', state: { privateValue: 'private-increment' } });
  hub.broadcast({ type: 'danmaku:message', item: { id: 'two', message: 'Live public message' } }, { topic: 'danmaku' });
  hub.broadcastSnapshot(context, 'bilibili:gift');
  await Promise.all(barrier);
  assert.ok(JSON.stringify(clients[0].received).includes('private-root'));
  assert.ok(JSON.stringify(clients[0].received).includes('private-increment'));
  assert.equal(clients[1].received.some((payload) => payload.type === 'danmaku:message'), false);
  assert.equal(clients[2].received.filter((payload) => payload.type === 'danmaku:message').length, 1);
  for (const client of clients.slice(1)) {
    assert.equal(JSON.stringify(client.received).includes('private-'), false);
  }
});
