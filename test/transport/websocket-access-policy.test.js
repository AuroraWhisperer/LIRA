'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { maskedFrame, webSocketUpgradeRequest } = require('../helpers/transport-fixtures');
const { createWebSocketHub, sendWebSocket } = require('../../src/server/ws');
const { createRuntimeTransport } = require('../../src/server/runtime-transport');

const ADMIN_TOKEN = 'synthetic-admin-token';

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.writableLength = 0;
    this.destroyed = false;
  }
  write(data) {
    this.writes.push(data);
    return true;
  }
  end() {
    this.ended = true;
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
}

function connect(t, { context = {}, headers = {}, query = '' } = {}) {
  const hub = createWebSocketHub({ closeTimeoutMs: 20 });
  const socket = new FakeSocket();
  hub.handleUpgrade(
    { getState: () => ({ secret: 'admin-only' }), ...context },
    webSocketUpgradeRequest({
      url: `/ws${query}`,
      headers,
    }),
    socket,
  );
  t.after(() => {
    hub.stop();
    socket.destroy();
  });
  return { hub, socket };
}

function messages(socket) {
  return socket.writes
    .filter((chunk) => Buffer.isBuffer(chunk) && (chunk[0] & 0x0f) === 1)
    .map((chunk) => {
      const length = chunk[1] & 0x7f;
      return JSON.parse(chunk.subarray(length < 126 ? 2 : length === 126 ? 4 : 10));
    });
}

const frame = (payload, opcode = 1, fin = true) => maskedFrame(payload, { opcode, fin });

const fullState = {
  queue: { current: { song_name: 'Requested song' }, waiting: [] },
  settings: { bilibiliCookie: 'private-cookie', unrelatedAdminValue: 'private-setting' },
  lyricState: { lineText: 'Current lyric' },
  danmakuFeed: [{ id: 'one', message: 'Public danmaku' }],
  gifts: { viewRevision: 'gift-source-version', privateGiftHistory: 'private-gift' },
  giftSprint: { targetRmb: 1000, remainingCrystalBalls: 7, sourceId: 'private-source' },
  bilibiliDiagnostics: { secret: 'private-diagnostic' },
  arbitrarySecret: 'private-root',
};

function overlayConnection(t, scope, { query = '', context = {}, headers = {} } = {}) {
  const { createOverlayToken } = require('../../src/server/access-policy');
  return connect(t, {
    context: { sessionToken: ADMIN_TOKEN, getState: () => fullState, ...context },
    headers: { origin: 'null', ...headers },
    query: `?token=${createOverlayToken(ADMIN_TOKEN, scope)}${query}`,
  });
}

test('broadcasts read only active scopes and share encoded frames without sharing backpressure', async (t) => {
  const { createOverlayToken } = require('../../src/server/access-policy');
  const hub = createWebSocketHub();
  const reads = [];
  const context = { sessionToken: ADMIN_TOKEN, getState(fields) { reads.push(fields); return fullState; } };
  const sockets = ['queue', 'queue', 'lyrics', 'queue'].map((scope) => {
    const socket = new FakeSocket();
    hub.handleUpgrade(context, webSocketUpgradeRequest({
      url: `/ws?token=${createOverlayToken(ADMIN_TOKEN, scope)}`,
      headers: { origin: 'null' },
    }), socket);
    return socket;
  });
  t.after(() => { hub.stop(); for (const socket of sockets) socket.destroy(); });
  assert.deepEqual(reads[0], ['queue', 'superChats', 'roomGuard', 'settings']);
  reads.length = 0;
  for (const socket of sockets) socket.writes = [];
  sockets[3].writableLength = 2 * 1024 * 1024;
  hub.broadcastSnapshot(context, 'settings');
  await new Promise(queueMicrotask);
  assert.equal(reads.length, 1);
  assert.deepEqual(new Set(reads[0]), new Set(['queue', 'superChats', 'roomGuard', 'settings', 'lyricState', 'lyricTimeline']));
  assert.equal(sockets[0].writes[0], sockets[1].writes[0]);
  assert.notEqual(sockets[0].writes[0], sockets[2].writes[0]);
  assert.equal(sockets[3].destroyed, true);
  assert.equal(sockets[0].destroyed, false);
  assert.equal(JSON.stringify(messages(sockets[0])).includes('private-'), false);
  for (const socket of sockets) socket.writes = [];
  hub.broadcast({ type: 'shutdown', reason: 'test' });
  assert.equal(sockets[0].writes[0], sockets[1].writes[0]);
  assert.equal(sockets[3].writes.length, 0);
});

test('admin subscribers retain full reads alongside overlay subscribers', async (t) => {
  const reads = [];
  const { hub, socket } = connect(t, {
    context: { sessionToken: ADMIN_TOKEN, getState(fields) { reads.push(fields); return fullState; } },
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  hub.broadcastSnapshot({ getState(fields) { reads.push(fields); return fullState; } }, 'settings');
  await new Promise(queueMicrotask);
  assert.deepEqual(reads, [undefined, undefined]);
  assert.equal(messages(socket).at(-1).state.arbitrarySecret, 'private-root');
});

test('legacy game contexts retain their game baseline and skip unrelated hot snapshots', async (t) => {
  const reads = [];
  const { hub, socket } = overlayConnection(t, 'games', { context: { getState(fields) {
    reads.push(fields);
    return { games: { game: 'number-bomb', state: { min: 1, max: 10 } } };
  } } });
  assert.deepEqual(reads, [undefined]);
  assert.ok(Object.hasOwn(messages(socket)[0].state, 'games'));
  hub.broadcastSnapshot({ getState() { assert.fail('a gift cannot change the game'); } }, 'bilibili:gift');
  await new Promise(queueMicrotask);
  assert.equal(messages(socket).length, 1);
});

test('lyrics skip gift-only snapshots but receive settings coalesced with a later gift', async t => {
  const { hub, socket } = overlayConnection(t, 'lyrics');
  let reads = 0;
  const context = { getState() { reads++; return fullState; } };
  socket.writes = [];
  for (const reason of ['bilibili:gift', 'queue:next', 'songs:save', 'gift:wishes', 'superchat:delete']) {
    hub.broadcastSnapshot(context, reason);
  }
  await new Promise(queueMicrotask);
  assert.equal(reads, 0);
  assert.equal(messages(socket).length, 0);
  hub.broadcastSnapshot(context, 'settings');
  hub.broadcastSnapshot(context, 'bilibili:gift');
  await new Promise(queueMicrotask);
  assert.equal(reads, 1);
  assert.deepEqual(messages(socket)[0].state, require('../../src/server/overlay-projection').projectOverlayState('lyrics', fullState));
});

test('queue and gift snapshots reach their own consumers, including reason-only blindbox refresh', async t => {
  for (const [scope, expected] of [['queue', 'queue:add'], ['gift-feed', 'bilibili:gift'], ['blindbox', 'bilibili:gift']]) {
    const { hub, socket } = overlayConnection(t, scope);
    socket.writes = [];
    const context = { getState: () => fullState };
    for (const reason of ['bilibili:gift', 'queue:add']) {
      hub.broadcastSnapshot(context, reason);
      await new Promise(queueMicrotask);
    }
    assert.deepEqual(messages(socket).map(frame => frame.reason), [expected]);
    hub.broadcastSnapshot(context, 'component:styles');
    hub.broadcastSnapshot(context, expected);
    await new Promise(queueMicrotask);
    assert.equal(JSON.stringify(messages(socket).at(-1)).includes('component:styles'), false);
  }
});

test('a WebSocket context without an authentication owner fails closed', (t) => {
  const { socket } = connect(t);
  assert.match(String(socket.writes[0]), /401 Unauthorized/);
  assert.equal(socket.destroyed, true);
  assert.equal(socket.writes.some(Buffer.isBuffer), false);
});

test('output use includes verified overlay sockets only and ends on disconnect', (t) => {
  const admin = connect(t, { context: { sessionToken: ADMIN_TOKEN },
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
  assert.equal(admin.hub.hasOverlayConnections(), false);
  const overlay = overlayConnection(t, 'queue');
  assert.equal(overlay.hub.hasOverlayConnections(), true);
  overlay.socket.destroy();
  assert.equal(overlay.hub.hasOverlayConnections(), false);
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
  const { createOverlayToken } = require('../../src/server/access-policy');
  const valid = createOverlayToken(ADMIN_TOKEN, 'queue');
  for (const token of [
    '',
    `x${valid.slice(1)}`,
    valid.replace(':queue:', ':danmaku:'),
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
  'queue',
  'songlist',
  'blindbox',
  'overtime',
  'gift-effects',
  'gift-feed',
  'gift-sprint',
  'gift-export',
  'lyrics',
  'games',
  'danmaku',
  'wheel',
  'opening',
  'clock',
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

test('only negotiated danmaku subscribers skip a pure gift baseline and mixed batches still reconcile', async (t) => {
  for (const [query, expected] of [
    ['&topic=danmaku&snapshot=danmaku-events-v1', ['danmaku:message']],
    ['&topic=danmaku', ['danmaku:message', 'snapshot']],
    ['&snapshot=danmaku-events-v1', ['snapshot']],
  ]) {
    let reads = 0;
    const context = { getState() { reads++; return fullState; } };
    const { hub, socket } = overlayConnection(t, 'danmaku', { query, context });
    assert.equal(messages(socket)[0].state.danmakuFeed[0].id, 'one');
    socket.writes = [];
    hub.broadcastSnapshot(context, 'bilibili:gift');
    hub.broadcast({ type: 'danmaku:message', item: { id: 'one', message: 'Public danmaku' } }, { topic: 'danmaku' });
    await new Promise(queueMicrotask);
    assert.deepEqual(messages(socket).map(payload => payload.type), expected);
    assert.equal(reads, expected.includes('snapshot') ? 2 : 1);
    socket.writes = [];
    hub.broadcastSnapshot(context, 'live:status');
    hub.broadcastSnapshot(context, 'bilibili:gift');
    await new Promise(queueMicrotask);
    assert.equal(messages(socket)[0].state.danmakuFeed[0].message, 'Public danmaku');
  }
});

test('gift overlays read only the revision unless an admin needs recent gifts in the same broadcast', async t => {
  let recentReads = 0;
  const context = { sessionToken: ADMIN_TOKEN, getState(fields, { includeRecentGifts = true } = {}) {
    const gifts = { viewRevision: 'gift-source-version' };
    if (includeRecentGifts) { recentReads++; gifts.recent = [{ gift_name: 'new' }]; }
    return { gifts };
  } };
  const { hub, socket } = overlayConnection(t, 'gift-feed', { context });
  assert.equal(messages(socket)[0].state.gifts.viewRevision, 'gift-source-version');
  hub.broadcastSnapshot(context, 'bilibili:gift');
  await new Promise(queueMicrotask);
  assert.equal(recentReads, 0);
  const admin = new FakeSocket();
  hub.handleUpgrade(context, webSocketUpgradeRequest({ url: '/ws?snapshot=music-events-v1',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }), admin);
  t.after(() => admin.destroy());
  recentReads = 0;
  hub.broadcastSnapshot(context, 'bilibili:gift');
  await new Promise(queueMicrotask);
  assert.equal(recentReads, 1);
  assert.equal(messages(admin).at(-1).state.gifts.recent[0].gift_name, 'new');
  assert.equal(messages(socket).at(-1).state.gifts.recent, undefined);
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

test(
  'anonymous overlay HTML credentials keep real admin, queue and danmaku sockets isolated',
  { timeout: 5000 },
  async (t) => {
    const hub = createWebSocketHub({ closeTimeoutMs: 30 });
    const transport = createRuntimeTransport({
      publicDir: path.resolve(__dirname, '../../public'),
      getSessionToken: () => ADMIN_TOKEN,
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
      const client = {
        socket,
        received,
        next: () =>
          new Promise((resolve) => {
            nextSnapshot = resolve;
          }),
      };
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
    hub.broadcast(
      { type: 'danmaku:message', item: { id: 'two', message: 'Live public message' } },
      { topic: 'danmaku' },
    );
    hub.broadcastSnapshot(context, 'settings');
    await Promise.all(barrier);
    assert.ok(JSON.stringify(clients[0].received).includes('private-root'));
    assert.ok(JSON.stringify(clients[0].received).includes('private-increment'));
    assert.equal(
      clients[1].received.some((payload) => payload.type === 'danmaku:message'),
      false,
    );
    assert.equal(clients[2].received.filter((payload) => payload.type === 'danmaku:message').length, 1);
    for (const client of clients.slice(1)) {
      assert.equal(JSON.stringify(client.received).includes('private-'), false);
    }
  },
);
