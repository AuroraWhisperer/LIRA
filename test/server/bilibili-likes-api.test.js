'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createOverlayToken } = require('../../src/server/access-policy');
const { createRuntimeApiContextFactory } = require('../../src/server/runtime-api-context');
const { listenHttpServer } = require('../helpers/transport-fixtures');

const SESSION_TOKEN = 'synthetic-likes-admin';

async function fixture(t, getLikeState) {
  const localFetch = global.fetch;
  const upstreamFetch = t.mock.method(global, 'fetch', () => assert.fail('Reading likes must not request upstream data.'));
  t.after(() => assert.equal(upstreamFetch.mock.callCount(), 0));
  const createApiContext = createRuntimeApiContextFactory({
    maxBodyBytes: 1024,
    getSessionToken: () => SESSION_TOKEN,
    getDomainServices: () => ({ songs: {}, queue: {}, superChats: {}, gifts: {}, overtime: {}, data: {} }),
    getSettingsStore: () => ({}),
    getMusicRuntime: () => ({ getMusicRegistry: () => ({}), weSingCapture: {} }),
    getBilibiliRuntime: () => ({ getAuthProvider: () => null, getLikeState }),
    getAiRuntime: () => ({ configStore: {}, service: {} }),
    getLiveStatus: () => ({}),
    getDanmakuSender: () => ({}),
    getGameSessionService: () => undefined,
    getWheelSessionService: () => undefined,
  });
  const { origin } = await listenHttpServer(t, {
    inflightTracker: { run: (operation) => operation() },
    createApiContext,
  });
  return async (token) => {
    const response = await localFetch(`${origin}/api/bilibili/likes/state`, {
      headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.json() };
  };
}

test('management reads cached likes through both API contexts and the real HTTP route', async (t) => {
  const state = { roomId: '12345', count: 230, updatedAt: '2026-10-10T09:00:00.000Z', connected: true };
  const getLikeState = t.mock.fn(() => ({ ...state }));
  const read = await fixture(t, getLikeState);

  assert.deepEqual(await read(SESSION_TOKEN), { status: 200, body: { ok: true, data: state } });
  assert.equal(getLikeState.mock.callCount(), 1);
});

test('anonymous and overlay credentials cannot read management likes or invoke the getter', async (t) => {
  const getLikeState = t.mock.fn(() => assert.fail('Unauthorized requests must not read likes.'));
  const read = await fixture(t, getLikeState);

  const anonymous = await read();
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.ok, false);
  const overlay = await read(createOverlayToken(SESSION_TOKEN, 'danmaku'));
  assert.equal(overlay.status, 403);
  assert.equal(overlay.body.ok, false);
  assert.equal(getLikeState.mock.callCount(), 0);
});

test('unknown likes retain null count and timestamp without requesting upstream data', async (t) => {
  const state = { roomId: '12345', count: null, updatedAt: null, connected: false };
  const getLikeState = t.mock.fn(() => ({ ...state }));
  const read = await fixture(t, getLikeState);

  assert.deepEqual(await read(SESSION_TOKEN), { status: 200, body: { ok: true, data: state } });
  assert.equal(getLikeState.mock.callCount(), 1);
});
