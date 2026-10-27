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

function createRouteContext(result) {
  const calls = [];
  return {
    calls,
    context: {
      data: { clearAll() { calls.push('clear'); return result; } },
      gifts: { pauseDetection() {}, resumeDetection() {} },
      overtime: { pauseRecovery() {}, resumeRecovery() {} },
      giftSync: { rebuild() { calls.push('rebuild'); } },
      broadcastSnapshot(reason) { calls.push(reason); },
      cloudSync: { request(scope) { calls.push(scope); } },
    },
  };
}

test('clear-all route requires confirmation before invoking maintenance', async () => {
  const { context, calls } = createRouteContext();
  const response = createResponse();
  await clearAllRoute(context, { body: async () => ({}) }, response);
  assert.equal(response.status, 400);
  assert.deepEqual(response.payload, { ok: false, error: '缺少清空确认。' });
  assert.deepEqual(calls, []);
});

for (const result of [
  { cleared: true, giftProjectionReset: { sourceId: 7, projectionGeneration: 2 } },
  { cleared: false },
  { partial: true, committed: ['giftDb'], giftProjectionReset: { sourceId: 7, projectionGeneration: 2 }, error: 'Commit failed' },
]) {
  test('clear-all route maps the result and notifies only after non-partial maintenance: ' + JSON.stringify(result), async () => {
    const { context, calls } = createRouteContext(result);
    const response = createResponse();
    await clearAllRoute(context, { body: async () => ({ confirm: true }) }, response);
    if (result.partial) {
      assert.equal(response.status, 500);
      assert.deepEqual(response.payload, { ok: false, partial: true, error: result.error, data: result });
    } else {
      assert.equal(response.status, 200);
      assert.deepEqual(response.payload, { ok: true, data: result });
    }
    assert.deepEqual(calls, ['clear', ...(result.giftProjectionReset ? ['rebuild'] : []),
      ...(result.partial ? [] : ['database:clear-all', 'songs'])]);
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
