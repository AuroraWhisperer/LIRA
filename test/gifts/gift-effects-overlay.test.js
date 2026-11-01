'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { invokeBodyRoute, invokeQueryRoute } = require('../helpers/route-invoke');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('gift effects can read the avatar proxy without gaining other overlay or admin routes', () => {
  const { getOverlayScope, isOverlayRequestAllowed } = require('../../src/server/access-policy');
  assert.equal(getOverlayScope('/gift-effects'), 'gift-effects');
  assert.equal(isOverlayRequestAllowed('gift-effects', 'GET', '/api/bilibili/avatar'), true);
  for (const [method, pathname] of [['POST', '/api/bilibili/avatar'], ['GET', '/api/gifts/history'],
    ['GET', '/api/bilibili/auth/state'], ['POST', '/api/settings']]) {
    assert.equal(isOverlayRequestAllowed('gift-effects', method, pathname), false);
  }
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readOverlayModules() {
  return [read('public/js/overlays/gift-effects.js'), read('public/js/overlays/gift-effects-frame.js')].join('\n');
}

test('gift effect preview resolves the gift and broadcasts to the fixed overlay url', async () => {
  const { routes } = require('../../src/server/routes/gift-routes');
  const handler = routes['POST /api/gifts/effects/preview'];
  const broadcasts = [];
  const context = {
    gifts: {
      async resolveEffect(giftId) {
        return giftId === 33909
          ? {
              effectId: 1466,
              mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4',
            }
          : null;
      },
      previewEffect(payload) {
        broadcasts.push(payload);
      },
    },
  };

  const found = await invokeBodyRoute(handler, context, { giftId: '33909' });
  assert.equal(found.status, 200);
  assert.deepEqual(broadcasts, [
    {
      type: 'gift:effect',
      eventId: 0,
      giftId: 33909,
      effect: {
        effectId: 1466,
        mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4',
      },
      preview: true,
    },
  ]);

  const invalid = await invokeBodyRoute(handler, context, { giftId: 'abc' });
  assert.equal(invalid.status, 400);
  assert.equal(broadcasts.length, 1);
});

test('gift effect lookup validates ids and returns only resolved effect data', async () => {
  const { routes } = require('../../src/server/routes/gift-routes');
  const handler = routes['GET /api/gifts/effects/resolve'];
  const calls = [];
  const context = {
    gifts: {
      async resolveEffect(giftId) {
        calls.push(giftId);
        return giftId === 31645
          ? {
              effectId: 584,
              mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4',
            }
          : null;
      },
    },
  };

  const invalid = await invokeQueryRoute(handler, context, { giftId: 'abc' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(calls, []);

  const found = await invokeQueryRoute(handler, context, { giftId: '31645' });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.data, {
    giftId: 31645,
    effect: {
      effectId: 584,
      mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4',
    },
  });

  const missing = await invokeQueryRoute(handler, context, { giftId: '31643' });
  assert.equal(missing.status, 404);
});

test('gift effects overlay never renders untrusted text with innerHTML', () => {
  assert.doesNotMatch(readOverlayModules(), /innerHTML/);
});

test('toolbox gift effect controls copy the source URL and open its preview', async () => {
  const nodes = new Map([
    'giftEffectLookupForm', 'giftEffectGiftId', 'giftEffectOverlayUrl', 'giftEffectLookupState',
    'giftEffectMatchSummary', 'giftEffectDanmakuEnabled', 'giftEffectOpenBtn',
  ].map((id) => [id, {
    handlers: {},
    classList: { add() {} },
    addEventListener(type, handler) { this.handlers[type] = handler; },
  }]));
  const copied = [];
  const opened = [];
  const { giftEffects } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/gift-effects.js'), {
    document: { getElementById: (id) => nodes.get(id) || null },
    location: { protocol: 'http:', port: '3000' },
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    window: { addEventListener() {}, open: (...args) => opened.push(args) },
  });
  giftEffects.init();
  await nodes.get('giftEffectOverlayUrl').handlers.click();
  nodes.get('giftEffectOpenBtn').handlers.click();
  assert.equal(nodes.get('giftEffectOverlayUrl').textContent, 'http://127.0.0.1:3000/gift-effects');
  assert.deepEqual(copied, ['http://127.0.0.1:3000/gift-effects']);
  assert.deepEqual(opened, [['http://127.0.0.1:3000/gift-effects?preview=1', 'liraGiftEffectPreview']]);
});

test('gift effects overlay keeps its own reconnect policy and stops the connection on pagehide', async () => {
  function createOverlayNode(id = '') {
    const node = {
      id,
      hidden: false,
      textContent: '',
      dataset: {},
      attributes: {},
      style: { setProperty() {}, removeProperty() {} },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {},
      removeEventListener() {},
      append() {},
      replaceChildren() {},
      remove() {},
      setAttribute(name, value) { node.attributes[name] = value; },
      getAttribute(name) { return node.attributes[name] ?? null; },
      removeAttribute(name) {
        delete node.attributes[name];
        if (name === 'src') node.src = '';
      },
      querySelector: (selector) => createOverlayNode(selector),
      querySelectorAll: () => [],
      load() {},
      pause() {},
      play: () => Promise.resolve(),
    };
    return node;
  }

  const sockets = [];
  const timers = new Map();
  const windowListeners = new Map();
  const elements = new Map();
  let sequence = 0;
  class Socket {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.closed = false;
      sockets.push(this);
    }

    addEventListener(name, handler) {
      this.listeners[name] = handler;
    }

    emit(name, value) {
      this.listeners[name]?.(value);
    }

    close() {
      this.closed = true;
    }
  }
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, createOverlayNode(id));
    return elements.get(id);
  };
  const windowRef = {
    __API_TOKEN__: 'overlay token',
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener(name, handler) { windowListeners.set(name, handler); },
    removeEventListener(name) { windowListeners.delete(name); },
    matchMedia: () => ({ matches: false }),
  };
  const setTimeoutFn = (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; };
  const clearTimeoutFn = (id) => timers.delete(id);
  await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/gift-effects.js'), {
    document: {
      defaultView: windowRef,
      body: element('body'),
      documentElement: element('html'),
      readyState: 'complete',
      getElementById: element,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => element(tag),
      createDocumentFragment: () => element('fragment'),
      addEventListener() {},
    },
    window: windowRef,
    location: { search: '', protocol: 'http:', host: '127.0.0.1:3000' },
    URL,
    URLSearchParams,
    WebSocket: Socket,
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  });

  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'ws://127.0.0.1:3000/ws?token=overlay%20token');

  const effect = {
    type: 'gift:effect', source: 'danmaku', eventId: 'synthetic-effect',
    effect: { mp4Url: 'https://i0.hdslb.com/synthetic.mp4',
      layout: { videoWidth: 4, videoHeight: 2, rgbFrame: [0, 0, 2, 2], alphaFrame: [2, 0, 2, 2] } },
  };
  const message = (payload) => sockets[0].emit('message', { data: JSON.stringify(payload) });
  message(effect);
  assert.equal(elements.has('video'), false, 'disabled command effects do not create media');
  message({ type: 'snapshot', state: { settings: { giftEffectDanmakuEnabled: 'true' } } });
  message(effect);
  assert.equal(element('video').src, effect.effect.mp4Url, 'socket events reach the real effect player');
  for (const expected of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    sockets.at(-1).emit('close');
    assert.equal(element('video').src, '', 'disconnect stops command playback');
    const [timer] = [...timers.values()];
    assert.equal(timer.delay, expected);
    timers.clear();
    timer.callback();
  }
  assert.equal(sockets.length, 8, 'every reconnect opens exactly one socket');

  windowListeners.get('pagehide')();
  assert.equal(sockets.at(-1).closed, true, 'pagehide closes the live socket');
  sockets.at(-1).emit('close');
  assert.equal(timers.size, 0, 'pagehide stops further reconnect attempts');
});
