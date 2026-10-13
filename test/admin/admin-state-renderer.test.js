'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('Admin connection status renders disconnect, reconnect and shutdown in the view', async () => {
  const status = { hidden: true, textContent: '', className: '' };
  let statusNode = status;
  const { renderConnectionStatus } = await loadModuleExports(path.resolve('public/js/admin/state-renderer.js'), {
    document: { getElementById: () => statusNode },
  });
  renderConnectionStatus('disconnected');
  assert.deepEqual(status, { hidden: false, textContent: '与本机服务的连接已断开，正在重连', className: 'pill warn' });
  renderConnectionStatus('connected');
  assert.equal(status.hidden, true);
  renderConnectionStatus('shutdown');
  assert.deepEqual(status, { hidden: false, textContent: '程序已退出', className: 'pill warn' });
  statusNode = null;
  assert.doesNotThrow(() => renderConnectionStatus('shutdown'));
});

test('live status distinguishes delayed fallback from normal offline-room reception', async () => {
  const node = {};
  const { createAdminStateRenderer } = await loadModuleExports(path.resolve('public/js/admin/state-renderer.js'), {
    document: { getElementById: () => node },
  });
  const render = createAdminStateRenderer({ renderGifts() {} });
  for (const message of [
    '直播弹幕长连失败，历史消息监听中',
    '弹幕长连已断开，历史消息监听中',
    '已开播，但弹幕长连重连失败，历史消息监听中',
    '直播弹幕长连重连失败，历史消息监听中',
  ]) {
    render({ state: { liveStatus: { connected: true, enabled: true, message } } });
    assert.equal(node.className, 'pill warn', message);
    assert.match(node.innerHTML, /弹幕可能延迟/);
  }
  render({ state: { liveStatus: { connected: true, enabled: true, message: '未开播，历史消息监听中' } } });
  assert.equal(node.className, 'pill good');
  assert.equal(node.innerHTML, '未开播，正在接收弹幕');
});

test('Admin routes changed fields only to views that consume them', async () => {
  const { createAdminStateRenderer } = await loadModuleExports(path.resolve('public/js/admin/state-renderer.js'), {
    document: {},
  });
  const calls = [];
  const render = createAdminStateRenderer(
    Object.fromEntries(
      [
        'renderQueue',
        'renderSuperChats',
        'renderSettings',
        'renderQueueStyle',
        'renderGifts',
        'renderLive',
        'renderCategories',
        'renderSongCount',
      ].map((name) => [name, () => calls.push(name)]),
    ),
  );
  render({
    state: { gifts: { recent: [{ id: 1 }] } },
    changedKeys: ['gifts'],
  });
  assert.deepEqual(calls, ['renderGifts']);
  calls.length = 0;
  render({ state: {}, changedKeys: ['settings', 'queue'] });
  assert.deepEqual(calls, ['renderSettings', 'renderQueueStyle', 'renderQueue', 'renderGifts']);
  calls.length = 0;
  render({ state: {}, changedKeys: [] });
  assert.deepEqual(calls, []);
});

test('queue refreshes its receiving hint only when relevant settings change', async () => {
  const { createAdminStateRenderer } = await loadModuleExports(path.resolve('public/js/admin/state-renderer.js'), {
    document: {},
  });
  const queue = { current: null, waiting: [] };
  const calls = [];
  const render = createAdminStateRenderer({
    renderQueue: (...args) => calls.push(args),
    renderSettings() {},
    renderQueueStyle() {},
    renderGifts() {},
  });
  let settings = { paused: 'false', danmakuMonitoringEnabled: 'true' };
  render({ state: { queue, settings }, changedKeys: ['queue', 'settings'] });
  assert.deepEqual(calls, [[queue, settings]]);
  settings = { ...settings, songFontSize: 24 };
  render({ state: { queue, settings }, changedKeys: ['settings'] });
  assert.equal(calls.length, 1, 'unrelated settings do not rebuild the queue');
  settings = { ...settings, paused: 'true' };
  render({ state: { queue, settings }, changedKeys: ['settings'] });
  assert.deepEqual(calls[1], [queue, settings]);
  settings = { ...settings, danmakuMonitoringEnabled: 'false' };
  render({ state: { queue, settings }, changedKeys: ['settings'] });
  assert.deepEqual(calls[2], [queue, settings]);
  render({ state: { queue, settings }, changedKeys: ['queue'] });
  assert.equal(calls.length, 4, 'queue changes still render with unchanged settings');
});
