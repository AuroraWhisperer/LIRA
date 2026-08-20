'use strict';

// Real ES module smoke test for the queue overlay. Unlike js-module-bundle.js,
// loadModuleExports links the actual import graph with vm.SourceTextModule, so
// an identifier referenced across a module boundary without an import throws a
// ReferenceError here exactly as it does in the browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');
const QUEUE_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js');
const QUEUE_RENDER_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue-render.js');
const VIEWPORT_STATE_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue-viewport.js');

function createFakeList() {
  const classes = new Set(['paused']);
  return {
    scrollHeight: 400,
    children: [],
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    querySelectorAll() { return []; },
    insertAdjacentHTML() {}
  };
}

function createQueueDom() {
  const rootVars = new Map();
  const panelClasses = new Set();
  const panel = {
    className: '',
    style: {},
    classList: {
      add(...names) { names.forEach((name) => panelClasses.add(name)); },
      remove(...names) { names.forEach((name) => panelClasses.delete(name)); },
      toggle(name, force) {
        const on = force === undefined ? !panelClasses.has(name) : Boolean(force);
        if (on) panelClasses.add(name);
        else panelClasses.delete(name);
        return on;
      },
      contains(name) { return panelClasses.has(name); }
    },
    querySelector() { return null; }
  };
  const list = createFakeList();
  const viewport = {
    clientHeight: 400,
    style: {},
    parentElement: null,
    getBoundingClientRect: () => ({ top: 0, height: 400 }),
    querySelector() { return list; }
  };
  const content = {
    className: '',
    innerHTML: '',
    style: {},
    querySelector(selector) {
      return (
        selector === '.classic-list-window'
        || selector === '.identity-list-window'
        || selector === '.storybook-list-window'
        || selector === '.neon-vinyl-list-window'
        || selector === '.cherry-ribbon-list-window'
        || selector === '.golden-lily-list-window'
      )
        ? viewport
        : null;
    },
    querySelectorAll() { return []; },
    parentElement: null,
    children: []
  };
  const document = {
    documentElement: {
      clientHeight: 800,
      style: { setProperty(name, value) { rootVars.set(name, value); } }
    },
    addEventListener() {},
    querySelector(selector) { return selector === '.overlay-panel' ? panel : null; },
    getElementById() { return null; }
  };
  return { document, content, viewport, panel, panelClasses, rootVars };
}

function loadQueueOverlay(dom, entry = QUEUE_RENDER_ENTRY) {
  return loadModuleExports(entry, {
    document: dom.document,
    location: { search: '' },
    URLSearchParams,
    requestAnimationFrame: (fn) => fn(),
    window: { innerHeight: 800 }
  });
}

const BASE_SETTINGS = {
  overlayQueueStyle: 'classic',
  themePrimary: '#ff6f91',
  themeBackground: '#181823',
  queueSongFontSize: '40',
  themeFontScale: '1',
  queueScrollSpeed: '80',
  overlayLowPowerMode: 'false'
};

test('queue overlay entry links and evaluates through the real module graph', async () => {
  const dom = createQueueDom();
  const namespace = await loadQueueOverlay(dom, QUEUE_ENTRY);
  assert.equal(typeof namespace, 'object');
});

test('queue overlay applies its theme through the real module graph', async () => {
  const dom = createQueueDom();
  const namespace = await loadQueueOverlay(dom);

  assert.doesNotThrow(() => namespace.applyTheme(BASE_SETTINGS, 'classic'));
  assert.equal(dom.panel.className, 'overlay-panel queue-classic');
  assert.equal(dom.rootVars.get('--overlay-song-font-size'), '40px');
  assert.equal(dom.rootVars.get('--overlay-blur'), '0px');
  const scrollSeconds = Number.parseFloat(dom.rootVars.get('--scroll-seconds'));
  assert.ok(Number.isFinite(scrollSeconds) && scrollSeconds > 0);
});

test('all six queue render paths run without cross-module reference errors', async () => {
  const dom = createQueueDom();
  const namespace = await loadQueueOverlay(dom);

  const current = { song_name: '  当前歌曲', requester_name: '观众A', is_pinned: false };
  const waiting = [
    { song_name: '下一首', requester_name: '观众B', is_pinned: false },
    { song_name: '第三首', requester_name: '观众C', is_pinned: false },
    { song_name: '第四首', requester_name: '观众D', is_pinned: false }
  ];
  const expectedSongs = [current, ...waiting].map((item) => item.song_name.trimStart());
  const assertSharedQueue = (rowClass) => {
    expectedSongs.forEach((songName) => assert.match(dom.content.innerHTML, new RegExp(songName)));
    assert.equal((dom.content.innerHTML.match(new RegExp(`class=\"[^\"]*${rowClass}[^\"]*\"`, 'g')) || []).length, expectedSongs.length);
  };

  assert.doesNotThrow(() => namespace.renderClassicQueue(BASE_SETTINGS, current, waiting, dom.content));
  assert.match(dom.content.innerHTML, /classic-list-window/);
  assert.match(dom.content.innerHTML, /class="overlay-song-name">当前歌曲<\/span>/);
  assertSharedQueue('overlay-waiting-row');

  const identitySettings = { ...BASE_SETTINGS, overlayQueueStyle: 'identity' };
  assert.doesNotThrow(() => namespace.renderIdentityQueue(identitySettings, current, waiting, dom.content, []));
  assert.match(dom.content.innerHTML, /identity-list-window/);
  assert.match(dom.content.innerHTML, /class="identity-song">当前歌曲<\/span>/);
  assert.equal(dom.viewport.style.height, '364px');
  assertSharedQueue('identity-row');

  const storybookSettings = { ...BASE_SETTINGS, overlayQueueStyle: 'storybook' };
  assert.doesNotThrow(() => namespace.renderStorybookQueue(storybookSettings, current, waiting, dom.content));
  assert.match(dom.content.innerHTML, /storybook-list-window/);
  assert.match(dom.content.innerHTML, /class="storybook-song">当前歌曲<\/span>/);
  assertSharedQueue('storybook-row');

  const neonSettings = { ...BASE_SETTINGS, overlayQueueStyle: 'neon-vinyl' };
  assert.doesNotThrow(() => namespace.renderNeonVinylQueue(neonSettings, current, waiting, dom.content));
  assert.match(dom.content.innerHTML, /neon-vinyl-list-window/);
  assert.match(dom.content.innerHTML, /class="illustrated-song-value">当前歌曲<\/span>/);
  assertSharedQueue('neon-vinyl-row');

  const ribbonSettings = { ...BASE_SETTINGS, overlayQueueStyle: 'cherry-ribbon' };
  assert.doesNotThrow(() => namespace.renderCherryRibbonQueue(ribbonSettings, current, waiting, dom.content));
  assert.match(dom.content.innerHTML, /cherry-ribbon-list-window/);
  assert.match(dom.content.innerHTML, /class="illustrated-song-value">当前歌曲<\/span>/);
  assertSharedQueue('cherry-ribbon-row');

  const goldenLilySettings = { ...BASE_SETTINGS, overlayQueueStyle: 'golden-lily' };
  assert.doesNotThrow(() => namespace.renderGoldenLilyQueue(goldenLilySettings, current, waiting, dom.content));
  assert.match(dom.content.innerHTML, /golden-lily-list-window/);
  assert.match(dom.content.innerHTML, /class="illustrated-song-value">当前歌曲<\/span>/);
  assertSharedQueue('golden-lily-row');
  assert.doesNotThrow(() => namespace.renderGoldenLilyQueue(goldenLilySettings, null, [], dom.content));
  assert.match(dom.content.innerHTML, /golden-lily-empty/);
});

test('queue style changes are detected so the overlay can reload the authoritative queue', async () => {
  const dom = createQueueDom();
  const namespace = await loadQueueOverlay(dom, QUEUE_ENTRY);
  const state = (style) => ({ settings: { overlayQueueStyle: style } });

  assert.equal(namespace.queueStyleChanged(state('classic'), state('identity')), true);
  assert.equal(namespace.queueStyleChanged(state('identity'), state('storybook')), true);
  assert.equal(namespace.queueStyleChanged(state('festival'), state('identity')), false);
  assert.equal(namespace.queueStyleChanged(state('storybook'), state('storybook')), false);
  assert.equal(namespace.queueStyleChanged(null, state('classic')), false);
});

test('queue viewport resize state is shared across overlay modules', async () => {
  const namespace = await loadModuleExports(VIEWPORT_STATE_ENTRY, {});
  assert.equal(namespace.isQueueViewportResized(), false);
  namespace.markQueueViewportResized();
  assert.equal(namespace.isQueueViewportResized(), true);
});
