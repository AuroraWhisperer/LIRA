'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createOverlayToken } = require('../../src/server/access-policy');
const { createRuntimeApiContextFactory } = require('../../src/server/runtime-api-context');
const { listenHttpServer } = require('../helpers/transport-fixtures');

test('rankings require admin access and unchanged reads still renew shared demand', async t => {
  const token = 'synthetic-rankings-admin';
  const getSnapshot = t.mock.fn(() => ({ version: 'rank-1', serverNow: 1000, room: { roomId: '88' }, boards: [] }));
  const createApiContext = createRuntimeApiContextFactory({
    maxBodyBytes: 1024, getSessionToken: () => token, getLiveRankings: () => ({ getSnapshot }),
    getDomainServices: () => ({ songs: {}, queue: {}, superChats: {}, gifts: {}, overtime: {}, data: {} }),
    getSettingsStore: () => ({}), getMusicRuntime: () => ({ getMusicRegistry: () => ({}), weSingCapture: {} }),
    getBilibiliRuntime: () => ({ getAuthProvider: () => null }), getAiRuntime: () => ({ configStore: {}, service: {} }),
    getLiveStatus: () => ({}), getDanmakuSender: () => ({}),
    getGameSessionService: () => undefined, getWheelSessionService: () => undefined,
  });
  const { origin } = await listenHttpServer(t, { inflightTracker: { run: work => work() }, createApiContext });
  const read = (credential, query = '') => fetch(`${origin}/api/bilibili/live-rankings${query}`, {
    headers: credential ? { Authorization: `Bearer ${credential}` } : {},
  });
  assert.equal((await read()).status, 401);
  assert.equal((await read(createOverlayToken(token, 'danmaku'))).status, 403);
  assert.equal(getSnapshot.mock.callCount(), 0);
  const initial = await read(token);
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.equal((await initial.json()).data.room.roomId, '88');
  const unchanged = await read(token, '?version=rank-1');
  assert.equal((await unchanged.json()).data.unchanged, true);
  assert.equal(getSnapshot.mock.callCount(), 2);
});
