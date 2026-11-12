'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const util = require('node:util');
const { once } = require('node:events');
const test = require('node:test');
const { readRawBody, sendJson, sendStableError } = require('../../src/server/http-utils');
const { listenHttpServer } = require('../helpers/transport-fixtures');
const { createMusicProviderRegistry } = require('../../src/music/provider-registry');

test('route error wrappers preserve request-body 413 without calling domain operations', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { origin } = await listenHttpServer(t, {
    inflightTracker: { run: (run) => run() },
    createApiContext: () => ({ sessionToken: 'synthetic-token', maxBodyBytes: 8, dynamicLottery: {}, songs: {} }),
  });
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
      method,
      headers: { Authorization: 'Bearer synthetic-token', Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ oversized: true }),
    });
    assert.equal(response.status, 413, path);
    assert.equal(response.headers.get('connection'), 'close', path);
    assert.equal((await response.json()).ok, false);
  }
});

for (const mode of ['complete', 'buffered', 'drip', 'continue']) {
  test(`oversized ${mode} upload receives 413 and releases its connection`, { timeout: 3000 }, async (t) => {
    const server = http.createServer(async (req, res) => {
      try {
        await readRawBody(req, 8);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendStableError(res, error);
      }
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
    const socket = net.createConnection(server.address().port, '127.0.0.1');
    t.after(() => socket.destroy());
    await once(socket, 'connect');
    let response = '';
    socket.on('data', (chunk) => {
      response += chunk.toString();
    });
    const closed = new Promise((resolve, reject) => {
      socket.once('close', resolve);
      socket.once('error', (error) => {
        // A client that keeps writing after rejection may be reset at the deadline.
        if (mode !== 'continue' || error.code !== 'ECONNRESET') reject(error);
      });
    });
    const payload = mode === 'buffered' ? 'x'.repeat(2 * 1024 * 1024) : '123456789';
    const length = ['complete', 'buffered'].includes(mode) ? payload.length : 100000;
    socket.write(`POST /upload HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${length}\r\n\r\n${payload}`);
    if (mode === 'continue') {
      const timer = setInterval(() => socket.write('more data'), 10);
      t.after(() => clearInterval(timer));
    }
    await closed;
    assert.match(response, /^HTTP\/1\.1 413 /);
    assert.match(response, /connection: close/i);
    const [headers, body] = response.split('\r\n\r\n');
    assert.equal(Buffer.byteLength(body), Number(/content-length: (\d+)/i.exec(headers)?.[1]));
    assert.equal(JSON.parse(body).ok, false);
  });
}

test('invalid music platform returns a stable 400 through the HTTP transport', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { origin } = await listenHttpServer(t, {
    inflightTracker: { run: (fn) => fn() },
    createApiContext: () => ({
      sessionToken: 'synthetic-token',
      music: { registry: createMusicProviderRegistry() },
    }),
  });
  const response = await fetch(`${origin}/api/music/health?platform=constructor`, {
    headers: { Authorization: 'Bearer synthetic-token' },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).ok, false);
});

test('domain route wrappers send unknown failures through the stable HTTP boundary', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(util.format(...args)));
  const fail = () => { throw new Error('synthetic storage failure /private/database?token=test-secret'); };
  const { origin } = await listenHttpServer(t, {
    inflightTracker: { run: (run) => run() },
    createApiContext: () => ({
      sessionToken: 'synthetic-token',
      overtime: { act: fail },
      interactions: { start: fail },
      games: { start: fail },
      wheel: { spin: fail },
      playback: { addFavorite: fail },
      music: { registry: {}, catalog: { searchMusicTracks: fail } },
    }),
  });
  for (const [path, body] of [
    ['/api/overtime/action', { action: 'start' }],
    ['/api/interactions/session', {}],
    ['/api/games/session', { game: 'gomoku', mode: 'multi' }],
    ['/api/wheel/spin', {}],
    ['/api/playback/favorites', { track: {} }],
    ['/api/music/search', { keyword: 'test' }],
  ]) {
    const response = await fetch(origin + path, {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 500, path);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private|database|test-secret/, path);
  }
  assert.equal(logs.length, 6);
  assert.ok(logs.every((line) => line.includes('synthetic storage failure')));
  assert.doesNotMatch(logs.join('\n'), /test-secret/);
});

test('domain validation and login errors keep their existing public statuses', async (t) => {
  const { DatabaseSync } = require('node:sqlite');
  const { MUSIC_SCHEMA } = require('../../src/storage/schema');
  const { createPlaybackStore } = require('../../src/storage/playback-store');
  const { validateAction, validateRules } = require('../../src/overtime/overtime-contract');
  const { createInteractionSessionService } = require('../../src/games/interaction-session-service');
  const { createWheelSessionService } = require('../../src/games/wheel-session-service');
  const { createGameSessionService } = require('../../src/games/game-session-service');
  const { createMusicCatalogService } = require('../../src/music/music-catalog-service');
  const db = new DatabaseSync(':memory:');
  db.exec(MUSIC_SCHEMA);
  t.after(() => db.close());
  const interactions = createInteractionSessionService();
  const wheel = createWheelSessionService();
  const games = createGameSessionService();
  t.after(() => { interactions.dispose(); wheel.dispose(); games.dispose(); });
  const { origin } = await listenHttpServer(t, {
    inflightTracker: { run: (run) => run() },
    createApiContext: () => ({
      sessionToken: 'synthetic-token', overtime: { act: validateAction, replaceRules: validateRules }, interactions, wheel, games,
      playback: createPlaybackStore(db),
      music: { registry: createMusicProviderRegistry(), catalog: createMusicCatalogService() },
    }),
  });
  for (const [path, body, status, message] of [
    ['/api/overtime/action', { action: 'invalid' }, 400, /action/],
    ['/api/overtime/rules', {
      rules: [{ giftId: '1', giftName: 'Synthetic gift', mode: 'fixed', fixedSeconds: 1, giftIdentity: {} }],
    }, 400, /重新选择/],
    ['/api/interactions/session/finish', { sessionId: 'old' }, 409, /刷新/],
    ['/api/games/session', { game: 'invalid' }, 400, /不支持/],
    ['/api/wheel/spin', {}, 400, /配置/],
    ['/api/playback/favorites', { track: {} }, 400, /曲目/],
    ['/api/music/playlists/tracks/add', { platform: 'qq', tracks: [{ sourceSongId: 1 }] }, 501, /登录/],
  ]) {
    const response = await fetch(origin + path, {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, status, path);
    assert.match((await response.json()).error, message, path);
  }
});

test('standalone HTTP failures log only a safe path and redacted error details', async (t) => {
  const output = [];
  t.mock.method(console, 'error', (...args) => output.push(util.format(...args)));
  const { origin } = await listenHttpServer(t, {
    servePageOrAsset() {
      throw new Error('fixture failure /resource?token=fake-stack-secret');
    },
  });
  const response = await fetch(`${origin}/fixture.svg?token=fake-request-secret&private=unneeded-query`);
  assert.equal(response.status, 500);
  await response.text();
  assert.equal(output.length, 1);
  assert.match(output[0], /fixture.svg/);
  assert.match(output[0], /fixture failure/);
  assert.doesNotMatch(output[0], /fake-(?:request|stack)-secret|unneeded-query/);
});
