'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const entry = (area, name) => path.join(__dirname, '../..', 'public', 'js', area, name);
const flush = () => new Promise(setImmediate);
const reply = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });
const savedConfig = (extra = {}) => ({
  enabled: true,
  title: '开播准备中',
  subtitle: '欢迎来到直播间',
  name: '',
  footer: '一起听歌',
  quality: 'normal',
  trackMotion: 'heart',
  showNotes: true,
  showEq: true,
  audio: 'browser',
  volume: 0.35,
  audioUrl: '/opening-media/sample.ogg',
  characterUrl: '',
  ...extra,
});

function createDom() {
  const nodes = new Map();
  const timers = new Map();
  let nextTimer = 0;
  function element() {
    const attributes = new Map();
    const classes = new Set();
    const styles = new Map();
    return {
      listeners: new Map(),
      children: [],
      dataset: {},
      hidden: false,
      isConnected: true,
      value: '',
      textContent: '',
      checked: false,
      srcWrites: 0,
      loadCount: 0,
      playCount: 0,
      paused: true,
      currentTime: 0,
      volume: 1,
      get src() { return attributes.get('src') || ''; },
      set src(value) { attributes.set('src', value); this.srcWrites += 1; },
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      },
      style: { setProperty: (name, value) => styles.set(name, value) },
      getAttribute: (name) => attributes.get(name) ?? null,
      removeAttribute: (name) => attributes.delete(name),
      append(node) { this.children.push(node); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); },
      async dispatch(type, event = {}) {
        for (const listener of this.listeners.get(type) || []) await listener(event);
      },
      load() { this.loadCount += 1; },
      play() { this.playCount += 1; this.paused = false; return Promise.resolve(); },
      pause() { this.paused = true; },
    };
  }
  const document = {
    ...element(),
    documentElement: element(),
    body: element(),
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    querySelector: () => document.getElementById('viewport'),
    createElement: element,
  };
  const window = {
    ...element(),
    setTimeout(callback, delay) {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  window.parent = window;
  const motion = { ...element(), matches: false };
  const svg = document.getElementById('openingTrackSvg');
  svg.resets = 0;
  svg.pauseAnimations = () => { svg.paused = true; };
  svg.unpauseAnimations = () => { svg.paused = false; };
  svg.setCurrentTime = () => { svg.resets += 1; };
  const stage = document.getElementById('openingStage');
  stage.classList.add('is-disabled');
  return {
    document, window, timers, motion, svg, stage,
    async tick(delay) {
      const timer = [...timers].find(([, value]) => value.delay === delay);
      assert.ok(timer, `expected a ${delay}ms timer`);
      timers.delete(timer[0]);
      await timer[1].callback();
      await flush();
    },
    globals(fetch, search = '') {
      return {
        document, window, fetch, URL, URLSearchParams, AbortController,
        performance,
        location: new URL(`http://127.0.0.1:3000/opening${search}`),
        matchMedia: () => motion,
        setTimeout: window.setTimeout,
        clearTimeout: window.clearTimeout,
      };
    },
  };
}

async function loadOverlay(dom, fetch, search) {
  await loadModuleExports(entry('overlays', 'opening.js'), dom.globals(fetch, search));
  await flush();
}

test('opening source polls while disabled and updates text without restarting media or motion', async () => {
  const dom = createDom();
  let config = savedConfig({ enabled: false });
  await loadOverlay(dom, async () => reply(config));
  const audio = dom.document.getElementById('openingAudio');
  assert.ok(dom.stage.classList.contains('is-disabled'));
  assert.equal(audio.getAttribute('src'), null);

  config = savedConfig();
  await dom.tick(1000);
  assert.equal(dom.stage.classList.contains('is-disabled'), false);
  assert.equal(audio.playCount, 1);
  assert.equal(dom.svg.resets, 1);
  const particles = dom.document.getElementById('openingParticles').children;
  audio.currentTime = 31;

  config = savedConfig({ title: '新标题', volume: 0.6 });
  await dom.tick(1000);
  await dom.tick(1000);
  assert.equal(dom.document.getElementById('openingTitle').textContent, '新标题');
  assert.equal(audio.currentTime, 31);
  assert.equal(audio.volume, 0.6);
  assert.equal(audio.srcWrites, 1);
  assert.equal(audio.loadCount, 1);
  assert.equal(audio.playCount, 1);
  assert.equal(dom.svg.resets, 1);
  assert.equal(dom.document.getElementById('openingParticles').children, particles);
  assert.equal(dom.document.listeners.get('visibilitychange').size, 1);

  config = savedConfig({ audioUrl: '/opening-media/next.ogg', characterUrl: '/opening-character/person.png' });
  await dom.tick(1000);
  assert.equal(audio.playCount, 2);
  assert.equal(dom.document.getElementById('openingAvatar').srcWrites, 1);
  assert.equal(dom.stage.classList.contains('no-character'), false);
  config = savedConfig({ enabled: false });
  await dom.tick(1000);
  assert.ok(audio.paused);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.getAttribute('src'), null);
  assert.ok(dom.stage.classList.contains('is-disabled'));
  assert.ok(dom.svg.paused);
});

test('opening low quality stays paused after visibility changes and reduced motion changes', async () => {
  const dom = createDom();
  let config = savedConfig({ quality: 'low' });
  await loadOverlay(dom, async () => reply(config));
  assert.ok(dom.svg.paused);
  dom.document.hidden = true;
  await dom.document.dispatch('visibilitychange');
  dom.document.hidden = false;
  await dom.document.dispatch('visibilitychange');
  assert.ok(dom.svg.paused);
  assert.equal(dom.document.getElementById('openingParticles').children.length, 0);

  config = savedConfig();
  await dom.tick(1000);
  assert.equal(dom.svg.paused, false);
  dom.motion.matches = true;
  await dom.motion.dispatch('change');
  assert.ok(dom.svg.paused);
  config = savedConfig({ title: '减少动态效果' });
  await dom.tick(1000);
  assert.ok(dom.svg.paused);
  dom.motion.matches = false;
  await dom.motion.dispatch('change');
  assert.equal(dom.svg.paused, false);
  assert.deepEqual([...dom.timers.values()].map((timer) => timer.delay), [1000]);
});

test('opening polling retains the last config on failure and honors explicit URL overrides', async () => {
  const dom = createDom();
  let fail = false;
  let config = savedConfig();
  await loadOverlay(dom, async () => {
    if (fail) throw new Error('offline');
    return reply(config);
  }, '?audio=none&title=URL');
  assert.equal(dom.document.getElementById('openingTitle').textContent, 'URL');
  assert.equal(dom.document.getElementById('openingAudio').playCount, 0);
  fail = true;
  await dom.tick(1000);
  assert.equal(dom.stage.classList.contains('is-disabled'), false);
  fail = false;
  config = savedConfig({ title: '保存的标题', subtitle: '已恢复' });
  await dom.tick(1000);
  assert.equal(dom.document.getElementById('openingTitle').textContent, 'URL');
  assert.equal(dom.document.getElementById('openingSubtitle').textContent, '已恢复');
});

test('opening fetch is single-flight, bounded, and discarded after pagehide', async () => {
  const dom = createDom();
  const requests = [];
  await loadOverlay(dom, (_url, options) => new Promise((resolve, reject) => {
    requests.push({ resolve, signal: options.signal });
    if (requests.length === 1) {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }
  }));
  assert.equal(requests.length, 1);
  assert.deepEqual([...dom.timers.values()].map((timer) => timer.delay), [5000]);
  await dom.tick(5000);
  assert.ok(requests[0].signal.aborted);
  // Start the next pending request without waiting for its response.
  const next = [...dom.timers.entries()].find(([, timer]) => timer.delay === 1000);
  assert.ok(next);
  dom.timers.delete(next[0]);
  const pending = next[1].callback();
  assert.equal(requests.length, 2);
  await dom.window.dispatch('pagehide');
  assert.ok(requests[1].signal.aborted);
  requests[1].resolve(reply(savedConfig()));
  await pending;
  await flush();
  assert.ok(dom.stage.classList.contains('is-disabled'));
  assert.equal(dom.timers.size, 0);
  assert.equal(dom.document.listeners.get('visibilitychange').size, 0);
  assert.equal(dom.motion.listeners.get('change').size, 0);
});

test('opening accepts only its parent config and preserves it over a late saved response', async () => {
  const dom = createDom();
  dom.window.parent = {};
  let resolveConfig;
  await loadOverlay(dom, () => new Promise((resolve) => { resolveConfig = resolve; }), '?title=OLD');
  const event = {
    source: dom.window.parent,
    origin: 'http://127.0.0.1:3000',
    data: { type: 'lira:opening-preview-config', config: savedConfig({ title: '正在编辑' }) },
  };
  await dom.window.dispatch('message', { ...event, source: {} });
  await dom.window.dispatch('message', { ...event, origin: 'https://other.test' });
  assert.ok(dom.stage.classList.contains('is-disabled'));
  await dom.window.dispatch('message', event);
  resolveConfig(reply(savedConfig({ title: '旧保存值' })));
  await flush();
  assert.equal(dom.document.getElementById('openingTitle').textContent, '正在编辑');
  assert.equal(dom.document.getElementById('openingAudio').playCount, 1);
  assert.equal(dom.timers.size, 0, 'parent owns preview updates without duplicate polling');
  await dom.window.dispatch('message', {
    ...event,
    data: { type: 'lira:opening-preview-config', config: savedConfig({ audioUrl: 'https://other.test/a.mp3', characterUrl: 'https://other.test/a.png' }) },
  });
  assert.equal(dom.document.getElementById('openingAudio').getAttribute('src'), null);
  assert.equal(dom.document.getElementById('openingAvatar').getAttribute('src'), null);
  assert.ok(dom.stage.classList.contains('no-character'));
});

test('opening editor keeps one preview and serializes saves with the latest controls', async () => {
  const dom = createDom();
  const preview = dom.document.getElementById('openingPreview');
  const messages = [];
  const saves = [];
  preview.contentWindow = { postMessage: (message, origin) => messages.push({ message, origin }) };
  const globals = dom.globals((_url, options = {}) => {
    if (options.method === 'POST') return new Promise((resolve) => saves.push({ resolve, payload: JSON.parse(options.body) }));
    return Promise.resolve(reply(savedConfig()));
  });
  globals.location = new URL('http://localhost:3000/admin');
  const module = await loadModuleExports(entry('admin', 'start-animation.js'), globals);
  module.initStartAnimation();
  await flush();
  assert.equal(preview.srcWrites, 1);
  assert.equal(new URL(preview.src).origin, 'http://localhost:3000');
  assert.equal(dom.document.getElementById('openingUrl').textContent, 'http://127.0.0.1:3000/opening');
  const title = dom.document.getElementById('openingTitle');
  title.value = '第一版';
  await dom.document.getElementById('openingAnimationForm').dispatch('input', { target: title });
  const firstSave = dom.tick(220);
  await flush();
  assert.equal(saves.length, 1);
  title.value = '最新文案';
  await dom.document.getElementById('openingAnimationForm').dispatch('input', { target: title });
  await dom.tick(220);
  assert.equal(saves.length, 1, 'do not overlap settings writes');
  saves[0].resolve({ ok: true });
  await flush();
  assert.equal(saves.length, 2);
  assert.equal(saves[1].payload.openingTitle, '最新文案');
  saves[1].resolve({ ok: true });
  await firstSave;
  await preview.dispatch('load');
  assert.equal(preview.srcWrites, 1);
  assert.equal(messages.at(-1).message.type, 'lira:opening-preview-config');
  assert.equal(messages.at(-1).message.config.title, '最新文案');
  assert.equal(messages.at(-1).origin, '*');
  await dom.document.getElementById('openingAnimationForm').dispatch('change', { target: title });
  await dom.tick(220);
  assert.equal(saves.length, 2, 'duplicate input/change must not save the same payload again');

  dom.document.getElementById('openingEnabled').checked = false;
  await dom.document.getElementById('openingEnabled').dispatch('change');
  assert.equal(preview.src, 'about:blank');
  assert.ok(preview.hidden);
});

test('opening editor updates uploaded media without navigating the preview', async () => {
  const dom = createDom();
  const messages = [];
  const preview = dom.document.getElementById('openingPreview');
  preview.contentWindow = { postMessage: (message) => messages.push(message) };
  const globals = dom.globals(async (_url, options = {}) => reply(savedConfig({
    characterUrl: options.method === 'POST' ? '/opening-character/uploaded.png' : '',
    characterName: '上传人物',
  })));
  globals.FormData = class { append() {} };
  const module = await loadModuleExports(entry('admin', 'start-animation.js'), globals);
  module.initStartAnimation();
  await flush();
  const upload = dom.document.getElementById('openingCharacterFile');
  upload.files = [{ name: 'person.png', size: 32 }];
  await upload.dispatch('change', { target: upload });
  assert.equal(preview.srcWrites, 1);
  assert.equal(messages.at(-1).config.characterUrl, '/opening-character/uploaded.png');
  assert.equal(messages.at(-1).config.audioUrl, '/opening-media/sample.ogg');
});
