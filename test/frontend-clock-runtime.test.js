'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { CLOCK_STYLE_VALUES } = require('../src/server/clock-contract');
const { loadModuleExports } = require('./helpers/frontend-modules');

const entry = (area, name) =>
  path.join(__dirname, '..', 'public', 'js', area, name);
const flush = () => new Promise(setImmediate);

function createClockDom() {
  const nodes = new Map();
  const timers = new Map();
  const animations = [];
  let timerId = 0;
  function element() {
    return {
      listeners: new Map(),
      dataset: {},
      hidden: false,
      value: '',
      textContent: '',
      style: { setProperty() {} },
      classList: { toggle() {} },
      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      },
      getAttribute(name) {
        return this[name] || null;
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      animate() {
        const animation = {
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
  const document = {
    ...element(),
    documentElement: element(),
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    querySelectorAll: () => options,
  };
  document.getElementById('clockCard').hidden = true;
  const window = {
    ...element(),
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
  return { document, window, options, timers, animations };
}

test('clock preview loads once and sends the latest controls after iframe load', async () => {
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
        return Promise.resolve({ ok: true });
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
  assert.equal(
    dom.document.getElementById('clockFixedUrl').textContent,
    'http://127.0.0.1:3000/clock',
  );

  for (const style of ['timeline-vertical', 'soda']) {
    const button = dom.options.find(
      (option) => option.dataset.clockStyleOption === style,
    );
    button.listeners.get('click')();
  }
  const label = dom.document.getElementById('clockCustomLabel');
  label.value = '预览文字';
  label.listeners.get('input')();
  const seconds = dom.document.getElementById('clockShowSeconds');
  seconds.checked = false;
  seconds.listeners.get('change')();
  preview.listeners.get('load')();
  assert.equal(
    navigations,
    1,
    'controls and late load never reload the document',
  );
  const latest = messages.at(-1);
  assert.equal(latest.origin, '*');
  assert.equal(latest.message.type, 'lira:clock-preview-config');
  assert.equal(latest.message.config.style, 'soda');
  assert.equal(latest.message.config.label, '预览文字');
  assert.equal(latest.message.config.showSeconds, false);
  assert.equal(dom.timers.size, 1);
  await [...dom.timers.values()][0]();
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
    location: new URL(
      'http://127.0.0.1:3000/clock?style=peach&date=1&seconds=1&format=24',
    ),
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
  assert.equal(
    dom.document.getElementById('clockLabel').textContent,
    '新的 角标',
  );
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
    fetch: () => new Promise((resolve) => {
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
  assert.match(
    dom.document.getElementById('clockDate').textContent,
    /^\d{4}-\d{2}-\d{2}$/,
  );
  assert.equal(dom.timers.size, 1);
});
