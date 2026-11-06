'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const adminPath = path.join(__dirname, '../../public/js/admin');

test('current song preview shares one live subscription across layers and releases it when switching scenes', async () => {
  const events = new Set();
  const emitted = [];
  let nowPlaying = { source: 'qq-client', trackTitle: '当前歌曲', artists: ['歌手'], playing: true };
  let listener;
  const state = { draft: { document: { items: [] } } };
  const controller = { subscribe(receive) { listener = receive; receive(state); return () => { listener = null; }; } };
  const context = vm.createContext({ window: {
    addEventListener(name, receive) { assert.equal(name, 'app:now-playing'); events.add(receive); },
    removeEventListener(_name, receive) { events.delete(receive); },
  } });
  const module = new vm.SourceTextModule(fs.readFileSync(path.join(adminPath, 'now-playing-canvas-data.js'), 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(['stateService'], function () {
    this.setExport('stateService', { getAppState: () => ({ nowPlaying }) });
  }, { context }));
  await module.evaluate();
  const stop = module.namespace.startNowPlayingCanvasData(controller, value => emitted.push(value));
  const latest = () => emitted.at(-1)?.previewData['now-playing'];
  assert.equal(events.size, 0);
  state.draft.document.items = [{ type: 'now-playing' }, { type: 'now-playing' }];
  listener(state);
  listener(state);
  assert.equal(events.size, 1);
  assert.equal(latest().nowPlaying.trackTitle, '当前歌曲');
  nowPlaying = { ...nowPlaying, trackTitle: '切换后的歌曲', playing: false };
  events.forEach(receive => receive({ detail: nowPlaying }));
  assert.equal(latest().nowPlaying.trackTitle, '切换后的歌曲');
  assert.equal(latest().nowPlaying.playing, false);
  nowPlaying = null;
  events.forEach(receive => receive({ detail: nowPlaying }));
  assert.equal(latest(), null, 'No current track leaves sample selection to the preview renderer.');
  state.draft.document.items = [{ type: 'lyrics' }];
  listener(state);
  assert.equal(events.size, 0);
  nowPlaying = { trackTitle: '重新进入时的歌曲', artists: [], playing: true };
  state.draft.document.items = [{ type: 'now-playing' }];
  listener(state);
  assert.equal(latest().nowPlaying.trackTitle, nowPlaying.trackTitle);
  stop();
  assert.equal(events.size, 0);
  assert.equal(listener, null);
});

test('wish previews follow saved wishes across layers and cancel replies after leaving the scene', async () => {
  const reads = [];
  const emitted = [];
  const timers = new Map();
  let timerId = 0;
  let listener;
  let finish;
  const { startGiftWishesCanvasData } = await loadModuleExports(path.join(adminPath, 'gift-wishes-canvas-data.js'), {
    AbortController,
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { reads.push({ url, options }); return new Promise(resolve => { finish = resolve; }); },
  });
  const state = { draft: { document: { items: [] } } };
  const controller = { subscribe(receive) { listener = receive; receive(state); return () => { listener = null; }; } };
  const stop = startGiftWishesCanvasData(controller, value => emitted.push(value));
  assert.equal(reads.length, 0);
  state.draft.document.items = [{ type: 'gift-wishes' }, { type: 'gift-wishes' }];
  listener(state);
  listener(state);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].url, '/api/gifts/wishes');
  const wish = { id: 'saved-wish', period: 'long', giftName: '保存的礼物', count: 3, target: 12,
    textPendingColor: '#123456', textReceivedColor: '#abcdef' };
  finish({ ok: true, json: async () => ({ ok: true, data: { items: [wish] } }) });
  await new Promise(resolve => setImmediate(resolve));
  const items = emitted[0].previewData['gift-wishes'].items;
  assert.equal(items.length, 1);
  assert.equal(items[0].period, 'long');
  assert.equal(items[0].target, 12);
  assert.equal(items[0].textPendingColor, '#123456');
  listener(state);
  assert.equal(reads.length, 1, 'Changing geometry does not refetch wishes.');
  const update = [...timers.values()].find(timer => timer.delay === 3000).callback();
  finish({ ok: true, json: async () => ({ ok: true, data: { items: [{ ...wish, textPendingColor: '#fedcba' }] } }) });
  await update;
  assert.equal(emitted.at(-1).previewData['gift-wishes'].items[0].textPendingColor, '#fedcba');
  state.draft.document.items = [];
  listener(state);
  assert.equal(timers.size, 0);
  assert.equal(emitted.at(-1).previewData['gift-wishes'], null);
  state.draft.document.items = [{ type: 'gift-wishes' }];
  listener(state);
  stop();
  assert.equal(listener, null);
  assert.equal(reads.at(-1).options.signal.aborted, true);
  const before = emitted.length;
  finish({ ok: true, json: async () => ({ ok: true, data: { items: [wish] } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(emitted.length, before);
});

test('wish editors and canvases share a feed until the last consumer closes', async () => {
  const reads = [];
  const desktop = [];
  const canvas = [];
  let finish;
  const { createGiftWishFeed } = await loadModuleExports(path.join(adminPath, '../shared/gift-wish-client.js'), {
    AbortController, setTimeout, clearTimeout,
    fetch(url, options) { reads.push({ url, options }); return new Promise(resolve => { finish = resolve; }); },
  });
  const first = createGiftWishFeed({ onData: value => desktop.push(value), onError: () => {} });
  const second = createGiftWishFeed({ onData: value => canvas.push(value), onError: () => {} });
  const pending = first.start();
  second.start();
  assert.equal(reads.length, 1);
  finish({ ok: true, json: async () => ({ ok: true, data: { items: [{ id: 'saved' }] } }) });
  await pending;
  assert.equal(desktop[0].items[0].id, 'saved');
  assert.equal(canvas[0].items[0].id, 'saved');
  first.stop();
  assert.equal(reads[0].options.signal.aborted, false);
  const update = second.refresh();
  finish({ ok: true, json: async () => ({ ok: true, data: { items: [] } }) });
  await update;
  assert.equal(canvas.at(-1).items.length, 0);
  assert.equal(desktop.length, 1);
  const cancelled = second.refresh();
  second.stop();
  assert.equal(reads.at(-1).options.signal.aborted, true);
  finish({ ok: true, json: async () => ({ ok: true, data: { items: [{ id: 'late' }] } }) });
  await cancelled;
  assert.equal(canvas.length, 2);
});

test('wish previews explain missing wishes and clear unavailable data', async () => {
  for (const failed of [false, true]) {
    const { startGiftWishesCanvasData } = await loadModuleExports(path.join(adminPath, 'gift-wishes-canvas-data.js'), {
      AbortController, setTimeout, clearTimeout,
      fetch: async () => {
        if (failed) throw new Error('Unavailable');
        return { ok: true, json: async () => ({ ok: true, data: { items: [] } }) };
      },
    });
    let stop;
    const value = await new Promise(resolve => {
      stop = startGiftWishesCanvasData({ subscribe(receive) {
        receive({ draft: { document: { items: [{ type: 'gift-wishes' }] } } });
        return () => {};
      } }, resolve);
    });
    stop();
    assert.equal(value.previewData['gift-wishes'].items.length, 0);
    assert.ok(value.previewData['gift-wishes'].message);
  }
});

test('canvas data shares requests, clears failures and cancels late replies', async () => {
  const timers = new Map();
  const reads = [];
  const emitted = [];
  let items = [];
  let finish;
  let reject;
  const api = await loadModuleExports(path.join(adminPath, 'canvas-data-poller.js'), {
    AbortController,
    window: { setTimeout(callback) { timers.set(1, callback); return 1; }, clearTimeout(id) { timers.delete(id); } },
    fetch(url, options) { reads.push({ url, options }); return new Promise((resolve, fail) => { finish = resolve; reject = fail; }); },
  });
  const stop = api.startCanvasDataPolling({ getState: () => ({ draft: { document: { items } } }) }, {
    type: 'games', url: '/api/games/session', emit: value => emitted.push(value),
  });
  const latest = () => emitted.at(-1);
  assert.equal(reads.length, 0);
  assert.equal(latest(), null);
  items = [{ type: 'games' }, { type: 'games' }];
  const refresh = timers.get(1)();
  assert.equal(reads.length, 1, 'Multiple layers share a single request.');
  assert.equal(reads[0].url, '/api/games/session');
  finish({ ok: true, json: async () => ({ ok: true, data: { marker: 10 } }) });
  await refresh;
  assert.equal(latest().marker, 10);
  const failed = timers.get(1)();
  reject(new Error('Unavailable'));
  await failed;
  assert.equal(latest(), null, 'Failed reads clear stale display data.');
  const pending = timers.get(1)();
  const count = emitted.length;
  stop();
  assert.equal(reads.at(-1).options.signal.aborted, true);
  finish({ ok: true, json: async () => ({ ok: true, data: { marker: 20 } }) });
  await pending;
  assert.equal(emitted.length, count, 'A late reply cannot restore a disposed preview.');
  assert.equal(timers.size, 0);
});

function createNode() {
  const fields = new Map();
  const handlers = new Map();
  return {
    children: [], dataset: {}, value: '',
    append(...children) { this.children.push(...children); },
    addEventListener(name, handler) { handlers.set(name, handler); },
    fire(name) { handlers.get(name)?.(); },
    querySelectorAll() { return []; },
    querySelector() { return createNode(); },
    cloneNode() { return createNode(); },
    hasAttribute() { return false; },
    setAttribute() {},
    getElementById(id) {
      if (!fields.has(id)) fields.set(id, createNode());
      return fields.get(id);
    },
  };
}

async function createFixture(initial = { revision: 1, status: 'paused', effectiveRemainingMs: 30000 }) {
  const document = createNode();
  document.createElement = createNode;
  document.importNode = (node, deep) => node.cloneNode(deep);
  const { createOvertimePreview } = await loadModuleExports(path.join(adminPath, 'overtime-preview-factory.js'), {
    document, URL, location: new URL('http://127.0.0.1:3000/component-preview'),
  });
  const data = { starts: 0, stops: 0, receive: null };
  const controller = {
    subscribe(listener) { listener({ draft: { path: '', fit: 'cover' } }); return () => {}; },
    edit() { throw new Error('Preview data must not edit configuration'); },
  };
  const preview = createOvertimePreview({ controller, embedded: true, startActualData(emit) {
    data.starts++;
    data.receive = emit;
    emit(initial);
    return () => { data.stops++; data.receive = null; };
  } });
  const host = createNode();
  const panel = preview.createPanel(host);
  const select = host.children[0].children[0];
  return { preview, data, panel, mode(value) { select.value = value; select.fire('change'); } };
}

test('overtime layers share one provider until the last layer leaves and tolerate repeated disposal', async () => {
  const { preview, data, panel } = await createFixture();
  const first = [];
  const second = [];
  const emitFirst = (value) => first.push(value);
  const stopFirst = preview.startLayerData({ emit: emitFirst });
  const stopSecond = preview.startLayerData({ emit: (value) => second.push(value) });
  assert.equal(data.starts, 1);
  assert.equal(first[0], second[0]);
  data.receive({ revision: 2, status: 'running' });
  assert.equal(first.at(-1), second.at(-1));
  stopFirst();
  assert.equal(data.stops, 0);
  data.receive({ revision: 3, status: 'finished' });
  assert.equal(first.at(-1).revision, 2);
  assert.equal(second.at(-1).revision, 3);
  stopSecond();
  stopSecond();
  assert.equal(data.stops, 1);
  const stopRemount = preview.startLayerData({ emit: emitFirst });
  assert.equal(data.starts, 2);
  stopFirst();
  assert.equal(data.stops, 1);
  data.receive({ revision: 4, status: 'paused' });
  assert.equal(first.at(-1).revision, 4);
  stopRemount();
  assert.equal(data.stops, 2);
  panel.dispose();
});

test('overtime mode changes start data only for active layers and switch their shared provider once', async () => {
  const { preview, data, panel, mode } = await createFixture();
  mode('paused');
  mode('actual');
  assert.equal(data.starts, 0);
  const first = [];
  const second = [];
  const stopFirst = preview.startLayerData({ emit: (value) => first.push(value) });
  const stopSecond = preview.startLayerData({ emit: (value) => second.push(value) });
  mode('paused');
  assert.equal(data.starts, 1);
  assert.equal(data.stops, 1);
  assert.equal(first.at(-1).effectiveRemainingMs, 120000);
  assert.equal(first.at(-1), second.at(-1));
  mode('actual');
  assert.equal(data.starts, 2);
  assert.equal(data.stops, 1);
  assert.equal(first.at(-1).effectiveRemainingMs, 30000);
  stopFirst();
  stopSecond();
  assert.equal(data.stops, 2);
  mode('paused');
  mode('actual');
  assert.equal(data.starts, 2);
  assert.equal(data.stops, 2);
  panel.dispose();
});

test('offline recovery injects null display data for every layer without inventing actual state', async () => {
  const { preview, data, panel } = await createFixture(null);
  const values = [];
  const first = preview.startLayerData({ emit: (value) => values.push(value) });
  const second = preview.startLayerData({ emit: (value) => values.push(value) });
  assert.deepEqual(values, [null, null]);
  assert.equal(data.starts, 1);
  first();
  second();
  assert.equal(data.stops, 1);
  panel.dispose();
});

test('preview factories, browser definitions and stage have no transitive desktop owner or state dependency', async () => {
  const blocked = new Set(['clock-card.js', 'danmaku-overlay-settings.js', 'overtime-preview.js',
    'component-preview-dialog.js', 'component-preview-registry.js', 'scene-editor-preview-data.js', 'state.js', 'event-bus.js']);
  const context = vm.createContext({});
  const modules = new Map();
  function load(file) {
    assert.equal(blocked.has(path.basename(file)), false, `Preview module imported ${file}`);
    if (!modules.has(file)) {
      modules.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file }));
    }
    return modules.get(file);
  }
  for (const name of ['clock-preview.js', 'danmaku-preview.js', 'overtime-preview-factory.js', 'queue-preview.js',
    'component-preview-definitions.js', 'scene-editor-stage.js', 'scene-item-controller.js']) {
    const module = load(path.join(adminPath, name));
    if (module.status === 'unlinked') {
      await module.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
    }
    if (module.status === 'linked') await module.evaluate();
  }
});
