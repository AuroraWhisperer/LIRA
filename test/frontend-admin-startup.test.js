'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');
const noop = () => {};

test('legacy danmaku initialization preserves reconnect defaults and explicit injection', async () => {
  const calls = [];
  const window = {
    AdminApp: {
      settings: {
        reconnectBilibili: () => calls.push('legacy'),
      },
    },
  };
  const { publishDanmakuTool } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/legacy-admin-bridge.js'),
    { window },
  );
  publishDanmakuTool({
    init: ({ reconnectBilibili }) => reconnectBilibili(),
    refresh: noop,
  });
  window.AdminApp.danmakuTool.init();
  window.AdminApp.danmakuTool.init({ reconnectBilibili: undefined });
  window.AdminApp.danmakuTool.init({ reconnectBilibili: () => calls.push('explicit') });
  assert.deepEqual(calls, ['legacy', 'legacy', 'explicit']);
});

async function createStartupFixture() {
  const theme = Promise.withResolvers();
  const data = Promise.withResolvers();
  const dataRequested = Promise.withResolvers();
  const classes = new Set(['desktop-shell', 'admin-starting']);
  const calls = [];
  const errors = [];
  let start;
  const modules = {
    desktop: { initDesktopShell: () => calls.push('desktop') },
  };
  const context = vm.createContext({
    window: { addEventListener: noop },
    document: {
      readyState: 'interactive',
      documentElement: { classList: { remove: (name) => classes.delete(name) } },
      querySelectorAll: () => [],
      addEventListener: (name, listener) => {
        if (name === 'DOMContentLoaded') start = listener;
      },
    },
  });
  const dependencies = {
    '../shared/event-bus.js': { eventBus: { on: noop }, Events: {} },
    '../shared/logger.js': { logger: { debug: noop, error: noop } },
    '../shared/utils.js': { showError: (error) => errors.push(error) },
    '../shared/theme.js': {
      theme: {},
      loadThemeConfig: () => {
        calls.push('theme');
        return theme.promise;
      },
    },
    '../shared/parameter-range.js': { initParameterRanges: noop },
    '../shared/select-menu.js': { enhanceSelects: noop },
    './legacy-admin-bridge.js': {
      getLegacyAdminModules: () => modules,
      publishNavigation: noop,
    },
    './usage-guide.js': { initUsageGuide: noop },
    './toolbox-lifecycle.js': { createToolboxLifecycle: () => ({ dispose: noop }) },
    './dynamic-lottery.js': { initDynamicLottery: () => ({ dispose: noop }) },
    './interactive-tour.js': { initInteractiveTour: () => ({ claimAutoOpen: () => false }) },
    './gift-frame.js': { initGiftFrame: noop },
    './gifts/history.js': { initGiftHistoryDrawer: noop },
    './gifts/index.js': { renderGiftPanel: noop },
    './song-import-update.js': { initSongImportUpdate: noop },
    './state.js': {
      stateService: {
        connectSocket: noop,
        reloadAll: () => {
          dataRequested.resolve();
          return data.promise;
        },
      },
    },
    './forms.js': {
      formsService: {
        initWorkspaceControls: () => calls.push('workspace'),
        initTabs: noop,
      },
    },
    './queue.js': { initQueueForm: noop },
    './songs.js': { songs: { initSongForm: noop, renderSongs: noop } },
    './metrics.js': { metrics: { initPerformanceMonitor: noop } },
    './todo.js': { todo: { init: noop } },
    './gift-effects.js': { giftEffects: { init: noop } },
    './other.js': { other: { initOtherPage: noop, selectFeatureById: noop } },
    './danmaku-tool.js': { danmakuTool: {} },
    './ai-assistant-settings.js': { aiAssistantSettings: {} },
    './desktop-lyric.js': { desktopLyric: { initDesktopLyricForm: noop } },
    './import.js': { songImports: {} },
    './settings.js': {
      settings: {
        initSettingsForm: () => calls.push('settings'),
        initBilibiliAuth: noop,
      },
    },
    './theme.js': { theme: { initThemeForm: noop, renderPresetCards: noop } },
    './display.js': { display: { initDisplayForm: noop, initOverlayUrls: noop } },
    './state-renderer.js': { createAdminStateRenderer: noop },
  };
  const entry = new vm.SourceTextModule(fs.readFileSync(path.join(ROOT_DIR, 'public/js/admin/app.js'), 'utf8'), {
    context,
  });
  await entry.link((specifier) => {
    const exports = dependencies[specifier];
    assert.ok(exports, `Unexpected startup dependency: ${specifier}`);
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      },
      { context },
    );
  });
  await entry.evaluate();
  return { start, theme, data, dataRequested, classes, calls, errors };
}

test('desktop first paint applies body styling before admin modules load', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public/pages/admin/shell-start.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  for (const search of ['?desktop=1', '']) {
    const rootClasses = new Set();
    const bodyClasses = new Set();
    const document = {
      documentElement: {
        classList: {
          add: (...names) => names.forEach((name) => rootClasses.add(name)),
          contains: (name) => rootClasses.has(name),
        },
      },
      body: null,
    };
    const context = vm.createContext({ document, location: { search }, URLSearchParams });
    vm.runInContext(scripts[0][1], context);
    document.body = { classList: { add: (name) => bodyClasses.add(name) } };
    vm.runInContext(scripts[1][1], context);
    assert.equal(rootClasses.has('admin-starting'), search === '?desktop=1');
    assert.equal(bodyClasses.has('desktop-shell'), search === '?desktop=1');
  }
});

test('desktop startup waits for theme and initial data while initializing window and workspace controls early', async () => {
  const fixture = await createStartupFixture();
  const starting = fixture.start();
  assert.deepEqual(fixture.calls, ['desktop', 'settings', 'workspace', 'theme']);
  assert.equal(fixture.classes.has('admin-starting'), true);
  fixture.theme.resolve();
  await fixture.dataRequested.promise;
  assert.equal(fixture.classes.has('admin-starting'), true);
  fixture.data.resolve();
  await starting;
  assert.equal(fixture.classes.has('admin-starting'), false);
  assert.deepEqual(fixture.errors, []);
});

test('failed initial state loading exits the startup screen and reports the error', async () => {
  const fixture = await createStartupFixture();
  const starting = fixture.start();
  fixture.theme.resolve();
  await fixture.dataRequested.promise;
  const error = new Error('读取状态失败');
  fixture.data.reject(error);
  await starting;
  assert.equal(fixture.classes.has('admin-starting'), false);
  assert.deepEqual(fixture.errors, [error]);
});

test('window controls work while account initialization is still pending', async () => {
  const { createSettingsForm } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/settings-form.js'));
  const account = Promise.withResolvers();
  const listeners = new Map();
  const actions = [];
  const form = createSettingsForm({
    documentRef: {
      getElementById: (id) => ({
        addEventListener: (event, listener) => listeners.set(`${id}:${event}`, listener),
      }),
    },
    initLicenseAccountDevice: () => account.promise,
    blindboxSettings: { init: noop },
    desktopRef: {
      minimizeWindow: () => actions.push('minimize'),
      maximizeWindow: () => actions.push('maximize'),
      closeWindow: () => actions.push('close'),
      onWindowMaximized: noop,
    },
  });
  const initializing = form.init();
  for (const id of ['winMinBtn', 'winMaxBtn', 'winCloseBtn']) {
    listeners.get(`${id}:click`)();
  }
  assert.deepEqual(actions, ['minimize', 'maximize', 'close']);
  account.resolve();
  await initializing;
});
