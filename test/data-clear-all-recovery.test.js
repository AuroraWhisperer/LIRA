'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { routes } = require('../src/server/routes/data-routes');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '..');
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

  await assert.rejects(
    clearAllRoute(
      context,
      { body: async () => ({ confirm: true }) },
      createResponse(),
    ),
    failure,
  );
  assert.deepEqual(calls, [
    'gifts:pause',
    'overtime:pause',
    'gifts:resume',
    'overtime:resume',
  ]);
});

test('clear-all route keeps writers paused after a partial commit failure', async () => {
  const result = {
    partial: true,
    committed: ['songDb'],
    failed: ['superChatDb'],
    error: 'Commit failed at superChatDb',
  };
  const { context, calls } = createRouteContext(() => result);
  const response = createResponse();

  await clearAllRoute(
    context,
    { body: async () => ({ confirm: true }) },
    response,
  );

  assert.equal(response.status, 500);
  assert.equal(response.payload.partial, true);
  assert.deepEqual(response.payload.data, result);
  assert.deepEqual(calls, [
    'gifts:pause',
    'overtime:pause',
    'music:clear-cache',
  ]);
});

test('partial clear-all rebuilds when the gift projection already committed', async () => {
  const result = {
    partial: true,
    committed: ['songDb', 'superChatDb', 'giftDb'],
    failed: ['musicDb'],
    error: 'Commit failed at musicDb',
    giftProjectionReset: { sourceId: 7, projectionGeneration: 2 },
  };
  const { context, calls } = createRouteContext(() => result);
  context.giftSync = {
    rebuild() {
      calls.push('gift-sync:rebuild');
      return Promise.resolve(true);
    },
  };
  const response = createResponse();

  await clearAllRoute(
    context,
    { body: async () => ({ confirm: true }) },
    response,
  );

  assert.equal(response.status, 500);
  assert.equal(response.payload.partial, true);
  assert.deepEqual(calls, [
    'gifts:pause',
    'overtime:pause',
    'music:clear-cache',
    'gift-sync:rebuild',
  ]);
});

test('clear-all route resumes writers and broadcasts after success', async () => {
  const { context, calls } = createRouteContext(() => ({
    cleared: true,
    scope: 'all',
  }));
  const response = createResponse();

  await clearAllRoute(
    context,
    { body: async () => ({ confirm: true }) },
    response,
  );

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.deepEqual(calls, [
    'gifts:pause',
    'overtime:pause',
    'music:clear-cache',
    'gifts:resume',
    'overtime:resume',
    'broadcast:database:clear-all',
  ]);
});

test('successful projection clears trigger a gift bootstrap rebuild', async () => {
  const { context, calls } = createRouteContext(() => ({
    cleared: true,
    scope: 'all',
    giftProjectionReset: { sourceId: 7, projectionGeneration: 2 },
  }));
  context.giftSync = {
    rebuild() {
      calls.push('gift-sync:rebuild');
      return Promise.resolve(true);
    },
  };

  await clearAllRoute(
    context,
    { body: async () => ({ confirm: true }) },
    createResponse(),
  );

  assert.deepEqual(calls, [
    'gifts:pause',
    'overtime:pause',
    'music:clear-cache',
    'gifts:resume',
    'overtime:resume',
    'gift-sync:rebuild',
    'broadcast:database:clear-all',
  ]);
});

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

  await clearGiftsRoute(
    context,
    { body: async () => ({ confirm: true }) },
    response,
  );

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.deepEqual(response.payload.data.remoteDeletedCounts, {
    giftEvents: 12,
    giftEventDeliveries: 10,
  });
  assert.deepEqual(calls, [
    'remote:clear',
    'local:clear',
    'gift-sync:rebuild',
    'broadcast:database:clear-gifts',
  ]);
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

  await clearGiftsRoute(
    context,
    { body: async () => ({ confirm: true }) },
    response,
  );

  assert.equal(response.status, 502);
  assert.equal(
    response.payload.error,
    '服务器礼物流水清理失败，本地数据未删除。',
  );
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

  await clearGiftsRoute(
    context,
    { body: async () => ({ confirm: true }) },
    response,
  );

  assert.equal(response.status, 500);
  assert.equal(response.payload.partial, true);
  assert.equal(
    response.payload.error,
    '服务器礼物流水已清空，但本地清理失败，正在重新同步。',
  );
  assert.deepEqual(calls, [
    'remote:clear',
    'local:clear',
    'gift-sync:rebuild',
  ]);
});

test('shared api preserves the parsed error payload and HTTP status', async () => {
  const payload = {
    ok: false,
    partial: true,
    error: 'Commit failed at superChatDb',
    data: { committed: ['songDb'], failed: ['superChatDb'] },
  };
  const utils = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'),
    {
      document: {
        getElementById() {
          return null;
        },
      },
      fetch: async () => ({
        ok: false,
        status: 500,
        async text() {
          return JSON.stringify(payload);
        },
      }),
    },
  );

  let caught;
  try {
    await utils.api('/api/database/clear-all', { confirm: true });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.message, payload.error);
  assert.equal(caught.status, 500);
  assert.deepEqual(JSON.parse(JSON.stringify(caught.payload)), payload);
});

test('Admin clear-all alerts and reloads for a structured partial failure', async () => {
  const { createSettingsOperations } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-operations.js'),
  );
  const payload = {
    ok: false,
    partial: true,
    error: 'Commit failed at superChatDb',
    data: { committed: ['songDb'], failed: ['superChatDb'] },
  };
  const error = new Error(payload.error);
  error.payload = payload;
  const alerts = [];
  const toasts = [];
  let reloadCount = 0;
  const operations = createSettingsOperations({
    documentRef: {},
    windowRef: {},
    locationRef: {
      reload() {
        reloadCount += 1;
      },
    },
    localStorageRef: null,
    fetchRef: async () => ({}),
    alertRef(message) {
      alerts.push(message);
    },
    async api() {
      throw error;
    },
    async readJsonResponse() {
      return {};
    },
    toast(message) {
      toasts.push(message);
    },
    showStackedToast() {},
    async dangerConfirm() {
      return true;
    },
    async showConfirmationDialog() {
      return true;
    },
    getState() {
      return null;
    },
    getQueue() {
      return null;
    },
    getForms() {
      return null;
    },
  });

  await operations.clearAll();

  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /songDb/);
  assert.match(alerts[0], /superChatDb/);
  assert.equal(reloadCount, 1);
  assert.deepEqual(toasts, []);
});
