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

test('settings render reads each component once and projects the current isolated draft to both views', async () => {
  const entry = file => path.resolve('public/js/admin', file);
  const [renderer, sync] = await loadModuleExports([
    entry('state-renderer.js'), entry('component-settings-sync.js'),
  ], { document: { getElementById: () => null } });
  const { createComponentConfigController } = await loadModuleExports(entry('component-config-controller.js'));
  const controller = createComponentConfigController({ initial: { size: 24 } });
  sync.registerComponentSettings('example', controller, settings => ({ size: settings.size }), draft => draft);
  controller.edit({ size: 32 });
  let reads = 0;
  const getState = controller.getState;
  controller.getState = () => { reads++; return getState(); };
  const formValues = [];
  const styleValues = [];
  const render = renderer.createAdminStateRenderer({ renderQueue() {}, renderGifts() {},
    renderSettings: (settings, projected) => formValues.push(projected),
    renderQueueStyle: values => styleValues.push(values) });
  const settings = { size: 28, requestPrice: 50 };
  render({ state: { settings }, changedKeys: ['settings'] });
  assert.equal(reads, 1);
  assert.equal(formValues[0].size, 32);
  assert.equal(styleValues[0].size, 32);
  assert.equal(styleValues[0].requestPrice, 50);
  assert.equal(getState().saved.size, 28);
  assert.equal(getState().conflict, true);
  styleValues[0].size = 99;
  assert.equal(settings.size, 28);
  assert.equal(getState().draft.size, 32, 'view snapshots cannot mutate the draft owner');

  controller.edit({ size: 40 });
  render({ state: { settings }, changedKeys: ['settings'] });
  assert.equal(reads, 2);
  assert.equal(formValues[1].size, 40);
  assert.equal(styleValues[1].size, 40, 'a later render projects fresh draft values');
});
