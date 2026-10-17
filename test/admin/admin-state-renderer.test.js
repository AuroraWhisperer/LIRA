'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

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
