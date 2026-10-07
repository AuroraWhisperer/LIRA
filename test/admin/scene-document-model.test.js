'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { SCENE_TYPES, SHARED_SCENE_TYPES } = require('../../src/shared/scene-component-types');
const { normalizeSceneDocument } = require('../../src/scenes/scene-contract');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');

const plain = (value) => JSON.parse(JSON.stringify(value));
const admin = path.join(__dirname, '../../public/js/admin');
const modules = Promise.all(['scene-document-model.js', 'scene-template.js'].map((file) =>
  loadModuleExports(path.join(admin, file), { TextEncoder, URL, crypto: { randomUUID } })));

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

test('shared canvas resizing scales equal ratios and retains visible layers after aspect-ratio changes', async () => {
  const [{ resizeSceneCanvas }] = await modules;
  const document = fixture();
  const scaled = resizeSceneCanvas(document, { width: 1600, height: 1200 });
  assert.deepEqual(plain(scaled.items.map(({ x, y, width, height }) => ({ x, y, width, height }))),
    document.items.map(({ x, y, width, height }) => ({ x: x * 2, y: y * 2, width: width * 2, height: height * 2 })));
  const portrait = resizeSceneCanvas(scaled, { width: 400, height: 800 });
  for (const item of portrait.items) {
    assert.ok(item.x + item.width >= 24 && item.y + item.height >= 24 && item.x <= 376 && item.y <= 776);
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
  let snapshot;
  const stopSnapshot = model.subscribeSnapshot((_state, value) => { snapshot = value; });
  const originalSnapshot = snapshot;
  assert.equal(snapshot, model.getSnapshot());
  assert.equal(Object.isFrozen(snapshot.items[0]), true);
  model.edit((draft) => { captured = draft; draft.title = '修改'; });
  assert.equal(snapshot, model.getSnapshot());
  assert.notEqual(snapshot, originalSnapshot);
  assert.equal(originalSnapshot.title, '场景');
  captured.items[0].x = 600;
  const copy = model.getDocument();
  copy.items[0].x = 300;
  assert.equal(model.getDocument().items[0].x, 40);
  assert.equal(model.getState().canUndo, true);
  assert.equal(notices, 2);
  unsubscribe();
  stopSnapshot();
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
  assert.deepEqual(plain(model.getDocument().items[3]), { ...shared, width: 400, height: 200 });
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

test('resizing anchors opposite edges, permits overflow and respects size limits, locks and automatic heights', async () => {
  const [{ resizeSceneItem }] = await modules;
  const document = fixture();
  const item = document.items[0];
  item.type = 'danmaku';
  const geometry = ({ x, y, width, height }) => ({ x, y, width, height });
  const expected = {
    n: [40, 64, 100, 44], e: [40, 48, 124, 60], s: [40, 48, 100, 76], w: [64, 48, 76, 60],
    ne: [40, 64, 124, 44], se: [40, 48, 124, 76], sw: [64, 48, 76, 76], nw: [64, 64, 76, 44],
  };
  for (const [handle, [x, y, width, height]] of Object.entries(expected)) {
    assert.deepEqual(geometry(resizeSceneItem(document, item.id, handle, 24, 16).items[0]), { x, y, width, height });
  }
  assert.deepEqual(geometry(resizeSceneItem(document, item.id, 'nw', -1000, -1000).items[0]),
    { x: -660, y: -492, width: 800, height: 600 });
  assert.deepEqual(geometry(resizeSceneItem(document, item.id, 'nw', 1000, 1000).items[0]),
    { x: 108, y: 76, width: 32, height: 32 });
  assert.deepEqual(geometry(resizeSceneItem(document, item.id, 'se', 1000, 1000).items[0]),
    { x: 40, y: 48, width: 800, height: 600 });
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

test('clock and queue resize handles scale both dimensions and preserve the opposite anchor', async () => {
  const [{ resizeSceneItem }] = await modules;
  const document = fixture();
  for (const item of document.items.slice(0, 2)) {
    for (const handle of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
      const resized = resizeSceneItem(document, item.id, handle, 24, 16).items.find(entry => entry.id === item.id);
      assert.ok(Math.abs(resized.width / resized.height - item.width / item.height) < 0.02, handle);
      assert.equal(handle.includes('w') ? resized.x + resized.width : resized.x,
        handle.includes('w') ? item.x + item.width : item.x);
      assert.equal(handle.includes('n') ? resized.y + resized.height : resized.y,
        handle.includes('n') ? item.y + item.height : item.y);
    }
  }
});

test('cancel, unchanged gestures and failed edits preserve redo; real edits invalidate it', async () => {
  const [{ createSceneDocumentModel }] = await modules;
  const model = createSceneDocumentModel(fixture());
  model.edit((draft) => { draft.title = '后续'; });
  model.undo();
  model.beginGesture();
  model.updateGesture((draft) => { draft.items[0].x = 80; });
  assert.throws(() => model.updateGesture((draft) => { draft.items[0].x = -77; }));
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
  assert.deepEqual(plain(right.items.map(({ x, y }) => [x, y])), [[616, 464], [776, 576], [600, 400]]);
  const left = moveSceneItems(document, ids, -900, -900);
  assert.deepEqual(plain(left.items.map(({ x, y }) => [x, y])), [[-76, -36], [84, 76], [600, 400]]);
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
  assert.equal(bounded.items[1].x, 776);
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

// Browser-source template cases load with URL available for capability URL validation.
const loadWithUrl = (file) => loadModuleExports(path.resolve(__dirname, '../../public/js', file), { TextEncoder, URL });
const browserUrl = 'https://source.example.test/overlay?access_token=private#secret=fragment';
const browserDocument = () => ({ schemaVersion: 1, id: randomUUID(), title: '浏览器模板', canvas: { width: 1920, height: 1080 },
  items: [{ id: randomUUID(), type: 'browser', name: '外部来源', x: 10, y: 20, width: 400, height: 300,
    visible: true, locked: false, appearance: { mode: 'independent', config: { url: browserUrl, viewportWidth: 800, viewportHeight: 600 } } }] });

test('only browser config URL permits provider capabilities and an empty URL is an editable draft', async () => {
  const { validateSceneDocument } = await loadWithUrl('admin/scene-template.js');
  assert.equal(validateSceneDocument(browserDocument()).items[0].appearance.config.url, browserUrl);
  const missing = browserDocument(); missing.items[0].appearance.config.url = '';
  assert.equal(validateSceneDocument(missing).items[0].appearance.config.url, '');
  for (const mutate of [
    (value) => { value.items[0].type = 'clock'; },
    (value) => { value.items[0].name = browserUrl; },
    (value) => { value.items[0].appearance.config.token = 'private'; },
    (value) => { value.items[0].appearance.config.url = 'javascript:alert(1)'; },
    (value) => { value.items[0].appearance = { mode: 'shared' }; },
  ]) {
    const value = browserDocument(); mutate(value); assert.throws(() => validateSceneDocument(value));
  }
});

test('export and import remove browser URLs and require an explicit valid replacement without leaking bindings', async () => {
  const { exportSceneTemplate, importSceneTemplate } = await loadWithUrl('admin/scene-template.js');
  const original = browserDocument();
  const serialized = exportSceneTemplate(original);
  assert.doesNotMatch(serialized, /source\.example|access_token|private|fragment/);
  assert.equal(original.items[0].appearance.config.url, browserUrl);
  const pending = importSceneTemplate(original, { createId: randomUUID });
  assert.doesNotMatch(JSON.stringify(pending), /source\.example|access_token|private|fragment/);
  assert.notEqual(pending.document.id, original.id);
  assert.deepEqual(plain(pending.bindings.map(({ kind, source }) => [kind, source])), [['browser-url', '']]);
  const binding = pending.bindings[0].id;
  for (const resolution of [{ confirmed: false, value: browserUrl }, { confirmed: true, value: '' }, { confirmed: true, value: 'file:///private' }]) {
    assert.throws(() => pending.resolve({ [binding]: resolution }));
  }
  const resolved = pending.resolve({ [binding]: { confirmed: true, value: browserUrl } });
  assert.equal(resolved.items[0].appearance.config.url, browserUrl);
  assert.equal(pending.document.items[0].appearance.config.url, '');
});

test('moving and resizing browser layers keeps their webpage viewport unchanged', async () => {
  const { resizeSceneItem, moveSceneItems } = await loadWithUrl('admin/scene-document-model.js');
  const initial = browserDocument();
  const id = initial.items[0].id;
  const resized = resizeSceneItem(initial, id, 'se', 160, 80);
  const moved = moveSceneItems(resized, [id], 40, 30);
  assert.deepEqual(plain(moved.items[0].appearance.config), initial.items[0].appearance.config);
  assert.deepEqual([moved.items[0].x, moved.items[0].y, moved.items[0].width, moved.items[0].height], [50, 50, 560, 380]);
});

function overflowScene(type = 'queue') {
  return { schemaVersion: 1, id: randomUUID(), title: '越界布局', canvas: { width: 800, height: 600 },
    items: [{ id: randomUUID(), type, name: type, x: 100, y: 100, width: 320, height: 180,
      visible: true, locked: false, appearance: SHARED_SCENE_TYPES.includes(type) ? { mode: 'shared' }
        : { mode: 'independent', config: type === 'browser'
          ? { url: 'https://example.com/', viewportWidth: 800, viewportHeight: 600 }
          : type === 'text-box' ? createTextBoxDefaults() : {} } }] };
}

test('every component can cross every edge and corner; frontend and backend enforce the same visible minimum', async () => {
  const [{ moveSceneItems }, { validateSceneDocument }] = await modules;
  for (const type of SCENE_TYPES) {
    const document = overflowScene(type);
    for (const [dx, dy, x, y] of [
      [-2000, 0, -296, 104], [2000, 0, 776, 104], [0, -2000, 104, -156], [0, 2000, 104, 576],
      [-2000, -2000, -296, -156], [2000, -2000, 776, -156],
      [-2000, 2000, -296, 576], [2000, 2000, 776, 576],
    ]) {
      const moved = plain(moveSceneItems(document, [document.items[0].id], dx, dy, { snap: true }));
      assert.deepEqual([moved.items[0].x, moved.items[0].y], [x, y], type);
      assert.deepEqual(plain(validateSceneDocument(moved)), moved);
      assert.deepEqual(normalizeSceneDocument(moved, { normalizeConfig: (_type, config) => config }), moved);
    }
    for (const geometry of [{ x: -297 }, { x: 777 }, { y: -157 }, { y: 577 }, { width: 801 }, { height: 601 }]) {
      const invalid = { ...document, items: [{ ...document.items[0], ...geometry }] };
      assert.throws(() => validateSceneDocument(invalid), type);
      assert.throws(() => normalizeSceneDocument(invalid, { normalizeConfig: (_type, config) => config }),
        { code: 'SCENE_INVALID_DOCUMENT' }, type);
    }
  }
});

test('resizing partially outside layers preserves anchors and enough visible area', async () => {
  const [{ resizeSceneItem }, { validateSceneDocument }] = await modules;
  for (const type of ['queue', 'clock', 'overtime']) {
    for (const [x, y] of [[-296, -156], [776, 576]]) {
      const document = overflowScene(type);
      Object.assign(document.items[0], { x, y });
      for (const handle of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
        for (const delta of [-2000, 2000]) {
          const resized = resizeSceneItem(document, document.items[0].id, handle, delta, delta, { snap: true });
          assert.doesNotThrow(() => validateSceneDocument(resized), `${type} ${handle} ${delta}`);
          const item = resized.items[0];
          assert.equal(handle.includes('w') ? item.x + item.width : item.x,
            handle.includes('w') ? x + 320 : x);
          assert.equal(handle.includes('n') ? item.y + item.height : item.y,
            handle.includes('n') ? y + 180 : y);
        }
      }
    }
  }
});

test('canvas resize, shared size updates, automatic height and undo preserve partial overflow', async () => {
  const [{ createSceneDocumentModel, resizeSceneCanvas, alignSceneItems }, { validateSceneDocument }] = await modules;
  const document = overflowScene();
  Object.assign(document.items[0], { x: -296, y: -156 });
  document.items.push({ ...document.items[0], id: randomUUID(), x: 776, y: 576 });
  const scaled = resizeSceneCanvas(document, { width: 1600, height: 1200 });
  assert.deepEqual(plain(scaled.items.map(item => [item.x, item.y])), [[-592, -312], [1552, 1152]]);
  const model = createSceneDocumentModel(document);
  model.edit(draft => { draft.items[0].width = 100; draft.items[0].height = 60; }, { recordHistory: false });
  assert.deepEqual(plain(model.getDocument().items.map(item => [item.x, item.y])), [[-76, -36], [776, 576]]);
  model.edit(draft => { draft.items[0].x += 8; });
  model.undo();
  assert.equal(model.getDocument().items[0].x, -76);
  for (const alignment of ['left', 'right', 'top', 'bottom', 'center-x', 'center-y']) {
    assert.doesNotThrow(() => validateSceneDocument(alignSceneItems(document, document.items.map(item => item.id), alignment)));
  }
});
