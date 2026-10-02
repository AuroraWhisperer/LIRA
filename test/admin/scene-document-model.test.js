'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadModuleExports } = require('../helpers/frontend-modules');

const plain = (value) => JSON.parse(JSON.stringify(value));
const admin = path.join(__dirname, '../../public/js/admin');
const modules = Promise.all(['scene-document-model.js', 'scene-template.js'].map((file) =>
  loadModuleExports(path.join(admin, file), { TextEncoder, crypto: { randomUUID } })));

function fixture() {
  return {
    schemaVersion: 1, id: randomUUID(), title: '场景', canvas: { width: 800, height: 600 },
    items: [
      { id: randomUUID(), type: 'clock', name: '时钟', x: 40, y: 48, width: 100, height: 60,
        visible: true, locked: false, appearance: { mode: 'shared' } },
      { id: randomUUID(), type: 'queue', name: '队列', x: 200, y: 160, width: 200, height: 100,
        visible: true, locked: false, appearance: { mode: 'shared' } },
      { id: randomUUID(), type: 'overtime', name: '加时', x: 600, y: 400, width: 160, height: 160,
        visible: false, locked: true, appearance: { mode: 'independent', config: { path: '', fit: 'cover' } } },
    ],
  };
}

test('shared canvas resizing scales equal ratios and contains layers after aspect-ratio changes', async () => {
  const [{ resizeSceneCanvas }] = await modules;
  const document = fixture();
  const scaled = resizeSceneCanvas(document, { width: 1600, height: 1200 });
  assert.deepEqual(plain(scaled.items.map(({ x, y, width, height }) => ({ x, y, width, height }))),
    document.items.map(({ x, y, width, height }) => ({ x: x * 2, y: y * 2, width: width * 2, height: height * 2 })));
  const portrait = resizeSceneCanvas(scaled, { width: 400, height: 800 });
  for (const item of portrait.items) {
    assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.width <= 400 && item.y + item.height <= 800);
  }
  assert.deepEqual(plain(document.canvas), { width: 800, height: 600 });
  assert.equal(portrait.items[0].width, scaled.items[0].width);
  for (const canvas of [{ width: 0, height: 800 }, { width: 8000, height: 800 }, { width: 400.5, height: 800 }]) {
    assert.throws(() => resizeSceneCanvas(document, canvas));
  }
});

test('model owns immutable document snapshots and isolated subscription values', async () => {
  const [{ createSceneDocumentModel }] = await modules;
  const document = fixture();
  const model = createSceneDocumentModel(document);
  document.items[0].x = 500;
  let notices = 0;
  const unsubscribe = model.subscribe((state, snapshot) => {
    notices += 1;
    state.canUndo = false;
    snapshot.items[0].x = 700;
  });
  let captured;
  model.edit((draft) => { captured = draft; draft.title = '修改'; });
  captured.items[0].x = 600;
  const copy = model.getDocument();
  copy.items[0].x = 300;
  assert.equal(model.getDocument().items[0].x, 40);
  assert.equal(model.getState().canUndo, true);
  assert.equal(notices, 2);
  unsubscribe();
  model.undo();
  assert.equal(notices, 2);
  assert.equal(model.getDocument().title, '场景');
  model.redo();
  assert.equal(model.getDocument().title, '修改');
});

test('resizing a shared component updates its references and undo, but preserves independent instances', async () => {
  const [{ createSceneDocumentModel }] = await modules;
  const document = fixture();
  const shared = { ...document.items[0], id: randomUUID(), x: 650 };
  const independent = { ...document.items[0], id: randomUUID(), appearance: { mode: 'independent', config: {} } };
  document.items.push(shared, independent);
  const model = createSceneDocumentModel(document);
  model.edit((draft) => { draft.items[0].width = 400; draft.items[0].height = 200; });
  assert.deepEqual(plain(model.getDocument().items[3]), { ...shared, x: 400, width: 400, height: 200 });
  assert.deepEqual(plain(model.getDocument().items[4]), independent);
  model.undo();
  assert.deepEqual(plain(model.getDocument()), document);
});

test('automatic content sizing does not consume the previous user edit undo entry', async () => {
  const [{ createSceneDocumentModel }] = await modules;
  const document = fixture();
  const item = document.items[0];
  const model = createSceneDocumentModel({ ...document, items: [] });
  model.edit((draft) => { draft.items.push(item); });
  model.edit((draft) => { draft.items[0].height += 16; }, { recordHistory: false });
  assert.equal(model.undo(), true);
  assert.equal(model.getDocument().items.length, 0);
  assert.equal(model.undo(), false);
  assert.equal(model.redo(), true);
  assert.equal(model.getDocument().items[0].height, item.height + 16);
});

test('one pointer gesture has one undo entry and updates use the starting snapshot', async () => {
  const [{ createSceneDocumentModel, moveSceneItems }] = await modules;
  const document = fixture();
  const model = createSceneDocumentModel(document);
  model.beginGesture();
  for (const distance of [8, 16, 24, 32]) {
    model.updateGesture((draft) => moveSceneItems(draft, [document.items[0].id], distance, 0));
  }
  assert.equal(model.getDocument().items[0].x, 72);
  assert.deepEqual(plain(model.getState()), { canUndo: false, canRedo: false });
  assert.equal(model.undo(), false);
  assert.throws(() => model.edit((draft) => { draft.title = '不允许'; }));
  assert.throws(() => model.beginGesture());
  assert.equal(model.commitGesture(), true);
  assert.equal(model.undo(), true);
  assert.deepEqual(plain(model.getDocument()), document);
  assert.equal(model.undo(), false);
  model.redo();
  assert.equal(model.getDocument().items[0].x, 72);
});

test('resizing anchors the opposite edges, clamps to the canvas and respects locked and automatic-height layers', async () => {
  const [{ resizeSceneItem }] = await modules;
  const document = fixture();
  const item = document.items[0];
  const geometry = ({ x, y, width, height }) => ({ x, y, width, height });
  const expected = {
    n: [40, 64, 100, 44], e: [40, 48, 124, 60], s: [40, 48, 100, 76], w: [64, 48, 76, 60],
    ne: [40, 64, 124, 44], se: [40, 48, 124, 76], sw: [64, 48, 76, 76], nw: [64, 64, 76, 44],
  };
  for (const [handle, [x, y, width, height]] of Object.entries(expected)) {
    assert.deepEqual(geometry(resizeSceneItem(document, item.id, handle, 24, 16).items[0]), { x, y, width, height });
  }
  assert.deepEqual(geometry(resizeSceneItem(document, item.id, 'nw', -1000, -1000).items[0]),
    { x: 0, y: 0, width: 140, height: 108 });
  assert.deepEqual(geometry(resizeSceneItem(document, item.id, 'nw', 1000, 1000).items[0]),
    { x: 108, y: 76, width: 32, height: 32 });
  assert.deepEqual(geometry(resizeSceneItem(document, item.id, 'se', 1000, 1000).items[0]),
    { x: 40, y: 48, width: 760, height: 552 });
  assert.deepEqual(geometry(resizeSceneItem(document, item.id, 'se', -1000, -1000).items[0]),
    { x: 40, y: 48, width: 32, height: 32 });
  assert.deepEqual(geometry(resizeSceneItem(document, item.id, 'se', 9, 9, { snap: true }).items[0]),
    { x: 40, y: 48, width: 112, height: 72 });
  const overtime = document.items[2];
  assert.deepEqual(plain(resizeSceneItem(document, overtime.id, 'se', 24, 16)), document);
  overtime.locked = false;
  assert.deepEqual(geometry(resizeSceneItem(document, overtime.id, 'nw', -24, -16).items[2]),
    { x: 576, y: 400, width: 184, height: 160 });
  assert.deepEqual(geometry(document.items[0]), { x: 40, y: 48, width: 100, height: 60 });
});

test('cancel, unchanged gestures and failed edits preserve redo; real edits invalidate it', async () => {
  const [{ createSceneDocumentModel }] = await modules;
  const model = createSceneDocumentModel(fixture());
  model.edit((draft) => { draft.title = '后续'; });
  model.undo();
  model.beginGesture();
  model.updateGesture((draft) => { draft.items[0].x = 80; });
  assert.throws(() => model.updateGesture((draft) => { draft.items[0].x = -1; }));
  assert.equal(model.getDocument().items[0].x, 80);
  model.cancelGesture();
  assert.equal(model.getDocument().items[0].x, 40);
  model.beginGesture();
  assert.equal(model.commitGesture(), false);
  assert.equal(model.edit(() => {}), false);
  assert.throws(() => model.edit((draft) => { draft.events = []; }));
  assert.equal(model.getState().canRedo, true);
  model.edit((draft) => { draft.items.reverse(); draft.items[0].locked = false; });
  assert.equal(model.getState().canRedo, false);
});

test('history is bounded to 100 edits; reset clears both history and active gesture', async () => {
  const [{ createSceneDocumentModel }] = await modules;
  const model = createSceneDocumentModel(fixture());
  for (let index = 1; index <= 105; index += 1) model.edit((draft) => { draft.title = `版本${index}`; });
  let undoCount = 0;
  while (model.undo()) undoCount += 1;
  assert.equal(undoCount, 100);
  assert.equal(model.getDocument().title, '版本5');
  model.beginGesture();
  const replacement = fixture();
  model.reset(replacement);
  assert.deepEqual(plain(model.getDocument()), replacement);
  assert.deepEqual(plain(model.getState()), { canUndo: false, canRedo: false });
  assert.equal(model.cancelGesture(), false);
  assert.throws(() => model.updateGesture(() => {}));
});

test('bounded group move preserves spacing, ignores locked and absent IDs and leaves input unchanged', async () => {
  const [{ moveSceneItems }] = await modules;
  const document = fixture();
  const original = plain(document);
  const ids = [...document.items.map((item) => item.id), randomUUID()];
  const right = moveSceneItems(document, ids, 900, 900);
  assert.deepEqual(plain(right.items.map(({ x, y }) => [x, y])), [[440, 388], [600, 500], [600, 400]]);
  const left = moveSceneItems(document, ids, -900, -900);
  assert.deepEqual(plain(left.items.map(({ x, y }) => [x, y])), [[0, 0], [160, 112], [600, 400]]);
  assert.deepEqual(document, original);
  assert.deepEqual(plain(moveSceneItems(document, [], 20, 30)), original);
  assert.throws(() => moveSceneItems(document, ids, Infinity, 0));
});

test('8px snap moves the group anchor without changing relative offsets; canvas bounds win', async () => {
  const [{ moveSceneItems, snapSceneCoordinate }] = await modules;
  const document = fixture();
  document.items[0].x = 43;
  const ids = document.items.map((item) => item.id);
  const snapped = moveSceneItems(document, ids, 10, 13, { snap: true });
  assert.equal(snapped.items[0].x, 56);
  assert.equal(snapped.items[0].y, 64);
  assert.equal(snapped.items[1].x - snapped.items[0].x, 157);
  assert.equal(snapSceneCoordinate(13), 16);
  const bounded = moveSceneItems(document, ids, 1000, 0, { snap: true });
  assert.equal(bounded.items[1].x + bounded.items[1].width, 800);
  assert.throws(() => snapSceneCoordinate(NaN));
});

test('six alignments use unlocked selection bounds; single item aligns to canvas', async () => {
  const [{ alignSceneItems }] = await modules;
  const document = fixture();
  const ids = document.items.map((item) => item.id);
  for (const [alignment, axis, expected] of [
    ['left', 'x', [40, 40]], ['right', 'x', [300, 200]], ['top', 'y', [48, 48]],
    ['bottom', 'y', [200, 160]], ['center-x', 'x', [170, 120]], ['center-y', 'y', [124, 104]],
  ]) {
    const result = alignSceneItems(document, ids, alignment);
    assert.deepEqual(plain(result.items.slice(0, 2).map((item) => item[axis])), expected);
    assert.deepEqual(plain(result.items[2]), document.items[2]);
  }
  assert.equal(alignSceneItems(document, [ids[0]], 'center-x').items[0].x, 350);
  assert.equal(alignSceneItems(document, [ids[0]], 'bottom').items[0].y, 540);
  assert.deepEqual(plain(alignSceneItems(document, [ids[2]], 'left')), document);
  assert.throws(() => alignSceneItems(document, ids, 'unknown'));
});

test('display validation rejects malformed geometry, identity, schema and unknown fields', async () => {
  const [, { validateSceneDocument }] = await modules;
  const mutations = [
    (draft) => { draft.schemaVersion = 2; }, (draft) => { draft.canvas.width = 319; },
    (draft) => { draft.canvas.height = 8000; }, (draft) => { draft.canvas.zoom = 1; },
    (draft) => { draft.items[0].width = 31; }, (draft) => { draft.items[0].x = NaN; },
    (draft) => { draft.items[0].x = 799; }, (draft) => { draft.items[0].visible = 1; },
    (draft) => { draft.items[0].type = 'gifts'; }, (draft) => { draft.items[0].id = 'bad'; },
    (draft) => { draft.items[1].id = draft.items[0].id.toUpperCase(); },
    (draft) => { draft.items[0].selected = true; }, (draft) => { draft.extra = false; },
    (draft) => { draft.items[0].appearance.config = {}; },
    (draft) => { draft.items = Array.from({ length: 33 }, () => ({ ...draft.items[0], id: randomUUID() })); },
    (draft) => { draft.title = ' '; }, (draft) => { draft.title = '字'.repeat(81); },
  ];
  for (const mutate of mutations) {
    const document = fixture();
    mutate(document);
    assert.throws(() => validateSceneDocument(document));
  }
  const empty = fixture();
  empty.items = [];
  assert.deepEqual(plain(validateSceneDocument(empty)), empty);
});

test('template rejects nested secrets, business data, prototype tricks and non-JSON values without executing getters', async () => {
  const [, { exportSceneTemplate, importSceneTemplate }] = await modules;
  for (const config of [{ token: 'abc' }, { nested: { events: [] } }, { streamerId: '123' },
    { queue: [] }, { source: '/scene#token=abc' }, { path: '/image?access_token=abc' },
    { fn() {} }, { created: new Date() }, { missing: undefined }, { bad: Infinity },
    JSON.parse('{"__proto__":{"polluted":true}}')]) {
    const document = fixture();
    document.items[2].appearance.config = config;
    assert.throws(() => exportSceneTemplate(document));
  }
  const document = fixture();
  let getterCalls = 0;
  Object.defineProperty(document, 'title', { enumerable: true, get() { getterCalls += 1; return '陷阱'; } });
  assert.throws(() => exportSceneTemplate(document));
  assert.equal(getterCalls, 0);
  const cyclic = fixture();
  cyclic.items[2].appearance.config.circular = cyclic;
  assert.throws(() => exportSceneTemplate(cyclic));
  assert.throws(() => importSceneTemplate('{broken'));
  assert.equal({}.polluted, undefined);
});

test('template size cap counts UTF-8 bytes and config normalization remains server-owned', async () => {
  const [, { exportSceneTemplate }] = await modules;
  const document = fixture();
  document.items[2].appearance.config = { displayOnlyFutureOption: { shade: 'new' } };
  assert.equal(JSON.parse(exportSceneTemplate(document)).items[2].appearance.config.displayOnlyFutureOption.shade, 'new');
  document.items[2].appearance.config.caption = '汉'.repeat(90000);
  assert.throws(() => exportSceneTemplate(document));
});

test('template import regenerates identities and requires explicit font, media and logical-source bindings', async () => {
  const [, { exportSceneTemplate, importSceneTemplate }] = await modules;
  const document = fixture();
  document.items[1].appearance = { mode: 'independent', config: { overlayFontFamily: '本机字体' } };
  document.items[2].appearance.config.path = 'D:/assets/background.png';
  document.items.push({ ...document.items[0], id: randomUUID(), type: 'danmaku', name: '弹幕' });
  const pending = importSceneTemplate(exportSceneTemplate(document));
  assert.notEqual(pending.document.id, document.id);
  assert.equal(new Set([pending.document.id, ...pending.document.items.map((item) => item.id)]).size, 5);
  for (let index = 0; index < document.items.length; index += 1) {
    assert.notEqual(pending.document.items[index].id, document.items[index].id);
  }
  assert.deepEqual(plain(pending.bindings.map(({ kind, source }) => [kind, source])), [
    ['source', 'default'], ['font', '本机字体'], ['source', 'queue'],
    ['media', 'D:/assets/background.png'], ['source', 'overtime'], ['source', 'default'], ['source', 'danmaku'],
  ]);
  assert.throws(() => pending.resolve({}));
  const resolutions = Object.fromEntries(pending.bindings.map((binding) => [binding.id, {
    confirmed: true, value: binding.kind === 'font' ? 'Arial' : binding.kind === 'media' ? '' : binding.source,
  }]));
  pending.document.title = '不能修改内部导入快照';
  pending.bindings[0].source = 'forged';
  const resolved = pending.resolve(resolutions);
  assert.equal(resolved.title, '场景');
  assert.equal(resolved.items[1].appearance.config.overlayFontFamily, 'Arial');
  assert.equal(resolved.items[2].appearance.config.path, '');
  resolutions['binding-1'].confirmed = false;
  assert.throws(() => pending.resolve(resolutions));
  resolutions['binding-1'] = { confirmed: true, value: 'another-account' };
  assert.throws(() => pending.resolve(resolutions));
  assert.equal(document.items[1].appearance.config.overlayFontFamily, '本机字体');
});

test('resource resolution is atomic and revalidates credentials; generated IDs cannot reuse identities', async () => {
  const [, { importSceneTemplate }] = await modules;
  const document = fixture();
  document.items[2].appearance.config.path = 'old.png';
  const pending = importSceneTemplate(document);
  const resolutions = Object.fromEntries(pending.bindings.map((binding) => [binding.id, {
    confirmed: true, value: binding.kind === 'media' ? '/asset#token=secret' : binding.source,
  }]));
  assert.throws(() => pending.resolve(resolutions));
  const media = pending.bindings.find((binding) => binding.kind === 'media');
  resolutions[media.id].value = 'new.png';
  assert.equal(pending.resolve(resolutions).items[2].appearance.config.path, 'new.png');
  assert.equal(pending.document.items[2].appearance.config.path, 'old.png');
  assert.throws(() => importSceneTemplate(document, { createId: () => document.id }));
  const repeated = randomUUID();
  assert.throws(() => importSceneTemplate(document, { createId: () => repeated }));
});
