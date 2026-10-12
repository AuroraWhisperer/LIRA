'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('shared api preserves the parsed error payload and HTTP status', async () => {
  const payload = {
    ok: false,
    partial: true,
    error: 'Commit failed at superChatDb',
    data: { committed: ['songDb'], failed: ['superChatDb'] },
  };
  const utils = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'), {
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
  });

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
  assert.match(alerts[0], /仍暂停.*刷新页面不会恢复/);
  assert.match(alerts[0], /桌面更新.*日志目录.*再次完整清空/);
  assert.equal(reloadCount, 1);
  assert.deepEqual(toasts, []);
});

for (const [phase, message] of [['runtime-reset', '运行状态重载失败'], ['resume', '写入恢复失败']]) {
  test(`Admin clear-all describes ${phase} without an empty failed-database row`, async () => {
    const { createSettingsOperations } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/settings-operations.js'));
    const alerts = [];
    let reloads = 0;
    const operations = createSettingsOperations({
      documentRef: {}, windowRef: {}, locationRef: { reload() { reloads++; } }, localStorageRef: null,
      alertRef: value => alerts.push(value), dangerConfirm: async () => true,
      api: async () => {
        const error = new Error(message);
        error.payload = { partial: true, error: message, data: { phase, committed: ['songDb', 'giftDb'], failed: [] } };
        throw error;
      },
      toast() { assert.fail('partial failure must use a blocking explanation'); },
    });
    await operations.clearAll();
    assert.equal(reloads, 1);
    assert.match(alerts[0], new RegExp(message));
    assert.match(alerts[0], /数据库已提交/);
    assert.doesNotMatch(alerts[0], /✗ 失败/);
    assert.match(alerts[0], /仍暂停.*刷新页面不会恢复/);
  });
}
