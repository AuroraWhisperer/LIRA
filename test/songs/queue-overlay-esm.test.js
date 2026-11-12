'use strict';

// Real ES module smoke test for the queue overlay. loadModuleExports links
// the actual import graph with vm.SourceTextModule, so
// an identifier referenced across a module boundary without an import throws a
// ReferenceError here exactly as it does in the browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { FakeNode } = require('../helpers/fake-dom');

const ROOT_DIR = path.join(__dirname, '../..');
const QUEUE_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js');
const QUEUE_RENDER_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue-render.js');
const QUEUE_STYLE_SETTINGS_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'shared', 'queue-style-settings.js');

function createFakeList() {
  const classes = new Set(['paused']);
  return {
    scrollHeight: 400,
    children: [],
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      },
    },
    querySelectorAll() {
      return [];
    },
    insertAdjacentHTML() {},
  };
}

function createQueueDom() {
  const rootVars = new Map();
  const panelClasses = new Set();
  const panel = {
    className: '',
    style: {},
    classList: {
      add(...names) {
        names.forEach((name) => panelClasses.add(name));
      },
      remove(...names) {
        names.forEach((name) => panelClasses.delete(name));
      },
      toggle(name, force) {
        const on = force === undefined ? !panelClasses.has(name) : Boolean(force);
        if (on) panelClasses.add(name);
        else panelClasses.delete(name);
        return on;
      },
      contains(name) {
        return panelClasses.has(name);
      },
    },
    querySelector() {
      return null;
    },
  };
  const list = createFakeList();
  const viewport = {
    clientHeight: 400,
    style: {},
    parentElement: null,
    getBoundingClientRect: () => ({ top: 0, height: 400 }),
    querySelector() {
      return list;
    },
  };
  const content = {
    className: '',
    innerHTML: '',
    style: {},
    querySelector(selector) {
      return selector === '.classic-list-window' ||
        selector === '.identity-list-window' ||
        selector === '.storybook-list-window' ||
        selector === '.neon-vinyl-list-window' ||
        selector === '.cherry-ribbon-list-window' ||
        selector === '.golden-lily-list-window'
        ? viewport
        : null;
    },
    querySelectorAll() {
      return [];
    },
    parentElement: null,
    children: [],
  };
  const document = {
    documentElement: {
      clientHeight: 800,
      style: {
        setProperty(name, value) {
          rootVars.set(name, value);
        },
      },
    },
    addEventListener() {},
    querySelector(selector) {
      return selector === '.overlay-panel' ? panel : null;
    },
    getElementById() {
      return null;
    },
  };
  return { document, content, viewport, panel, panelClasses, rootVars };
}

function loadQueueOverlay(dom, entry = QUEUE_RENDER_ENTRY) {
  return loadModuleExports(entry, {
    document: dom.document,
    location: { search: '' },
    URLSearchParams,
    requestAnimationFrame: (fn) => fn(),
    window: { innerHeight: 800 },
  });
}

const BASE_SETTINGS = {
  overlayQueueStyle: 'classic',
  themePrimary: '#ff6f91',
  themeBackground: '#181823',
  queueSongFontSize: '40',
  themeFontScale: '1',
  queueScrollSpeed: '80',
  overlayLowPowerMode: 'false',
};

test('every queue theme renders all queued songs and escapes viewer text', async () => {
  const dom = createQueueDom();
  const render = await loadQueueOverlay(dom);
  const current = { song_name: '<img src=x onerror=alert(1)>当前', requester_name: '<b>观众A</b>' };
  const waiting = [
    { song_name: '下一首', requester_name: '观众B' },
    { song_name: '第三首', requester_name: '观众C' },
  ];
  for (const [name, style] of [
    ['renderClassicQueue', 'classic'],
    ['renderIdentityQueue', 'identity'],
    ['renderStorybookQueue', 'storybook'],
    ['renderNeonVinylQueue', 'neon-vinyl'],
    ['renderCherryRibbonQueue', 'cherry-ribbon'],
    ['renderGoldenLilyQueue', 'golden-lily'],
  ]) {
    render[name]({ ...BASE_SETTINGS, overlayQueueStyle: style }, current, waiting, dom.content, []);
    const html = dom.content.innerHTML;
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;当前/, name);
    assert.doesNotMatch(html, /<img src=x|<b>观众A/, `${name} must not inject viewer markup`);
    waiting.forEach((item) => assert.ok(html.includes(item.song_name), `${name} keeps ${item.song_name}`));
  }
});

test('queue overlay applies the saved song font size', async () => {
  const dom = createQueueDom();
  const namespace = await loadQueueOverlay(dom);

  namespace.applyTheme(BASE_SETTINGS, 'classic');
  assert.equal(dom.rootVars.get('--overlay-song-font-size'), '40px');
});

test('queue style changes are detected so the overlay can reload the authoritative queue', async () => {
  const dom = createQueueDom();
  const namespace = await loadQueueOverlay(dom, QUEUE_ENTRY);
  const state = (style) => ({ settings: { overlayQueueStyle: style } });

  assert.equal(namespace.queueStyleChanged(state('classic'), state('identity')), true);
  assert.equal(namespace.queueStyleChanged(state('festival'), state('identity')), false);
  assert.equal(namespace.queueStyleChanged(state('storybook'), state('storybook')), false);
  assert.equal(namespace.queueStyleChanged(null, state('classic')), false);
  assert.equal(namespace.normalizeQueueStyle('festival'), 'identity');
  assert.equal(namespace.normalizeQueueStyle('unknown'), 'classic');
});

test('queue preview updates orientation when switching resource packages with the same preset', async () => {
  const dom = createQueueDom();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const messages = [];
  const parent = { postMessage: message => messages.push(message) };
  const location = new URL('http://127.0.0.1/queue?componentPreview=1');
  const notice = new FakeNode('div');
  notice.ownerDocument = dom.document;
  const window = {
    parent, document: dom.document, innerWidth: 900, innerHeight: 506,
    addEventListener: (name, callback) => windowListeners.set(name, callback),
    removeEventListener: name => windowListeners.delete(name),
    matchMedia: () => ({ matches: false }),
    ResizeObserver: class { observe() {} disconnect() {} },
  };
  dom.document.defaultView = window;
  dom.document.documentElement.style.getPropertyValue = name => dom.rootVars.get(name) || '';
  dom.document.addEventListener = (name, callback) => documentListeners.set(name, callback);
  dom.document.getElementById = id => id === 'queueContent' ? dom.content : id === 'queueRequestNotice' ? notice : null;
  dom.document.createElement = tag => new FakeNode(tag);
  dom.document.head = new FakeNode('head');
  dom.panel.style.setProperty = () => {};
  dom.panel.getBoundingClientRect = () => ({ width: 430, height: 506, left: 0, top: 0 });
  let renders = 0;
  Object.defineProperty(dom.content, 'innerHTML', { set() { renders++; } });
  await loadModuleExports(QUEUE_ENTRY, {
    document: dom.document, window, location, URL, URLSearchParams,
    fetch: async () => ({ ok: true, text: async () => '' }),
    Image: class { async decode() {} },
    requestAnimationFrame() {}, clearTimeout() {},
  });
  documentListeners.get('DOMContentLoaded')();
  const resource = (id, landscape) => ({
    id, preset: 'moonlit-queue', preview: `/component-media/${id}/${'1'.repeat(64)}.webp`,
    width: landscape ? 900 : 391, height: 506,
    resources: {
      '/img/overlays/opening-moon-fan/flowers-ne.webp': `/component-media/${id}/${'2'.repeat(64)}.webp`,
      [landscape ? '/img/overlays/queue-moonlit/moon-lake-frame-hd-v4.webp'
        : '/img/overlays/queue-moonlit/vine-frame-hd-v3.webp']: `/component-media/${id}/${'3'.repeat(64)}.webp`,
    },
  });
  const portrait = resource('11111111-1111-4111-8111-111111111111', false);
  const landscape = resource('22222222-2222-4222-8222-222222222222', true);
  const receive = windowListeners.get('message');
  for (const [resourceStyle, expectedLandscape] of [[portrait, false], [landscape, true], [portrait, false]]) {
    const data = { type: 'component-preview:config', config: { overlayQueueStyle: 'identity', resourceStyle } };
    await receive({ source: parent, origin: location.origin, data });
    assert.equal(messages.at(-1).type, 'component-preview:prepared');
    assert.equal(dom.panelClasses.has('queue-moonlit-landscape'), expectedLandscape);
    const before = renders;
    await receive({ source: parent, origin: location.origin, data: structuredClone(data) });
    assert.equal(renders, before, 'identical configuration preserves the rendered queue');
  }
  windowListeners.get('pagehide')();
});

test('queue style settings resolve and persist only the selected style', async () => {
  const namespace = await loadModuleExports(QUEUE_STYLE_SETTINGS_ENTRY, {});
  const settings = {
    identityQueueFontSize: '26',
    neonVinylQueueFontSize: '41',
    neonVinylQueueFontFamily: 'KaiTi, serif',
    neonVinylQueueScrollMode: 'loop',
    neonVinylQueueScrollSpeed: '64',
    cherryRibbonQueueFontSize: '22',
  };

  const neon = namespace.resolveQueueStyleSettings(settings, 'neon-vinyl');
  assert.equal(neon.identityQueueFontSize, '41');
  assert.equal(neon.illustratedQueueFontFamily, 'KaiTi, serif');
  assert.equal(neon.queueScrollMode, 'loop');
  assert.equal(neon.identityQueueScrollSpeed, '64');
  assert.equal(namespace.resolveQueueStyleSettings(settings, 'cherry-ribbon').identityQueueFontSize, '22');

  const payload = namespace.queueStyleSettingsPayload('neon-vinyl', {
    fontSize: '44',
    fontFamily: 'YouYuan',
    scrollSpeed: '71',
  });
  assert.equal(payload.neonVinylQueueFontSize, '44');
  assert.equal(payload.neonVinylQueueScrollSpeed, '71');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'cherryRibbonQueueFontSize'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'identityQueueFontSize'), false);
});

test('classic and identity resolve independent fonts while preserving old snapshots', async () => {
  const namespace = await loadModuleExports(QUEUE_STYLE_SETTINGS_ENTRY, {});
  const settings = { overlayFontFamily: '"Lira Maiyuan"', identityQueueFontFamily: '"STKaiti"' };
  assert.equal(namespace.resolveQueueStyleSettings(settings, 'classic').overlayFontFamily, '"Lira Maiyuan"');
  assert.equal(namespace.resolveQueueStyleSettings(settings, 'identity').overlayFontFamily, '"STKaiti"');
  assert.equal(namespace.resolveQueueStyleSettings({ overlayFontFamily: 'KaiTi' }, 'identity').overlayFontFamily, 'KaiTi');
  assert.deepEqual({ ...namespace.queueStyleSettingsPayload('identity', { fontFamily: '"Lira Smiley"' }) },
    { identityQueueFontFamily: '"Lira Smiley"' });
});

test('queue rows escape viewer medal text', async () => {
  const render = await loadQueueOverlay(createQueueDom());
  const item = {
    song_name: '歌',
    requester_name: '点歌人',
    requester_guard_level: 0,
    requester_medal_name: '<i>灯牌</i>',
    requester_medal_level: 26,
  };

  for (const [style, row] of [
    ['storybook', render.renderStorybookRow(item, 0)],
    ['neon-vinyl', render.renderNeonVinylRow(item)],
  ]) {
    assert.match(row, /&lt;i&gt;灯牌&lt;\/i&gt;/, style);
    assert.doesNotMatch(row, /<i>灯牌/, `${style} must not inject viewer markup`);
  }
});

test('custom illustrated typography applies only to illustrated queue styles', async () => {
  const settings = {
    ...BASE_SETTINGS,
    illustratedQueueFontFamily: 'KaiTi',
    illustratedQueueUseCustomTextColor: 'true',
    illustratedQueueTextColor: '#123456',
  };
  for (const [style, applied] of [['neon-vinyl', true], ['classic', false]]) {
    const dom = createQueueDom();
    const namespace = await loadQueueOverlay(dom);
    namespace.applyTheme({ ...settings, overlayQueueStyle: style }, style);
    assert.equal(dom.rootVars.get('--illustrated-queue-text-color'), '#123456');
    assert.equal(dom.panelClasses.has('illustrated-custom-text-color'), applied, style);
  }
});
