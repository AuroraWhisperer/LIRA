'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { routes } = require('../../src/server/routes/data-routes');

const clearAllRoute = routes['POST /api/database/clear-all'];
const clearGiftsRoute = routes['POST /api/database/clear-gifts'];

function createResponse() {
  return {
    status: 0,
    payload: null,
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.payload = JSON.parse(body);
    },
  };
}

function createRouteContext(clearAll) {
  const calls = [];
  return {
    calls,
    context: {
      data: { clearAll },
      gifts: {
        pauseDetection() {
          calls.push('gifts:pause');
        },
        resumeDetection() {
          calls.push('gifts:resume');
        },
      },
      overtime: {
        pauseRecovery() {
          calls.push('overtime:pause');
        },
        resumeRecovery() {
          calls.push('overtime:resume');
        },
      },
      music: {
        clearCache() {
          calls.push('music:clear-cache');
        },
      },
      broadcastSnapshot(reason) {
        calls.push(`broadcast:${reason}`);
      },
    },
  };
}

test('clear-all route resumes writers after a fully rolled-back exception', async () => {
  const failure = new Error('Clear-all pre-commit failed: giftDb delete');
  const { context, calls } = createRouteContext(() => {
    throw failure;
  });

  await assert.rejects(clearAllRoute(context, { body: async () => ({ confirm: true }) }, createResponse()), failure);
  assert.deepEqual(calls, ['gifts:pause', 'overtime:pause', 'overtime:resume', 'gifts:resume']);
});

for (const [name, giftProjectionReset, expectedCalls] of [
  [
    'clear-all route keeps writers paused after a partial commit failure',
    undefined,
    ['gifts:pause', 'overtime:pause', 'music:clear-cache'],
  ],
  [
    'partial clear-all rebuilds when the gift projection already committed',
    { sourceId: 7, projectionGeneration: 2 },
    ['gifts:pause', 'overtime:pause', 'music:clear-cache', 'gift-sync:rebuild'],
  ],
]) {
  test(name, async () => {
    const result = {
      partial: true,
      committed: giftProjectionReset ? ['songDb', 'superChatDb', 'giftDb'] : ['songDb'],
      failed: [giftProjectionReset ? 'musicDb' : 'superChatDb'],
      error: 'Commit failed',
      ...(giftProjectionReset ? { giftProjectionReset } : {}),
    };
    const { context, calls } = createRouteContext(() => result);
    context.giftSync = {
      rebuild() {
        calls.push('gift-sync:rebuild');
        return Promise.resolve(true);
      },
    };
    const response = createResponse();

    await clearAllRoute(context, { body: async () => ({ confirm: true }) }, response);

    assert.equal(response.status, 500);
    assert.equal(response.payload.partial, true);
    assert.deepEqual(response.payload.data, result);
    assert.deepEqual(calls, expectedCalls);
  });
}

for (const [name, giftProjectionReset, expectedCalls] of [
  [
    'clear-all route resumes writers and broadcasts after success',
    undefined,
    [
      'gifts:pause',
      'overtime:pause',
      'music:clear-cache',
      'overtime:resume',
      'gifts:resume',
      'broadcast:database:clear-all',
    ],
  ],
  [
    'successful projection clears trigger a gift bootstrap rebuild',
    { sourceId: 7, projectionGeneration: 2 },
    [
      'gifts:pause',
      'overtime:pause',
      'music:clear-cache',
      'overtime:resume',
      'gifts:resume',
      'gift-sync:rebuild',
      'broadcast:database:clear-all',
    ],
  ],
]) {
  test(name, async () => {
    const { context, calls } = createRouteContext(() => ({
      cleared: true,
      scope: 'all',
      ...(giftProjectionReset ? { giftProjectionReset } : {}),
    }));
    context.giftSync = {
      rebuild() {
        calls.push('gift-sync:rebuild');
        return Promise.resolve(true);
      },
    };
    const response = createResponse();

    await clearAllRoute(context, { body: async () => ({ confirm: true }) }, response);

    assert.equal(response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.deepEqual(calls, expectedCalls);
  });
}

test('gift database clear deletes remotely before clearing and rebuilding locally', async () => {
  const calls = [];
  const context = {
    data: {
      clearGifts() {
        calls.push('local:clear');
        return {
          gifts: 12,
          overtimeSettlements: 3,
          projectionReset: { sourceId: 7, projectionGeneration: 2 },
        };
      },
    },
    giftSync: {
      async clearRemote() {
        calls.push('remote:clear');
        return {
          ok: true,
          deletedCounts: { giftEvents: 12, giftEventDeliveries: 10 },
          syncEpoch: 'epoch-2',
        };
      },
      rebuild() {
        calls.push('gift-sync:rebuild');
        return Promise.resolve(true);
      },
    },
    broadcastSnapshot(reason) {
      calls.push(`broadcast:${reason}`);
    },
  };
  const response = createResponse();

  await clearGiftsRoute(context, { body: async () => ({ confirm: true }) }, response);

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.deepEqual(response.payload.data.remoteDeletedCounts, {
    giftEvents: 12,
    giftEventDeliveries: 10,
  });
  assert.deepEqual(calls, ['remote:clear', 'local:clear', 'gift-sync:rebuild', 'broadcast:database:clear-gifts']);
});

test('gift database clear preserves local data when server deletion fails', async () => {
  const calls = [];
  const context = {
    data: {
      clearGifts() {
        calls.push('local:clear');
      },
    },
    giftSync: {
      async clearRemote() {
        calls.push('remote:clear');
        throw Object.assign(new Error('HTTP_404'), { code: 'HTTP_404' });
      },
    },
    broadcastSnapshot() {
      calls.push('broadcast');
    },
  };
  const response = createResponse();

  await clearGiftsRoute(context, { body: async () => ({ confirm: true }) }, response);

  assert.equal(response.status, 502);
  assert.equal(response.payload.error, '服务器礼物流水清理失败，本地数据未删除。');
  assert.deepEqual(calls, ['remote:clear']);
});

test('gift database clear reports a partial result and rebuilds after local failure', async () => {
  const failure = new Error('local database unavailable');
  const calls = [];
  const context = {
    data: {
      clearGifts() {
        calls.push('local:clear');
        throw failure;
      },
    },
    giftSync: {
      async clearRemote() {
        calls.push('remote:clear');
        return {
          ok: true,
          deletedCounts: { giftEvents: 12, giftEventDeliveries: 10 },
          syncEpoch: 'epoch-2',
        };
      },
      rebuild() {
        calls.push('gift-sync:rebuild');
        return Promise.resolve(true);
      },
    },
    broadcastSnapshot() {
      calls.push('broadcast');
    },
  };
  const response = createResponse();

  await clearGiftsRoute(context, { body: async () => ({ confirm: true }) }, response);

  assert.equal(response.status, 500);
  assert.equal(response.payload.partial, true);
  assert.equal(response.payload.error, '服务器礼物流水已清空，但本地清理失败，正在重新同步。');
  assert.deepEqual(calls, ['remote:clear', 'local:clear', 'gift-sync:rebuild']);
});
