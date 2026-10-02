'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { CLOCK_STYLE_VALUES } = require('../../src/server/clock-contract');
const { loadModuleExports } = require('../helpers/frontend-modules');

const entry = (area, name) => path.join(__dirname, '../..', 'public', 'js', area, name);
const flush = () => new Promise(setImmediate);

test('live clock snapshots defeat late reads and retain explicit URL overrides with one timer', async () => {
  const dom = createClockDom();
  dom.window.parent = dom.window;
  let finishRead;
  await loadModuleExports(entry('overlays', 'clock.js'), {
    ...dom, URL, URLSearchParams, location: new URL('http://127.0.0.1:3000/clock?seconds=0'),
    fetch: () => new Promise((resolve) => { finishRead = resolve; }),
  });
  assert.equal(dom.sockets.length, 1);
  const snapshot = (style) => dom.sockets[0].listeners.get('message')({ data: JSON.stringify({
    type: 'snapshot', state: { settings: { clockStyle: style, clockShowSeconds: 'true', clockLabel: '实时' } },
  }) });
  snapshot('soda');
  finishRead({ ok: true, json: async () => ({ ok: true, data: { style: 'peach', showSeconds: true } }) });
  await flush();
  assert.equal(dom.document.getElementById('clockCard').dataset.clockStyle, 'soda');
  assert.equal(dom.document.getElementById('clockSeconds').hidden, true);
  const timer = [...dom.timers.keys()];
  snapshot('starlight');
  assert.deepEqual([...dom.timers.keys()], timer);
  assert.equal(dom.document.getElementById('clockCard').dataset.clockStyle, 'starlight');
  dom.window.listeners.get('pagehide')();
  assert.equal(dom.timers.size, 0);
  assert.equal(dom.sockets[0].closed, true);
});

test('shared clock preview uses only parent messages and disposes its timer', async () => {
  const dom = createClockDom();
  const messages = [];
  dom.window.parent.postMessage = (message) => messages.push(message);
  await loadModuleExports(entry('overlays', 'clock.js'), {
    ...dom, URL, URLSearchParams, location: new URL('http://127.0.0.1:3000/clock?componentPreview=1'),
    fetch: () => assert.fail('preview must not read live settings'),
  });
  assert.equal(dom.sockets.length, 0);
  assert.equal(dom.timers.size, 0);
  assert.equal(messages[0].type, 'component-preview:ready');
  const receive = dom.window.listeners.get('message');
  receive({ source: dom.window.parent, origin: 'http://127.0.0.1:3000', data: {
    type: 'component-preview:init', config: { style: 'digital' },
  } });
  assert.equal(dom.timers.size, 1);
  receive({ source: dom.window.parent, origin: 'http://127.0.0.1:3000', data: { type: 'component-preview:dispose' } });
  assert.equal(dom.timers.size, 0);
  assert.equal(dom.window.listeners.has('resize'), false);
  assert.equal(dom.document.listeners.has('visibilitychange'), false);
});

function createClockDom() {
  const nodes = new Map();
  const timers = new Map();
  const animations = [];
  let timerId = 0;
  function element() {
    const classes = new Set();
    return {
      listeners: new Map(),
      dataset: {},
      hidden: false,
      value: '',
      textContent: '',
      children: [],
      style: { setProperty(key, value) { this[key] = value; }, getPropertyValue(key) { return this[key] || ''; },
        removeProperty(key) { delete this[key]; } },
      classList: {
        toggle() {},
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      removeAttribute(name) { delete this[name]; },
      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      },
      removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
      },
      getAttribute(name) {
        return this[name] || null;
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      animate(keyframes, options) {
        const animation = {
          keyframes,
          options,
          cancelled: false,
          cancel() {
            this.cancelled = true;
          },
        };
        animations.push(animation);
        return animation;
      },
    };
  }
  const options = [...CLOCK_STYLE_VALUES].map((style) => ({
    ...element(),
    dataset: { clockStyleOption: style },
  }));
  const palettes = ['light', 'dark', 'lilac'].map((name) => ({ ...element(), dataset: { clockPalette: name } }));
  const document = {
    ...element(),
    documentElement: element(),
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    querySelectorAll: (selector) => selector === '[data-clock-palette]' ? palettes : options,
    createElement: element,
  };
  document.getElementById('clockCard').hidden = true;
  const window = {
    ...element(),
    document,
    parent: {},
    innerWidth: 580,
    innerHeight: 210,
    matchMedia: () => ({ matches: false }),
    setTimeout(callback) {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const sockets = [];
  class WebSocket {
    constructor() { this.listeners = new Map(); sockets.push(this); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    close() { this.closed = true; }
  }
  return { document, window, options, palettes, timers, animations, sockets, WebSocket,
    AbortController, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout };
}

test('clock preview loads once, shares drafts and only writes on explicit save', async () => {
  const dom = createClockDom();
  const preview = dom.document.getElementById('clockPreview');
  const messages = [];
  const writes = [];
  let navigations = 0;
  let source = '';
  let resolveConfig;
  Object.defineProperty(preview, 'src', {
    get: () => source,
    set(value) {
      source = value;
      navigations += 1;
    },
  });
  preview.contentWindow = {
    postMessage(message, origin) {
      messages.push({ message, origin });
    },
  };
  const module = await loadModuleExports(entry('admin', 'clock-card.js'), {
    ...dom,
    URL,
    location: new URL('http://localhost:3000/admin'),
    fetch: (_url, options) => {
      if (options.method === 'POST') {
        writes.push(JSON.parse(options.body));
        return Promise.resolve({ ok: true, text: async () => JSON.stringify({ ok: true, data: { settings: writes.at(-1) } }) });
      }
      return new Promise((resolve) => {
        resolveConfig = resolve;
      });
    },
  });
  module.initClockCard();
  assert.equal(navigations, 0, 'wait for saved settings before loading preview');
  resolveConfig({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        style: 'digital',
        showDate: true,
        showSeconds: true,
        hourFormat: '24',
      },
    }),
  });
  await flush();
  assert.equal(navigations, 1);
  assert.equal(new URL(source).origin, 'http://localhost:3000');
  assert.equal(new URL(source).searchParams.get('style'), 'digital');
  assert.equal(dom.document.getElementById('clockFixedUrl').textContent, 'http://127.0.0.1:3000/clock');

  for (const style of ['timeline-vertical', 'soda']) {
    const button = dom.options.find((option) => option.dataset.clockStyleOption === style);
    button.listeners.get('click')();
  }
  const label = dom.document.getElementById('clockCustomLabel');
  label.value = '预览文字';
  label.listeners.get('input')();
  const seconds = dom.document.getElementById('clockShowSeconds');
  seconds.checked = false;
  seconds.listeners.get('change')();
  preview.listeners.get('load')();
  assert.equal(navigations, 1, 'controls and late load never reload the document');
  const latest = messages.at(-1);
  assert.equal(latest.origin, '*');
  assert.equal(latest.message.type, 'component-preview:config');
  assert.equal(latest.message.config.style, 'soda');
  assert.equal(latest.message.config.label, '预览文字');
  assert.equal(latest.message.config.showSeconds, false);
  assert.equal(dom.timers.size, 0);
  assert.equal(writes.length, 0);
  await dom.document.getElementById('clockSave').listeners.get('click')();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].clockStyle, 'soda');
  assert.equal(writes[0].clockShowSeconds, 'false');
  assert.equal(writes[0].clockLabel, '预览文字');
});

test('clock applies only same-origin parent previews without restarting its timer', async () => {
  const dom = createClockDom();
  await loadModuleExports(entry('overlays', 'clock.js'), {
    ...dom,
    URL,
    URLSearchParams,
    location: new URL('http://127.0.0.1:3000/clock?style=peach&date=1&seconds=1&format=24'),
    fetch: () => {
      assert.fail('complete preview parameters need no fetch');
    },
  });
  const card = dom.document.getElementById('clockCard');
  assert.equal(card.hidden, false);
  const timer = [...dom.timers.keys()][0];
  const receive = dom.window.listeners.get('message');
  const message = {
    source: dom.window.parent,
    origin: 'http://127.0.0.1:3000',
    data: {
      type: 'lira:clock-preview-config',
      config: {
        style: 'starlight',
        showDate: false,
        showSeconds: false,
        hourFormat: '12',
        label: '  新的   角标  ',
      },
    },
  };
  receive({ ...message, source: {} });
  receive({ ...message, origin: 'https://untrusted.example' });
  receive({ ...message, data: { type: 'unrelated' } });
  assert.equal(card.dataset.clockStyle, 'peach');
  receive(message);
  assert.equal(card.dataset.clockStyle, 'starlight');
  assert.equal(dom.document.getElementById('clockLabel').textContent, '新的 角标');
  assert.equal(dom.document.getElementById('clockSeconds').hidden, true);
  assert.equal(dom.document.getElementById('clockDateRow').hidden, true);
  assert.equal(dom.document.getElementById('clockPeriod').hidden, false);
  assert.deepEqual([...dom.timers.keys()], [timer]);
  assert.equal(dom.animations.length, 1);
  message.data.config.style = 'soda';
  receive(message);
  assert.equal(dom.animations[0].cancelled, true);
  dom.window.matchMedia = () => ({ matches: true });
  message.data.config.style = 'timeline-vertical';
  receive(message);
  assert.equal(dom.animations[1].cancelled, true);
  assert.equal(dom.animations.length, 2, 'reduced motion suppresses transitions');
  dom.window.parent = dom.window;
  receive({
    ...message,
    source: dom.window,
    data: { ...message.data, config: { style: 'peach' } },
  });
  assert.equal(card.dataset.clockStyle, 'timeline-vertical');
  dom.document.hidden = true;
  dom.document.listeners.get('visibilitychange')();
  assert.equal(dom.timers.size, 0);
  dom.document.hidden = false;
  dom.document.listeners.get('visibilitychange')();
  assert.equal(dom.timers.size, 1);
});

test('browser source reveals saved settings and current time together, retaining query overrides', async () => {
  const dom = createClockDom();
  let resolveConfig;
  await loadModuleExports(entry('overlays', 'clock.js'), {
    ...dom,
    URLSearchParams,
    location: new URL('http://127.0.0.1:3000/clock?seconds=0'),
    fetch: () =>
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
  });
  const card = dom.document.getElementById('clockCard');
  assert.equal(card.hidden, true);
  assert.equal(dom.timers.size, 0);
  resolveConfig({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        style: 'digital',
        showDate: true,
        showSeconds: true,
        hourFormat: '24',
      },
    }),
  });
  await flush();
  assert.equal(card.hidden, false);
  assert.equal(card.dataset.clockStyle, 'digital');
  assert.equal(dom.document.getElementById('clockSeconds').hidden, true);
  assert.match(dom.document.getElementById('clockTime').dateTime, /^\d{4}-/);
  assert.match(dom.document.getElementById('clockDate').textContent, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(dom.timers.size, 1);
});

test('flip presets and custom colors update and save without reloading the preview', async () => {
  const dom = createClockDom();
  const messages = [];
  const writes = [];
  const preview = dom.document.getElementById('clockPreview');
  preview.contentWindow = { postMessage(message) { messages.push(message); } };
  const module = await loadModuleExports(entry('admin', 'clock-card.js'), {
    ...dom, URL, location: new URL('http://localhost:3000/admin'),
    fetch: async (_url, options) => {
      if (options.method === 'POST') {
        writes.push(JSON.parse(options.body));
        return { ok: true, text: async () => JSON.stringify({ ok: true, data: { settings: writes.at(-1) } }) };
      }
      return { ok: true, json: async () => ({ ok: true, data: { style: 'flip', flipTextColor: '#123456' } }) };
    },
  });
  module.initClockCard();
  await flush();
  const source = preview.src;
  assert.equal(dom.document.getElementById('clockFlipColors').hidden, false);
  assert.equal(dom.document.getElementById('clockFlipTextColor').value, '#123456');
  dom.palettes.find((button) => button.dataset.clockPalette === 'lilac').listeners.get('click')();
  const textColor = dom.document.getElementById('clockFlipTextColor');
  textColor.value = '#113355';
  textColor.listeners.get('input')();
  assert.equal(messages.at(-1).config.flipTextColor, '#113355');
  assert.equal(messages.at(-1).config.flipFrameColor, '#cb69e3');
  assert.equal(preview.src, source);
  assert.equal(dom.timers.size, 0);
  assert.equal(writes.length, 0);
  await dom.document.getElementById('clockSave').listeners.get('click')();
  assert.equal(writes[0].clockFlipTextColor, '#113355');
  assert.equal(writes[0].clockFlipFrameColor, '#cb69e3');
  dom.options.find((button) => button.dataset.clockStyleOption === 'orbit').listeners.get('click')();
  assert.equal(dom.document.getElementById('clockFlipColors').hidden, true);
  assert.equal(dom.document.getElementById('clockCustomLabel').disabled, true);
});

test('flip cells animate only changed values, settle on rollover and clean up on style changes', async () => {
  const dom = createClockDom();
  let now = new Date(2026, 8, 29, 23, 59, 58).getTime();
  class ClockDate extends Date {
    constructor() { super(now); }
    static now() { return now; }
  }
  await loadModuleExports(entry('overlays', 'clock.js'), {
    ...dom, URL, URLSearchParams, Date: ClockDate,
    location: new URL('http://127.0.0.1:3000/clock?style=flip&date=1&seconds=1&format=24'),
  });
  const node = (id) => dom.document.getElementById(id);
  const halves = (id) => node(id).children.filter((half) => half.children.length).map((half) => half.children[0].textContent);
  const value = (id) => node(id).children.at(-1).textContent;
  assert.equal(dom.animations.length, 0, 'first frame must not flip from placeholder zeroes');
  assert.equal(node('clockHours').getAttribute('aria-label'), '23');
  assert.equal(node('clockSeconds').getAttribute('aria-label'), '58');
  assert.deepEqual(halves('clockSeconds').slice(0, 2), ['58', '58']);
  assert.equal(value('clockSeconds'), '58');
  assert.equal(node('clockSeconds').classList.contains('is-flipping'), false);
  assert.equal(node('clockDate').getAttribute('aria-label'), '9/29');
  function tick() { [...dom.timers.values()][0](); }
  now += 1000;
  tick();
  assert.equal(dom.animations.length, 2, 'seconds flip together as one two-digit cell');
  assert.equal(dom.animations[0].keyframes[1].transform, 'rotateX(-90deg)');
  assert.equal(dom.animations[1].options.delay, 240);
  assert.equal(node('clockSeconds').classList.contains('is-flipping'), true);
  dom.animations[1].onfinish();
  assert.equal(dom.animations[0].cancelled, true);
  assert.deepEqual(halves('clockSeconds').slice(0, 2), ['59', '59']);
  assert.equal(value('clockSeconds'), '59');
  assert.equal(node('clockSeconds').classList.contains('is-flipping'), false);
  now += 1000;
  tick();
  assert.equal(dom.animations.length, 12, 'midnight changes all five cells');
  assert.equal(node('clockHours').getAttribute('aria-label'), '00');
  assert.equal(node('clockDate').getAttribute('aria-label'), '9/30');
  assert.equal(node('clockWeekday').getAttribute('aria-label'), 'WED');
  for (const animation of dom.animations) animation.onfinish?.();
  assert.deepEqual(halves('clockHours').slice(0, 2), ['00', '00']);
  assert.deepEqual(halves('clockSeconds').slice(0, 2), ['00', '00']);
  assert.equal(value('clockHours'), '00');
  assert.equal(value('clockSeconds'), '00');
  dom.window.matchMedia = () => ({ matches: true });
  now += 1000;
  tick();
  assert.equal(dom.animations.length, 12, 'reduced motion still updates time without folding');
  assert.equal(value('clockSeconds'), '01');
  const receive = (config) => dom.window.listeners.get('message')({
    source: dom.window.parent, origin: 'http://127.0.0.1:3000', data: { type: 'lira:clock-preview-config', config },
  });
  dom.window.matchMedia = () => ({ matches: false });
  receive({ style: 'flip', showSeconds: false, showDate: false, hourFormat: '12', flipTextColor: '#bc59d6' });
  assert.equal(node('clockHours').getAttribute('aria-label'), '12');
  assert.equal(node('clockPeriod').textContent, 'AM');
  assert.equal(node('clockSeconds').hidden, true);
  assert.equal(node('clockDateRow').hidden, true);
  assert.equal(node('clockCard').style['--flip-ink'], '#bc59d6');
  const count = dom.animations.length;
  now += 1000;
  tick();
  assert.equal(dom.animations.length, count, 'hidden seconds do not animate');
  receive({ style: 'orbit', showSeconds: false });
  assert.equal(node('clockHours').children.length, 0);
  assert.equal(node('clockHours').classList.contains('clock-flip-cell'), false);
  assert.equal(node('clockSeconds').children.length, 0);
  assert.equal(node('clockSeconds').classList.contains('clock-flip-cell'), false);
  assert.equal(node('clockDate').textContent, '2026.09.30');
  assert.equal(node('clockWeekday').textContent, '星期三');
  assert.equal(dom.timers.size, 1, 'style switches retain a single timer');
});
