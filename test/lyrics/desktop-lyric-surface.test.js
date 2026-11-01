'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

function createElement() {
  const classes = new Set();
  const styleValues = new Map();
  return {
    classes,
    styleValues,
    textContent: '',
    className: '',
    dataset: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : force;
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains: (name) => classes.has(name),
    },
    style: {
      setProperty: (name, value) => styleValues.set(name, value),
      removeProperty: (name) => styleValues.delete(name),
    },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {},
    addEventListener() {},
  };
}

async function loadLyricWindow({ protocol = 'http:' } = {}) {
  const sockets = [];
  const timers = [];
  const warnings = [];
  const listeners = new Map();
  const card = createElement();
  const status = createElement();
  const body = createElement();
  const elements = new Map([
    ['desktopLyricSurface', card],
    ['desktopLyricPreviewStatus', status],
  ]);
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = 0;
      sockets.push(this);
    }

    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }

    close() {
      this.closed += 1;
    }

    emit(type, event = {}) {
      this.listeners.get(type)?.(event);
    }
  }
  await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'lyric-window.js'), {
    console: { ...console, warn: (...args) => warnings.push(args) },
    WebSocket: FakeWebSocket,
    URLSearchParams,
    // The page registers its socket teardown on window, like the other overlays.
    window: { addEventListener() {} },
    location: { protocol, host: '127.0.0.1:4100', search: '' },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
    clearTimeout() {},
    document: {
      body,
      head: createElement(),
      documentElement: createElement(),
      getElementById: (id) => elements.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement,
      createDocumentFragment: createElement,
      addEventListener: (type, handler) => listeners.set(type, handler),
    },
  });
  listeners.get('DOMContentLoaded')();
  return { sockets, timers, warnings, card, status, body };
}

test('lyrics browser source applies snapshot, state and timeline messages from its WebSocket', async () => {
  const { sockets, warnings, card, status } = await loadLyricWindow();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'ws://127.0.0.1:4100/ws');
  const message = (payload) => sockets[0].emit('message', { data: JSON.stringify(payload) });

  message({
    type: 'snapshot',
    state: {
      settings: { desktopLyricFontSize: '64', desktopLyricHideOnPause: 'true' },
      lyricTimeline: { status: 'ready', lines: [{ startMs: 0, text: '第一句' }] },
      lyricState: { playing: false, lineText: '第一句', status: 'ready' },
    },
  });
  assert.equal(card.styleValues.get('--preview-size'), '64px');
  assert.equal(card.classes.has('is-paused-hidden'), true, 'snapshot settings and paused state must both apply');

  message({ type: 'lyric-state', state: { playing: true, lineText: '第一句', status: 'ready' } });
  assert.equal(card.classes.has('is-paused-hidden'), false);

  const singleLineStatus = status.textContent;
  message({
    type: 'lyric-timeline',
    timeline: {
      status: 'ready',
      lines: [
        { startMs: 0, text: '第一句' },
        { startMs: 1000, text: '第二句' },
        { startMs: 2000, text: '第三句' },
      ],
    },
  });
  assert.notEqual(status.textContent, singleLineStatus, 'timeline messages replace the snapshot timeline');

  sockets[0].emit('message', { data: '{not json' });
  message({ type: 'unknown', state: { playing: false } });
  assert.equal(warnings.length, 1, 'malformed messages are reported without breaking the socket');
  assert.equal(card.classes.has('is-paused-hidden'), false, 'unknown message types are ignored');
});

test('lyrics browser source reconnects with capped backoff and resets after a successful open', async () => {
  const { sockets, timers, body } = await loadLyricWindow({ protocol: 'https:' });
  assert.equal(sockets[0].url, 'wss://127.0.0.1:4100/ws');

  sockets[0].emit('error');
  assert.equal(sockets[0].closed, 1, 'socket errors close the socket so the close path reconnects');

  const delays = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    sockets.at(-1).emit('close');
    assert.equal(body.classes.has('is-disconnected'), true);
    const timer = timers.at(-1);
    delays.push(timer.delay);
    timer.callback();
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 15000, 15000]);
  assert.equal(sockets.length, 7);

  sockets.at(-1).emit('open');
  assert.equal(body.classes.has('is-disconnected'), false);
  sockets.at(-1).emit('close');
  assert.equal(timers.at(-1).delay, 1000, 'a successful open resets the backoff');
});
