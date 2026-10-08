'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const entry = (name) => path.join(__dirname, '../../public/js', name);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('queue A/B/A drafts save all changed styles and exclude unrelated settings', async () => {
  const config = await loadModuleExports(entry('admin/queue-theme-config.js'));
  const { createComponentConfigController } = await loadModuleExports(entry('admin/component-config-controller.js'));
  let settings = config.queueConfigFromSettings(DEFAULT_SETTINGS);
  let fail = true;
  let payload;
  const controller = createComponentConfigController({ initial: settings, persist: async (draft, changed) => {
    payload = config.queueSettingsPayload(draft, { ...changed, enableRequest: 'false', adminToken: 'private' });
    if (fail) throw new Error('离线');
    settings = { ...settings, ...payload };
    return settings;
  } });
  controller.edit({ overlayQueueStyle: 'storybook', storybookQueueFontSize: '36' });
  controller.edit({ overlayQueueStyle: 'neon-vinyl', neonVinylQueueFontSize: '42' });
  controller.edit({ overlayQueueStyle: 'storybook' });
  assert.equal(controller.getState().draft.storybookQueueFontSize, '36');
  assert.equal(await controller.save(), false);
  assert.equal(controller.getState().draft.neonVinylQueueFontSize, '42');
  assert.deepEqual(plain(payload), { overlayQueueStyle: 'storybook', storybookQueueFontSize: '36', neonVinylQueueFontSize: '42' });
  fail = false;
  assert.equal(await controller.save(), true);
  assert.equal(controller.getState().dirty, false);
});

test('settings refill projects component drafts while preserving other domain fields', async () => {
  const sync = await loadModuleExports(entry('admin/component-settings-sync.js'));
  const { createComponentConfigController } = await loadModuleExports(entry('admin/component-config-controller.js'));
  const controller = createComponentConfigController({ initial: { size: 24 }, persist: async (draft) => draft });
  const stop = sync.registerComponentSettings('example', controller, (settings) => ({ size: settings.size }), (draft) => draft);
  controller.edit({ size: 32 });
  sync.receiveComponentSettings({ size: 28, requestPrice: 50 });
  assert.deepEqual(plain(sync.projectComponentDrafts({ size: 28, requestPrice: 50 })), { size: 32, requestPrice: 50 });
  assert.equal(controller.getState().conflict, true);
  controller.discard();
  assert.equal(sync.projectComponentDrafts({ size: 0 }).size, 28);
  stop();
  assert.equal(sync.projectComponentDrafts({ size: 0 }).size, 0);
});

test('preview client accepts only its exact parent and origin and releases listeners', async () => {
  const listeners = new Map();
  const messages = [];
  const configs = [];
  let disposed = 0;
  const parent = { postMessage: (...args) => messages.push(args) };
  const window = { parent, addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name) };
  const { createComponentPreviewClient } = await loadModuleExports(entry('overlays/component-preview-client.js'), {
    window, URL, URLSearchParams, location: new URL('http://127.0.0.1:3000/queue?componentPreview=1'),
    requestAnimationFrame: callback => callback(),
  });
  const client = createComponentPreviewClient({ onConfig: (config) => configs.push(config), onDispose: () => disposed++ });
  assert.equal(messages[0][1], 'http://127.0.0.1:3000');
  const receive = listeners.get('message');
  const data = { type: 'component-preview:config', config: { size: 36 } };
  receive({ source: {}, origin: 'http://127.0.0.1:3000', data });
  receive({ source: parent, origin: 'https://untrusted.test', data });
  assert.equal(configs.length, 0);
  await receive({ source: parent, origin: 'http://127.0.0.1:3000', data });
  assert.equal(configs.length, 1);
  assert.equal(messages.at(-1)[0].type, 'component-preview:prepared');
  client.dispose();
  client.dispose();
  receive({ source: parent, origin: 'http://127.0.0.1:3000', data });
  assert.equal(configs.length, 1);
  assert.equal(disposed, 1);
  assert.equal(listeners.size, 0);
});

test('danmaku region intent preserves current appearance and other regions', async () => {
  const { applyDanmakuRegionEdit } = await loadModuleExports(entry('admin/danmaku-canvas-dialog.js'));
  const { createLayout } = await loadModuleExports(entry('shared/danmaku-layout.js'));
  const { createComponentConfigController } = await loadModuleExports(entry('admin/component-config-controller.js'));
  const initial = { style: 'signal', fullscreenDurationSeconds: 8, styleOptions: { signal: { fontSize: 36 } }, layout: createLayout() };
  const controller = createComponentConfigController({ initial, persist: async (draft) => draft });
  const region = { ...initial.layout.regions.signal, x: 100, y: 100 };
  applyDanmakuRegionEdit(controller, { style: 'signal', region, styleOptions: {} });
  const next = controller.getState().draft;
  assert.equal(next.layout.regions.signal.x, 100);
  assert.deepEqual(plain(next.styleOptions), initial.styleOptions);
  assert.equal(next.fullscreenDurationSeconds, 8);
  for (const [style, saved] of Object.entries(initial.layout.regions)) {
    if (style !== 'signal') assert.deepEqual(plain(next.layout.regions[style]), plain(saved));
  }
});

test('overtime projection excludes configuration secrets and settlement data', async () => {
  const { projectOvertimePreviewState } = await loadModuleExports(entry('admin/overtime-preview.js'));
  const projected = projectOvertimePreviewState({ revision: 5, status: 'paused', effectiveRemainingMs: 60000,
    background: { path: 'saved.png' }, settlements: [{ private: true }], token: 'private',
    rules: [{ giftId: '1', giftName: '礼物', internalId: 'private' }] });
  assert.equal(projected.revision, 5);
  assert.equal(projected.effectiveRemainingMs, 60000);
  for (const key of ['token', 'background', 'settlements']) assert.equal(Object.hasOwn(projected, key), false);
  assert.equal(Object.hasOwn(projected.rules[0], 'internalId'), false);
});

test('closing parameter panels releases observed ranges and their event listeners', async () => {
  const observed = new Set();
  const listeners = new Set();
  const input = { min: '0', max: '100', value: '50', matches: () => true,
    style: { setProperty() {} }, addEventListener: (name) => listeners.add(name),
    removeEventListener: (name) => listeners.delete(name) };
  class ResizeObserver {
    observe(node) { observed.add(node); }
    unobserve(node) { observed.delete(node); }
  }
  const ranges = await loadModuleExports(entry('shared/parameter-range.js'), { ResizeObserver });
  ranges.initParameterRanges(input);
  ranges.initParameterRanges(input);
  assert.equal(observed.size, 1);
  ranges.disposeParameterRanges(input);
  assert.equal(observed.size, 0);
  assert.equal(listeners.size, 0);
  ranges.initParameterRanges(input);
  assert.equal(observed.size, 1);
  ranges.disposeParameterRanges(input);
});
