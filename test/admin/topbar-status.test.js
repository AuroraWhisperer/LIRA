'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

function createReconnectButton(icon = { getAnimations: () => [] }) {
  return {
    innerHTML: '<svg></svg>', attributes: {},
    querySelector: () => icon,
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
  };
}

test('compact live status distinguishes live, offline, delayed reception and unknown state', async () => {
  const { projectTopbarStatus: project } = await loadModuleExports(path.resolve('public/js/admin/live-status-presentation.js'));
  const delayed = project({ connected: true, enabled: true, message: '已开播，但弹幕长连重连失败，历史消息监听中' });
  const offline = project({ connected: true, enabled: true, message: '未开播，历史消息监听中' });
  const live = project({ connected: true, enabled: true, message: '已开播' });
  assert.equal(delayed.tone, 'warn');
  assert.equal(new Set([delayed.label, offline.label, live.label]).size, 3);
  assert.notEqual(project({ connected: true, enabled: true, message: '已连接' }).label, live.label);
  assert.equal(project({ connected: false, enabled: true, message: '已开播，正在重连礼物监听' }).tone, 'warn');
  const failed = { connected: false, enabled: true, message: '直播间不存在，请检查直播间号' };
  assert.ok(project(failed).detail.includes(failed.message), 'connection failures retain their diagnostic reason');
});

test('one status survives live snapshots during disconnect, deduplicates toast and restores after reconnect', async () => {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', attributes: {}, style: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener() {}, matches() { return false; }, hidePopover() {},
    });
    return nodes.get(id);
  }
  const { initTopbarStatus, renderLiveStatus, renderConnectionStatus } = await loadModuleExports(path.resolve('public/js/admin/topbar-status.js'), {
    AbortController, document: { getElementById: node }, window: { addEventListener() {} },
  });
  const toasts = [];
  const dispose = initTopbarStatus({ showToast: (toast) => toasts.push(toast) });
  assert.equal(initTopbarStatus(), dispose, 'initialization is idempotent');
  renderConnectionStatus('connected');
  renderLiveStatus({ ownerName: '<img src=x>', roomId: 123, enabled: true, connected: true, message: '已开播' });
  assert.equal(node('liveStatusOwner').textContent, '<img src=x>', 'untrusted owner remains text');
  assert.equal(toasts.length, 0, 'healthy bootstrap is quiet');
  const live = node('liveStatusLabel').textContent;
  renderConnectionStatus('disconnected');
  renderConnectionStatus('disconnected');
  renderLiveStatus({ ownerName: '主播', roomId: 123, enabled: true, connected: true, message: '未开播，历史消息监听中' });
  const reconnecting = node('liveStatusLabel').textContent;
  assert.notEqual(reconnecting, live);
  assert.equal(toasts.length, 1);
  renderConnectionStatus('connected');
  renderConnectionStatus('connected');
  assert.ok(![live, reconnecting].includes(node('liveStatusLabel').textContent), 'the newer live snapshot is restored');
  assert.equal(toasts.length, 2);
  assert.equal(toasts[0].key, toasts[1].key);
  renderConnectionStatus('shutdown');
  const shutdown = node('liveStatusLabel').textContent;
  renderConnectionStatus('disconnected');
  assert.equal(node('liveStatusLabel').textContent, shutdown);
  assert.notEqual(shutdown, reconnecting);
  assert.equal(toasts.length, 2);
  dispose();
});

test('refresh blocks repeated reconnects while busy and reports a failure', async () => {
  const button = createReconnectButton();
  let rejectFetch;
  const errors = [];
  const { createSettingsOperations } = await loadModuleExports(path.resolve('public/js/admin/settings-operations.js'));
  const operations = createSettingsOperations({
    documentRef: { getElementById: () => button },
    fetchRef: () => new Promise((resolve, reject) => { rejectFetch = reject; }),
    toast: (message) => errors.push(message),
  });
  const work = operations.reconnectBilibili();
  assert.equal(button.disabled, true);
  rejectFetch(new Error('连接中断'));
  await work;
  assert.equal(button.disabled, false);
  assert.deepEqual(errors, ['连接中断']);
});

test('refresh does not report a missing live status as success', async () => {
  const button = createReconnectButton();
  const errors = [];
  const results = [];
  const { createSettingsOperations } = await loadModuleExports(path.resolve('public/js/admin/settings-operations.js'));
  const operations = createSettingsOperations({
    documentRef: { getElementById: () => button },
    fetchRef: async () => ({ ok: true }),
    readJsonResponse: async () => ({ ok: true, data: {} }),
    getState: () => null,
    toast: (message) => errors.push(message), showStackedToast: (result) => results.push(result),
  });
  await operations.reconnectBilibili();
  assert.equal(button.disabled, false);
  assert.equal(errors.length, 1);
  assert.equal(results.length, 0);
});
