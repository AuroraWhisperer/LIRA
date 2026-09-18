'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(name) {
  const requests = [];
  const sockets = [];
  const timers = new Map();
  const elements = new Map();
  const handlers = new Map();
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) {
      let html = '';
      elements.set(id, {
        textContent: '',
        writes: 0,
        get innerHTML() { return html; },
        set innerHTML(value) { html = value; this.writes += 1; },
        classList: { add() {}, remove() {}, toggle() {} },
        style: { setProperty() {} },
        setAttribute() {},
        addEventListener() {},
        replaceChildren() {},
      });
    }
    return elements.get(id);
  }
  const observed = [];
  const records = [];
  const context = vm.createContext({
    console: { warn() {} },
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    window: {
      addEventListener() {},
      OverlayUtils: { scrollSpeedToDuration: () => 45 },
    },
    document: {
      addEventListener: (type, callback) => handlers.set(type, callback),
      getElementById: element,
      createElement: () => element('created'),
      querySelector: () => element('panel'),
      documentElement: element('root'),
      body: element('body'),
    },
    WebSocket: class {
      constructor() { this.listeners = new Map(); sockets.push(this); }
      addEventListener(type, callback) { this.listeners.set(type, callback); }
      emit(type, payload = {}) { this.listeners.get(type)?.(payload); }
      close() { this.emit('close'); }
    },
    fetch: (url, options = {}) => new Promise((resolve, reject) => {
      requests.push({
        url,
        options,
        resolve: (data) => resolve({ ok: true, json: async () => ({ ok: true, data }) }),
        reject,
      });
    }),
    setTimeout: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    observed,
    fakeScroller: {
      captureAnchor: () => null,
      pause() {}, start() {}, setSecondsPerViewport() {},
      setRecords: (next) => records.push(next),
    },
    desktopLyricRenderer: {
      init() {},
      applySettings: (value) => observed.push(['settings', value]),
      updateLyricState: (value) => observed.push(['state', value]),
      updateLyricTimeline: (value) => observed.push(['timeline', value]),
    },
  });
  const source = name === 'lyric-window'
    ? fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'overlays', `${name}.js`), 'utf8')
      .replace(/^import[^\n]+\n/gm, '')
    : readJsModuleBundle('public', 'js', 'overlays', `${name}.js`).replace(
      /^\s*\{\s*applyTheme,\s*setIdentityRuleThemeVars\s*\}\s+from\s+['"]\.\/queue-theme\.js['"];\s*/gm,
      '',
    );
  vm.runInContext(source, context);
  if (name === 'queue') vm.runInContext('render = () => observed.push(state);', context);
  if (name === 'games') vm.runInContext('renderGame = (value) => { session = value; observed.push(value); };', context);
  if (name === 'wheel') vm.runInContext('renderState = (value) => { currentState = value; observed.push(value); };', context);
  if (name === 'songs') vm.runInContext(`
    scroller = fakeScroller;
    songListElement = document.getElementById('songScrollList');
    applyTheme = () => {};
    scheduleRelayout = () => {};
  `, context);
  return {
    context, requests, sockets, timers, observed, records, element, handlers,
    read: (expression) => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context)),
    message: (payload) => sockets.at(-1).emit('message', { data: JSON.stringify(payload) }),
    async timer(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `expected ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
      await flush();
    },
  };
}

const snapshot = (settings, reason = 'settings') => ({
  type: 'snapshot', reason, state: { settings, queue: { waiting: [] } },
});

test('songs retain newer WS settings, discard older HTTP loads and avoid rebuilding unchanged records', async () => {
  const f = fixture('songs');
  f.context.connectSocket();
  const first = f.context.loadAll();
  f.message(snapshot({ songBoardTitle: '新标题' }));
  f.requests[0].resolve({ settings: { songBoardTitle: '旧标题' } });
  f.requests[1].resolve([{ id: 1, name: '新歌' }]);
  await first;
  assert.equal(f.read('state').settings.songBoardTitle, '新标题');
  const renders = f.records.length;
  const older = f.context.loadAll();
  const newer = f.context.loadAll();
  f.requests[4].resolve({ settings: { songBoardTitle: '最新标题' } });
  f.requests[5].resolve([{ id: 1, name: '新歌' }]);
  await newer;
  f.requests[2].resolve({ settings: { songBoardTitle: '迟到标题' } });
  f.requests[3].resolve([{ id: 2, name: '迟到歌' }]);
  await older;
  assert.equal(f.read('state').settings.songBoardTitle, '最新标题');
  assert.equal(f.read('songs')[0].name, '新歌');
  assert.equal(f.records.length, renders);
});

test('songs invalidation rejects in-flight content immediately and clear-all refreshes the library', async () => {
  const f = fixture('songs');
  f.context.connectSocket();
  const pending = f.context.loadAll();
  f.message(snapshot({}, 'database:clear-all'));
  f.requests[0].resolve({ settings: {} });
  f.requests[1].resolve([{ id: 1, name: '清空前' }]);
  await pending;
  assert.deepEqual(f.read('songs'), []);
  await f.timer(220);
  assert.equal(f.requests.length, 4);
  f.requests[2].resolve({ settings: {} });
  f.requests[3].resolve([]);
  await flush();
  assert.deepEqual(f.read('songs'), []);
});

test('queue keeps newer WS and HTTP state, deduplicates unchanged loads and invalidates deferred refreshes', async () => {
  const f = fixture('queue');
  f.context.connectSocket();
  const pending = f.context.loadState();
  f.message(snapshot({ overlayTitle: '新队列' }));
  f.requests[0].resolve({ settings: { overlayTitle: '旧队列' } });
  await pending;
  assert.equal(f.read('state').settings.overlayTitle, '新队列');
  const older = f.context.loadState();
  const newer = f.context.loadState();
  f.requests[2].resolve(f.read('state'));
  await newer;
  f.requests[1].resolve({ settings: { overlayTitle: '迟到' } });
  await older;
  assert.equal(f.observed.length, 1);
  const stale = f.context.loadState();
  f.message(snapshot({ overlayTitle: '下一次' }, 'queue:add'));
  f.requests[3].resolve({ settings: { overlayTitle: '无效旧响应' } });
  await stale;
  assert.equal(f.read('state').settings.overlayTitle, '新队列');
  await f.timer(80);
  f.requests[4].resolve({ settings: { overlayTitle: '下一次' } });
  await flush();
  assert.equal(f.read('state').settings.overlayTitle, '下一次');
});

test('queue style refresh survives a live-status patch while retaining the latest live status', async () => {
  const f = fixture('queue');
  f.context.connectSocket();
  f.message(snapshot({ overlayQueueStyle: 'classic' }));
  f.message(snapshot({ overlayQueueStyle: 'identity' }));
  await f.timer(80);
  f.message({
    ...snapshot({ overlayQueueStyle: 'identity' }, 'live:status'),
    state: { settings: { overlayQueueStyle: 'identity' }, liveStatus: { live: true } },
  });
  f.requests[0].resolve({ settings: { overlayQueueStyle: 'identity' }, liveStatus: { live: false } });
  await flush();
  assert.equal(f.read('state').settings.overlayQueueStyle, 'identity');
  assert.deepEqual(f.read('state').liveStatus, { live: true });
  assert.equal(f.observed.length, 2);
});

test('songs HTTP settings survive a live-status patch without reverting the live status', async () => {
  const f = fixture('songs');
  f.context.connectSocket();
  f.message(snapshot({ songBoardTitle: '原始标题' }));
  const pending = f.context.loadAll();
  f.message({
    type: 'snapshot', reason: 'live:status',
    state: { settings: { songBoardTitle: '新标题' }, liveStatus: { live: true } },
  });
  f.requests[0].resolve({ settings: { songBoardTitle: '新标题' }, liveStatus: { live: false } });
  f.requests[1].resolve([]);
  await pending;
  assert.equal(f.read('state').settings.songBoardTitle, '新标题');
  assert.deepEqual(f.read('state').liveStatus, { live: true });
});

const stats = (profit) => ({ summary: { boxCount: 1, totalCost: 10, totalProfit: profit }, perUser: [] });

test('blindbox applies WS settings without rebuilding unchanged data or accepting late settings', async () => {
  const f = fixture('blindbox');
  f.context.connectSocket();
  const pending = f.context.loadStateThenStats();
  f.context.render(stats(5));
  const writes = f.element('blindboxSummary').writes;
  f.message(snapshot({ blindboxOverlayTitle: '最新盲盒标题', themePrimary: '#123456' }));
  assert.equal(f.element('blindboxTitle').textContent, '最新盲盒标题');
  assert.equal(f.element('blindboxSummary').writes, writes);
  f.requests[0].resolve({ settings: { blindboxOverlayTitle: '旧标题' } });
  await flush();
  f.requests[1].resolve(stats(5));
  await pending;
  assert.equal(f.element('blindboxTitle').textContent, '最新盲盒标题');
  assert.equal(f.element('blindboxSummary').writes, writes);
  f.message(snapshot({}));
  assert.equal(f.element('blindboxTitle').textContent, '今日盲盒盈亏');
});

test('blindbox gift invalidation and newer HTTP statistics supersede older responses', async () => {
  const f = fixture('blindbox');
  f.context.connectSocket();
  const pending = f.context.loadStats();
  f.message(snapshot({}, 'bilibili:gift'));
  f.requests[1].resolve(stats(20));
  await flush();
  f.requests[0].resolve(stats(-1));
  await pending;
  assert.match(f.element('blindboxSummary').innerHTML, /\+¥20\.00/);
  const older = f.context.loadStats();
  const newer = f.context.loadStats();
  f.requests[3].resolve(stats(30));
  await newer;
  f.requests[2].resolve(stats(-2));
  await older;
  assert.match(f.element('blindboxSummary').innerHTML, /\+¥30\.00/);
});

for (const name of ['games', 'wheel']) {
  const load = name === 'games' ? 'loadSnapshot' : 'loadState';
  const update = (value) => name === 'games'
    ? { type: 'game:update', session: value }
    : { type: 'wheel:update', state: value };
  test(`${name} reconciles on first connection after REST failure and reconnects only once`, async () => {
    const f = fixture(name);
    const pending = f.context[load]();
    f.requests[0].reject(new Error('offline'));
    await pending;
    f.context.connectSocket();
    f.context.connectSocket();
    assert.equal(f.sockets.length, 1);
    f.sockets[0].emit('open');
    assert.equal(f.requests.length, 2);
    assert.equal(f.timers.size, 0);
    f.requests[1].resolve({ id: 'restored' });
    await flush();
    f.message(snapshot({}));
    assert.equal(f.observed.at(-1).id, 'restored');
    assert.equal(f.requests.length, 2);
    f.sockets[0].emit('close');
    f.sockets[0].emit('close');
    await f.timer(800);
    assert.equal(f.sockets.length, 2);
    assert.equal(f.requests.length, 2);
    f.sockets[1].emit('open');
    assert.equal(f.requests.length, 3);
    f.requests[2].resolve({ id: 'reconnected' });
    await flush();
    assert.equal(f.observed.at(-1).id, 'reconnected');
  });

  test(`${name} rejects stale REST state and errors after a dedicated WS update`, async () => {
    const f = fixture(name);
    f.context.connectSocket();
    const first = f.context[load]();
    f.message(update({ id: 'new-ws' }));
    f.requests[0].resolve({ id: 'old-http' });
    await first;
    const second = f.context[load]();
    f.message(update({ id: 'latest-ws' }));
    f.requests[1].reject(new Error('late failure'));
    await second;
    assert.deepEqual(f.observed.map((value) => value.id), ['new-ws', 'latest-ws']);
    assert.equal(f.timers.size, 0);
  });

  test(`${name} bounds REST retry attempts without reopening a healthy socket`, async () => {
    const f = fixture(name);
    f.context.connectSocket();
    f.sockets[0].emit('open');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(f.requests.length, attempt + 1);
      f.requests[attempt].reject(new Error('offline'));
      await flush();
      if (attempt < 4) await f.timer(350);
    }
    assert.equal(f.timers.size, 0);
    assert.equal(f.sockets.length, 1);
    f.message(update({ id: 'event-restored' }));
    assert.equal(f.observed.at(-1).id, 'event-restored');
  });

  test(`${name} keeps newer HTTP results and ignores action responses superseded by WS`, async () => {
    const f = fixture(name);
    f.context.connectSocket();
    const older = f.context[load]();
    const newer = f.context[load]();
    f.requests[1].resolve({ id: 'new-http' });
    await newer;
    f.requests[0].resolve({ id: 'old-http' });
    await older;
    assert.deepEqual(f.observed.map((value) => value.id), ['new-http']);
    f.message(update({ id: 'ready', entries: [{ weight: 1 }, { weight: 1 }] }));
    const action = name === 'games'
      ? f.context.submitMove(3)
      : f.context.spinFromWheel();
    assert.equal(f.requests[2].url, name === 'games' ? '/api/games/session/move' : '/api/wheel/spin');
    assert.equal(f.requests[2].options.method, 'POST');
    f.message(update({ id: 'after-action' }));
    f.requests[2].resolve({ id: 'action-response' });
    await action;
    assert.equal(f.observed.at(-1).id, 'after-action');
  });
}

test('games accept an authoritative empty session on later reconciliation', async () => {
  const f = fixture('games');
  f.context.connectSocket();
  f.message({ type: 'game:update', session: { id: 'running' } });
  const pending = f.context.loadSnapshot();
  f.requests[0].resolve(null);
  await pending;
  assert.equal(f.observed.at(-1), null);
  assert.equal(f.timers.size, 0);
});

test('lyrics load settings and timeline from first and reconnected snapshots without invalid GET settings', async () => {
  const f = fixture('lyric-window');
  f.handlers.get('DOMContentLoaded')();
  f.message({ type: 'snapshot', state: { settings: { size: 32 }, lyricTimeline: { id: 1 }, lyricState: { playing: true } } });
  assert.deepEqual(f.observed.map(([type]) => type), ['settings', 'timeline', 'state']);
  assert.equal(f.observed[0][1].size, 32);
  f.sockets[0].emit('close');
  await f.timer(1000);
  f.message({ type: 'snapshot', state: { settings: { size: 40 } } });
  assert.equal(f.observed[3][1].size, 40);
  assert.equal(f.requests.length, 0);
});
