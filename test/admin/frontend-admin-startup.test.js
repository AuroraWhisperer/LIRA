'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');
const noop = () => {};

async function createStartupFixture({ confirm = async () => false, hash } = {}) {
  const theme = Promise.withResolvers();
  const data = Promise.withResolvers();
  const dataRequested = Promise.withResolvers();
  const classes = new Set(['desktop-shell', 'admin-starting']);
  const calls = [];
  const errors = [];
  const listeners = new Map();
  const connectionStates = [];
  const toolboxOptions = [];
  const featureInitializations = [];
  const toolboxBindings = [];
  const preferenceWrites = [];
  const selectedFeatures = [];
  const selectedToolboxFeatures = [];
  let desktopOptions;
  let playbackOptions;
  let aboutOpened = 0;
  let fullscreenClosed = 0;
  const pageState = {};
  const location = { hash: hash || '', pathname: '/admin', search: '' };
  const navigationButtons = hash === undefined ? [] : ['songAssistantPage', 'liveComponentsPage'].map(mainPage => ({
    dataset: { mainPage }, classList: { toggle: noop }, setAttribute: noop, addEventListener: noop, closest: () => null,
  }));
  const pages = navigationButtons.map(button => ({ id: button.dataset.mainPage, classList: { toggle: noop } }));
  const songFilters = { query: 'current page filter' };
  let readSongFilters;
  let start;
  const context = vm.createContext({
    location,
    history: { replaceState: (_state, _title, url) => { location.hash = url.startsWith('#') ? url : ''; } },
    window: { addEventListener: noop, location: { reload: () => calls.push('reload') } },
    document: {
      body: { dataset: pageState },
      readyState: 'interactive',
      documentElement: { classList: { remove: (name) => classes.delete(name) } },
      querySelectorAll: selector => selector === '.main-page-tab' ? navigationButtons : selector === '.main-page' ? pages : [],
      getElementById: (id) => id === 'settingsAboutTab' ? { click: () => { aboutOpened++; } } : null,
      addEventListener: (name, listener) => {
        if (name === 'DOMContentLoaded') start = listener;
      },
    },
  });
  const dependencies = {
    '../shared/event-bus.js': {
      eventBus: {
        on: (name, listener) => {
          if (!listeners.has(name)) listeners.set(name, []);
          listeners.get(name).push(listener);
        },
      },
      Events: { STATE_LOADED: 'state:loaded', SONG_UPDATED: 'song:updated' },
    },
    '../shared/logger.js': { logger: { debug: noop, error: noop } },
    '../shared/utils.js': { showError: (error) => errors.push(error), showConfirmationDialog: confirm,
      api: (url, body) => { preferenceWrites.push({ url, body }); } },
    '../shared/theme.js': {
      theme: {},
      loadThemeConfig: () => {
        calls.push('theme');
        return theme.promise;
      },
    },
    '../shared/parameter-range.js': { initParameterRanges: noop },
    '../shared/color-control.js': { enhanceColorControls: noop },
    '../shared/select-menu.js': { enhanceSelects: () => featureInitializations.push('select-controls') },
    '../desktop.js': { createDesktopShell: (options) => {
      desktopOptions = options;
      return { initDesktopShell: () => calls.push('desktop') };
    } },
    '../playback/index.js': { initPlaybackAssistant: (options) => {
      playbackOptions = options;
      featureInitializations.push('playback');
    }, closeQueuePopup: noop },
    './usage-guide.js': { initUsageGuide: noop },
    './toolbox-lifecycle.js': { createToolboxLifecycle: (options) => {
      toolboxOptions.push(options);
      return { dispose: noop, setPage: noop };
    } },
    './dynamic-lottery.js': { initDynamicLottery: () => ({ dispose: noop }) },
    './interactive-tour.js': { initInteractiveTour: () => ({ claimAutoOpen: () => false }) },
    './gift-frame.js': { initGiftFrame: noop },
    './gift-frame-styles.js': { initGiftFrameStyles: noop },
    './gift-motion-settings.js': { initGiftMotionSettings: noop },
    './gift-guard-thanks.js': { initGuardThanks: noop },
    './gifts/history.js': { initGiftHistoryDrawer: noop },
    './gifts/index.js': { renderGiftPanel: noop },
    './gifts/blindbox-analysis.js': { giftAnalysis: { close: noop } },
    './song-import-update.js': { initSongImportUpdate: noop },
    './state.js': {
      stateService: {
        setSongFiltersReader: (reader) => { readSongFilters = reader; },
        connectSocket: () => {
          assert.equal(readSongFilters(), songFilters);
          for (const name of ['ws:connected', 'ws:disconnected', 'app:shutdown']) {
            assert.equal(listeners.get(name)?.length, 1);
            listeners.get(name)[0]();
          }
        },
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
        closeFullscreenPlayer: () => { fullscreenClosed++; },
      },
    },
    './queue.js': { initQueueForm: noop },
    './songs.js': { songs: { initSongForm: noop, readSongFilters: () => songFilters,
      renderSongs: noop } },
    './metrics.js': { metrics: { initPerformanceMonitor: noop } },
    './streamer-planner.js': { todo: { init: () => featureInitializations.push('planner') } },
    './gift-effects.js': { giftEffects: { init: noop } },
    './toolbox-navigation.js': {
      other: { initOtherPage: (options) => toolboxBindings.push(options),
        selectFeatureById: (feature) => selectedToolboxFeatures.push(feature) },
      createFeatureNavigation: () => ({ initOtherPage: noop, selectFeatureById: feature => selectedFeatures.push(feature) }),
    },
    './danmaku-tool.js': { danmakuTool: {} },
    './ai-assistant-settings.js': { aiAssistantSettings: {} },
    './desktop-lyric.js': { desktopLyric: { initDesktopLyricForm: noop } },
    './song-import.js': { songImports: {} },
    './client-appearance.js': { initClientAppearance: noop },
    './client-settings.js': { initClientSettings: noop },
    './playback-output-settings.js': { initPlaybackOutputSettings: noop },
    './audio-assistant.js': { initAudioAssistant: noop },
    './topbar-status.js': { initTopbarStatus: noop },
    './world-clock/index.js': { initWorldClock: () => featureInitializations.push('world-clock') },
    './settings.js': {
      settings: {
        initSettingsForm: () => calls.push('settings'),
        initBilibiliAuth: noop,
      },
    },
    './theme.js': { theme: { initThemeForm: () => calls.push('theme-form'), renderPresetCards: noop } },
    './display.js': { display: { initDisplayForm: () => calls.push('display-form'), initOverlayUrls: noop } },
    './state-renderer.js': {
      createAdminStateRenderer: ({ renderGifts }) => ({ state, changedKeys }) => renderGifts(state, changedKeys),
      renderConnectionStatus: (state) => connectionStates.push(state),
    },
    './component-preview-registry.js': { setComponentPreviewPreparation: noop, getComponentPreviews: () => [] },
    './authorized-account.js': { waitForAuthorizedAccountInitialization: async () => {} },
    './component-preview-canvas-controller.js': { prepareComponentPreviewCanvas: noop },
    './component-style-client.js': { initComponentStyleLibraries: noop },
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
  return { start, theme, data, dataRequested, classes, calls, errors, connectionStates, toolboxOptions,
    featureInitializations, toolboxBindings, preferenceWrites, selectedFeatures, pageState,
    selectedToolboxFeatures, desktopOptions, get playbackOptions() { return playbackOptions; },
    get aboutOpened() { return aboutOpened; }, get fullscreenClosed() { return fullscreenClosed; } };
}

test('music display links open the matching component after its navigation is initialized', async () => {
  for (const [hash, feature] of [['#desktopLyricPage', 'desktopLyricPage'], ['#now-playing', 'nowPlayingPage']]) {
    const fixture = await createStartupFixture({ hash });
    const starting = fixture.start();
    fixture.theme.resolve();
    await fixture.dataRequested.promise;
    fixture.data.resolve();
    await starting;
    assert.equal(fixture.pageState.mainPage, 'components');
    assert.deepEqual(fixture.selectedFeatures, [feature]);
    assert.deepEqual(fixture.errors, []);
  }
});

test('toolbox initialization recovery reloads only after confirmation and keeps the failure visible', async () => {
  const dialogs = [];
  const fixture = await createStartupFixture({ confirm(options) {
    const response = Promise.withResolvers();
    dialogs.push({ options, ...response });
    return response.promise;
  } });
  const error = new Error('clock editor failed');
  const first = fixture.toolboxOptions[0].onInitError(error);
  const overlapping = fixture.toolboxOptions[1].onInitError(error);
  assert.equal(dialogs.length, 1);
  assert.deepEqual(fixture.calls, []);
  dialogs[0].resolve(false);
  await Promise.all([first, overlapping]);
  assert.deepEqual(fixture.calls, []);
  const retry = fixture.toolboxOptions[0].onInitError(error);
  assert.equal(dialogs.length, 2);
  dialogs[1].resolve(true);
  await retry;
  assert.deepEqual(fixture.calls, ['reload']);
});

test('desktop startup waits for theme and initial data while initializing window and workspace controls early', async () => {
  const fixture = await createStartupFixture();
  assert.deepEqual(fixture.calls, [], 'interactive documents must wait for DOMContentLoaded');
  const starting = fixture.start();
  assert.deepEqual([...fixture.calls].sort(), ['desktop', 'settings', 'theme', 'workspace']);
  assert.equal(fixture.classes.has('admin-starting'), true);
  fixture.theme.resolve();
  await fixture.dataRequested.promise;
  assert.deepEqual(fixture.calls.slice(4).sort(), ['display-form', 'theme-form']);
  assert.deepEqual(fixture.featureInitializations.sort(), ['planner', 'playback', 'select-controls', 'world-clock']);
  assert.deepEqual(fixture.connectionStates, ['connected', 'disconnected', 'shutdown']);
  assert.equal(fixture.classes.has('admin-starting'), true);
  fixture.data.resolve();
  await starting;
  assert.equal(fixture.classes.has('admin-starting'), false);
  assert.deepEqual(fixture.errors, []);
  fixture.desktopOptions.openUpdatePage();
  assert.equal(fixture.pageState.mainPage, 'other');
  assert.deepEqual(fixture.selectedToolboxFeatures, ['otherSettingsFeature']);
  assert.equal(fixture.aboutOpened, 1);
  fixture.playbackOptions.closeFullscreenPlayer();
  assert.equal(fixture.fullscreenClosed, 1);
});

test('toolbox preference callbacks persist only the corresponding settings fields', async () => {
  const fixture = await createStartupFixture();
  const starting = fixture.start();
  fixture.theme.resolve();
  await fixture.dataRequested.promise;
  fixture.data.resolve();
  await starting;
  assert.deepEqual(fixture.preferenceWrites, []);
  fixture.toolboxBindings[0].persistSidebarCollapsed(true);
  fixture.toolboxBindings[0].persistCollapsedFeatureGroups(['streamer-work']);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.preferenceWrites)), [
    { url: '/api/settings', body: { toolboxSidebarCollapsed: 'true' } },
    { url: '/api/settings', body: { toolboxCollapsedFeatureGroups: '["streamer-work"]' } },
  ]);
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
