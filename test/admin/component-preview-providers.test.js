'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const adminPath = path.join(__dirname, '../../public/js/admin');

test('wish previews fill the supported limit from distinct catalog gifts once and cancel late replies', async () => {
  const reads = [];
  const emitted = [];
  let listener;
  let finish;
  const { startGiftWishesCanvasData } = await loadModuleExports(path.join(adminPath, 'gift-wishes-canvas-data.js'), {
    AbortController, setTimeout, clearTimeout,
    Math: Object.assign(Object.create(Math), { random: () => 0.99 }),
    fetch(url, options) { reads.push({ url, options }); return new Promise(resolve => { finish = resolve; }); },
  });
  const state = { draft: { document: { items: [] } } };
  const controller = { subscribe(receive) { listener = receive; receive(state); return () => { listener = null; }; } };
  let stop = startGiftWishesCanvasData(controller, value => emitted.push(value));
  assert.equal(reads.length, 0);
  state.draft.document.items = [{ type: 'gift-wishes' }, { type: 'gift-wishes' }];
  listener(state);
  listener(state);
  assert.equal(reads.length, 1);
  const gifts = [1, 2, 3, 4].map(id => ({ id: String(id), name: `合成礼物 ${id}`, imagePath: `/gift-image/${id}.png` }));
  finish({ ok: true, json: async () => ({ ok: true, data: { gifts: [...gifts, gifts[0], { id: 'missing-art', name: '无图片' }] } }) });
  await new Promise(resolve => setImmediate(resolve));
  const items = emitted[0].previewData['gift-wishes'].items;
  assert.equal(items.length, 30);
  assert.equal(new Set(items.map(item => item.id)).size, 30);
  assert.deepEqual(Array.from(items.slice(0, 4), item => item.giftId), ['4', '3', '2', '1']);
  for (const item of items) {
    const gift = gifts.find(gift => gift.id === item.giftId);
    assert.equal(item.giftName, gift.name);
    assert.equal(item.imagePath, gift.imagePath);
  }
  listener(state);
  assert.equal(reads.length, 1, 'Changing geometry does not reshuffle or refetch gifts.');
  stop();
  assert.equal(listener, null);
  stop = startGiftWishesCanvasData(controller, value => emitted.push(value));
  stop();
  assert.equal(reads[1].options.signal.aborted, true);
  finish({ ok: true, json: async () => ({ ok: true, data: { gifts } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(emitted.length, 1);
});

test('wish previews fall back to the room cache and explain an empty catalog', async () => {
  for (const empty of [false, true]) {
    const reads = [];
    const { startGiftWishesCanvasData } = await loadModuleExports(path.join(adminPath, 'gift-wishes-canvas-data.js'), {
      AbortController, setTimeout, clearTimeout,
      fetch: async url => {
        reads.push(url);
        if (url.endsWith('/catalog')) throw new Error('Unavailable');
        return { ok: true, json: async () => ({ ok: true, data: { gifts: empty ? [] : [1, 2, 3].map(id =>
          ({ id, name: `合成礼物 ${id}`, imagePath: `/gift-image/${id}.png` })) } }) };
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
    assert.deepEqual(reads, ['/api/overtime/gifts/catalog', '/api/overtime/gifts']);
    assert.equal(value.previewData['gift-wishes'].items.length, empty ? 0 : 30);
    assert.equal(Boolean(value.previewData['gift-wishes'].message), empty);
  }
});

for (const [type, file, startName, url] of [
  ['games', 'games-canvas-data.js', 'startGamesCanvasData', '/api/games/session'],
  ['opening', 'opening-canvas-data.js', 'startOpeningCanvasData', '/api/opening/config'],
]) {
  test(type + ' canvas data shares requests, clears failures and cancels late replies', async () => {
    const timers = new Map();
    const reads = [];
    const emitted = [];
    let items = [];
    let finish;
    let reject;
    const api = await loadModuleExports(path.join(adminPath, file), {
      AbortController,
      window: { setTimeout(callback) { timers.set(1, callback); return 1; }, clearTimeout(id) { timers.delete(id); } },
      fetch(url, options) { reads.push({ url, options }); return new Promise((resolve, fail) => { finish = resolve; reject = fail; }); },
    });
    const stop = api[startName]({ getState: () => ({ draft: { document: { items } } }) }, value => emitted.push(value));
    const latest = () => type === 'games' ? emitted.at(-1).previewData.games.session : emitted.at(-1).previewData.opening;
    assert.equal(reads.length, 0);
    assert.equal(latest(), null);
    items = [{ type }, { type }];
    const refresh = timers.get(1)();
    assert.equal(reads.length, 1, 'Multiple layers share a single request.');
    assert.equal(reads[0].url, url);
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
}

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
  const blocked = new Set(['clock-card.js', 'danmaku-canvas-dialog.js', 'overtime-preview.js',
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
