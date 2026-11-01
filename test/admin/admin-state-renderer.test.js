'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

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
