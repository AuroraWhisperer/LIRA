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
      return (selector === '.classic-list-window' || selector === '.identity-list-window')
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

test('classic and identity queue render paths run without cross-module reference errors', async () => {
  const dom = createQueueDom();
  const namespace = await loadQueueOverlay(dom);

  const current = { song_name: '当前歌曲', requester_name: '观众A', is_pinned: false };
  const waiting = [{ song_name: '下一首', requester_name: '观众B', is_pinned: false }];

  assert.doesNotThrow(() => namespace.renderClassicQueue(BASE_SETTINGS, current, waiting, dom.content));
  assert.match(dom.content.innerHTML, /classic-list-window/);

  const identitySettings = { ...BASE_SETTINGS, overlayQueueStyle: 'identity' };
  assert.doesNotThrow(() => namespace.renderIdentityQueue(identitySettings, current, waiting, dom.content, []));
  assert.match(dom.content.innerHTML, /identity-list-window/);
  assert.equal(dom.viewport.style.height, '364px');
});

test('queue viewport resize state is shared across overlay modules', async () => {
  const namespace = await loadModuleExports(VIEWPORT_STATE_ENTRY, {});
  assert.equal(namespace.isQueueViewportResized(), false);
  namespace.markQueueViewportResized();
  assert.equal(namespace.isQueueViewportResized(), true);
});
