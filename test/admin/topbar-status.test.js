'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('compact live status distinguishes live, offline, delayed reception and unknown state', async () => {
  const { projectTopbarStatus: project } = await loadModuleExports(path.resolve('public/js/admin/live-status-presentation.js'));
  for (const message of [
    '直播弹幕长连失败，历史消息监听中',
    '弹幕长连已断开，历史消息监听中',
    '已开播，但弹幕长连重连失败，历史消息监听中',
    '直播弹幕长连重连失败，历史消息监听中',
  ]) {
    const status = project({ connected: true, enabled: true, message });
    assert.equal(status.label, '弹幕延迟', message);
    assert.equal(status.tone, 'warn');
    assert.match(status.detail, /弹幕可能延迟/);
  }
  const offline = project({ connected: true, enabled: true, message: '未开播，历史消息监听中' });
  assert.equal(offline.label, '未开播');
  assert.equal(offline.tone, '');
  assert.equal(offline.detail, '未开播，正在接收弹幕');
  const live = project({ connected: true, enabled: true, message: '已开播' });
  assert.equal(live.label, '已开播');
  assert.equal(live.tone, 'good');
  assert.notEqual(project({ connected: true, enabled: true, message: '已连接' }).label, '已开播');
  assert.equal(project({ connected: false, enabled: true, message: '已开播，正在重连礼物监听' }).tone, 'warn');
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
  renderConnectionStatus('disconnected');
  renderConnectionStatus('disconnected');
  renderLiveStatus({ ownerName: '主播', roomId: 123, enabled: true, connected: true, message: '未开播，历史消息监听中' });
  assert.equal(node('liveStatusLabel').textContent, '本机重连中');
  assert.equal(node('liveStatusOwner').hidden, true);
  assert.match(node('topbarStatusLive').textContent, /^上次状态：/);
  assert.equal(toasts.length, 1);
  renderConnectionStatus('connected');
  renderConnectionStatus('connected');
  assert.equal(node('liveStatusLabel').textContent, '未开播');
  assert.equal(node('liveStatus').className, 'pill topbar-live-status');
  assert.equal(node('liveStatusOwner').textContent, '主播');
  assert.equal(toasts.length, 2);
  assert.equal(toasts[0].key, toasts[1].key);
  renderConnectionStatus('shutdown');
  renderConnectionStatus('disconnected');
  assert.equal(node('liveStatusLabel').textContent, '程序已退出');
  assert.equal(toasts.length, 2);
  dispose();
});

test('refresh keeps its icon while busy and restores the accessible label after failure', async () => {
  const button = {
    innerHTML: '<svg></svg>', attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
  };
  let rejectFetch;
  const errors = [];
  const { createSettingsOperations } = await loadModuleExports(path.resolve('public/js/admin/settings-operations.js'));
  const operations = createSettingsOperations({
    documentRef: { getElementById: () => button },
    fetchRef: () => new Promise((resolve, reject) => { rejectFetch = reject; }),
    getForms: () => null, toast: (message) => errors.push(message),
  });
  const work = operations.reconnectBilibili();
  assert.equal(button.disabled, true);
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.equal(button.attributes['aria-label'], '正在连接直播间');
  assert.equal(button.innerHTML, '<svg></svg>');
  rejectFetch(new Error('连接中断'));
  await work;
  assert.equal(button.disabled, false);
  assert.equal(button.attributes['aria-busy'], undefined);
  assert.equal(button.attributes['aria-label'], '重新连接直播间');
  assert.equal(button.innerHTML, '<svg></svg>');
  assert.deepEqual(errors, ['连接中断']);
});
