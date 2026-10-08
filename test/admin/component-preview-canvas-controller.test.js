'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { getClockConfig } = require('../../src/server/clock-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');

const admin = path.join(__dirname, '../../public/js/admin');
const modules = Promise.all(['component-preview-canvas-controller.js', 'component-config-controller.js'].map((file) =>
  loadModuleExports(path.join(admin, file), { TextEncoder, queueMicrotask })));
const copy = (value) => JSON.parse(JSON.stringify(value));

async function fixture(records = [], read) {
  const [{ prepareComponentPreviewCanvas }, { createComponentConfigController }] = await modules;
  const controller = createComponentConfigController({ initial: { layout: { canvas: { width: 2560, height: 1440 } } }, read });
  const components = [{ id: 'danmaku', controller }];
  const calls = [];
  let conflict = false;
  let binding;
  const request = async (action, body, id) => {
    calls.push({ action, body: copy(body || {}) });
    if (action === 'list') return copy(records);
    if (action === 'canvas') return copy(binding ||= { outputId: records[0].document.id,
      activeSceneId: records[0].document.id, publishedVersion: records[0].publishedVersion || 0 });
    if (action === 'document') return copy(records.find(({ document }) => document.id === id));
    if (action === 'source') return { id, token: 'a'.repeat(64) };
    if (action === 'create') {
      const dto = { document: { schemaVersion: 1, id: randomUUID(), ...body, items: [] }, revision: 1 };
      records.push(dto);
      return copy(dto);
    }
    if (conflict) throw Object.assign(new Error('场景已更新，请重新加载后重试。'), { status: 409 });
    const current = records.find(({ document }) => document.id === body.id);
    assert.equal(body.expectedRevision, current.revision);
    if (action === 'delete') {
      records.splice(records.indexOf(current), 1);
      return { id: body.id };
    }
    if (action === 'canvas-publish') {
      assert.equal(body.expectedPublishedVersion, binding.publishedVersion);
      binding.publishedVersion += 1;
      binding.activeSceneId = current.document.id;
      return { publishedVersion: binding.publishedVersion };
    }
    current.document = copy(body.document);
    current.revision += 1;
    return copy(current);
  };
  return { calls, records, components, prepare: () => prepareComponentPreviewCanvas(components, request),
    conflict: () => { conflict = true; }, request };
}

test('preset selection retains drafts and applies the selected document to the fixed output', async () => {
  const f = await fixture();
  const canvas = await f.prepare();
  const original = canvas.controller.getState().draft.document;
  canvas.controller.edit({ document: { ...original, title: '未保存的原预设' } });
  await canvas.preset({ action: 'create', title: '游戏预设', duplicate: false });
  const second = canvas.controller.getState().draft.document.id;
  assert.notEqual(second, original.id);
  assert.equal(canvas.controller.getState().presets.length, 2);
  await canvas.preset({ action: 'select', id: original.id });
  assert.equal(canvas.controller.getState().draft.document.title, '未保存的原预设');
  assert.equal(canvas.controller.getState().dirty, true);
  await canvas.preset({ action: 'select', id: second });
  await canvas.publish();
  assert.equal((await canvas.source()).id, original.id);
  assert.equal(canvas.controller.getState().activeSceneId, second);
  assert.equal(f.records[0].document.title, original.title);
  assert.equal(f.records[1].document.title, '游戏预设');
  const writes = f.calls.length;
  await assert.rejects(canvas.preset({ action: 'select', id: randomUUID() }), /不存在/);
  assert.equal(f.calls.length, writes);
});

test('preset deletion retains other drafts and keeps the selected draft on failure', async () => {
  const f = await fixture();
  const canvas = await f.prepare();
  const original = canvas.controller.getState().draft.document;
  canvas.controller.edit({ document: { ...original, title: '保留草稿' } });
  await canvas.preset({ action: 'create', title: '多余预设', duplicate: false });
  const extra = canvas.controller.getState().draft.document;
  await assert.rejects(canvas.preset({ action: 'delete', id: original.id }), /当前场景已变化/);
  await canvas.preset({ action: 'delete', id: extra.id });
  assert.equal(canvas.controller.getState().draft.document.id, original.id);
  assert.equal(canvas.controller.getState().draft.document.title, '保留草稿');
  assert.equal(canvas.controller.getState().dirty, true);
  assert.equal(canvas.controller.getState().presets.length, 1);
  assert.equal(f.records.length, 1);
  await canvas.preset({ action: 'create', title: '保留失败草稿', duplicate: false });
  const failed = canvas.controller.getState().draft.document;
  canvas.controller.edit({ document: { ...failed, title: '未保存修改' } });
  f.conflict();
  await assert.rejects(canvas.preset({ action: 'delete', id: failed.id }), /已更新/);
  assert.equal(canvas.controller.getState().draft.document.title, '未保存修改');
  assert.equal(canvas.controller.getState().presets.length, 2);
});

test('common canvas uses the prior danmaku size once and shares initialization across preview openings', async () => {
  const f = await fixture();
  const [first, second] = await Promise.all([f.prepare(), f.prepare()]);
  assert.equal(first, second);
  assert.deepEqual(f.calls.map(({ action }) => action), ['list', 'create', 'canvas']);
  assert.deepEqual(copy(first.controller.getState().draft.document.canvas), { width: 2560, height: 1440 });
  const document = copy(first.controller.getState().draft.document);
  document.canvas = { width: 1280, height: 720 };
  first.controller.edit({ document });
  assert.equal(await first.controller.save(), true);
  assert.equal(f.records[0].document.canvas.width, 1280);
  const reopened = await (await fixture(copy(f.records))).prepare();
  assert.equal(reopened.controller.getState().draft.document.canvas.width, 1280);
});

test('existing scene geometry is retained and saves stay bound to its scene identity', async () => {
  const f = await fixture([{ document: { schemaVersion: 1, id: randomUUID(), title: '保留的画布',
    canvas: { width: 1080, height: 1920 }, items: [] }, revision: 7 }]);
  const { controller } = await f.prepare();
  assert.deepEqual(f.calls.map(({ action }) => action), ['list', 'canvas']);
  const document = copy(controller.getState().draft.document);
  document.id = randomUUID();
  controller.edit({ document });
  assert.equal(await controller.save(), false);
  assert.match(controller.getState().error, /标识不匹配/);
  assert.equal(f.calls.length, 2);
});

test('existing canvas opens without waiting for unrelated danmaku settings', async () => {
  let finish;
  const f = await fixture([{ document: { schemaVersion: 1, id: randomUUID(), title: 'Existing canvas',
    canvas: { width: 1920, height: 1080 }, items: [] }, revision: 1 }], () => new Promise(resolve => { finish = resolve; }));
  const loading = f.components[0].controller.reload();
  let opened = false;
  const preparing = f.prepare().then(canvas => { opened = true; return canvas; });
  await new Promise(resolve => setImmediate(resolve));
  const openedWhileLoading = opened;
  finish({ layout: { canvas: { width: 2560, height: 1440 } } });
  await loading;
  const canvas = await preparing;
  assert.equal(openedWhileLoading, true);
  assert.deepEqual(f.calls.map(({ action }) => action), ['list', 'canvas']);
  assert.equal(canvas.controller.getState().draft.document.canvas.width, 1920);
});

test('first canvas waits for danmaku dimensions once and rejects an owner change before creation', async () => {
  for (const reset of [false, true]) {
    let finish;
    const f = await fixture([], () => new Promise(resolve => { finish = resolve; }));
    const owner = f.components[0].controller;
    const loading = owner.reload();
    const preparing = Promise.all([f.prepare(), f.prepare()]);
    const rejected = reset ? assert.rejects(preparing, /来源已变化/) : null;
    await new Promise(resolve => setImmediate(resolve));
    const whileLoading = f.calls.map(({ action }) => action);
    if (reset) owner.reset();
    finish({ layout: { canvas: { width: 3840, height: 2160 } } });
    await loading;
    if (reset) {
      await rejected;
      assert.equal(f.calls.some(({ action }) => action === 'create'), false);
    } else {
      const [first, second] = await preparing;
      assert.equal(first, second);
      assert.deepEqual(f.calls.map(({ action }) => action), ['list', 'create', 'canvas']);
      assert.equal(first.controller.getState().draft.document.canvas.width, 3840);
    }
    assert.deepEqual(whileLoading, ['list']);
  }
});

test('revision failures preserve canvas drafts and an old owner cannot save after reset', async () => {
  const f = await fixture();
  const { controller } = await f.prepare();
  const document = copy(controller.getState().draft.document);
  document.canvas.width = 2000;
  controller.edit({ document });
  f.conflict();
  assert.equal(await controller.save(), false);
  assert.equal(controller.getState().draft.document.canvas.width, 2000);
  assert.equal(controller.getState().dirty, true);
  f.records[0].document.canvas.width = 2300;
  controller.discard();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.getState().draft.document.canvas.width, 2300);
  controller.edit({ document });
  f.components[0].controller.reset();
  const writes = f.calls.length;
  assert.equal(await controller.save(), false);
  assert.equal(f.calls.length, writes);
  assert.match(controller.getState().error, /来源已变化/);
});

test('canvas applies saved drafts and reuses one bound output capability across publications', async () => {
  const f = await fixture();
  const canvas = await f.prepare();
  await assert.rejects(canvas.source(), /先保存并应用/);
  const document = copy(canvas.controller.getState().draft.document);
  document.canvas = { width: 2000, height: 1200 };
  canvas.controller.edit({ document });
  assert.equal((await canvas.publish()).publishedVersion, 1);
  assert.deepEqual(f.calls.slice(-2).map(call => call.action), ['save', 'canvas-publish']);
  assert.equal(canvas.controller.getState().dirty, false);
  const first = await canvas.source();
  assert.equal(first.id, document.id);
  assert.equal((await canvas.publish()).publishedVersion, 2);
  assert.deepEqual(await canvas.source(), first);
  assert.equal(JSON.stringify(canvas.controller.getState()).includes(first.token), false);
  f.components[0].controller.reset();
  await assert.rejects(canvas.publish(), /来源已变化/);
  await assert.rejects(canvas.source(), /来源已变化/);
});

const entry = file => path.resolve(__dirname, '../../public/js', file);
const load = (file, globals = {}) => loadModuleExports(entry(file), { TextEncoder, queueMicrotask, structuredClone, ...globals });
const plain = value => JSON.parse(JSON.stringify(value));
const clockConfig = getClockConfig(DEFAULT_SETTINGS);
function item(type = 'clock', mode = 'independent', config = clockConfig) {
  return { id: randomUUID(), type, name: type, x: 0, y: 0, width: 320, height: 180, visible: true, locked: false,
    appearance: mode === 'shared' ? { mode } : { mode, config } };
}
const documentOf = (items = [item()]) => ({ schemaVersion: 1, id: randomUUID(), title: 'Audit', canvas: { width: 1920, height: 1080 }, items });
function sceneRequest(document) {
  const calls = [];
  let current = { document, revision: 1, publishedVersion: 0 };
  return { calls, async request(action, body) {
    calls.push({ action, body: plain(body || {}) });
    if (action === 'list') return [plain(current)];
    if (action === 'canvas') return { outputId: current.document.id, activeSceneId: current.document.id,
      publishedVersion: current.publishedVersion };
    if (action === 'save') current = { ...current, document: plain(body.document), revision: current.revision + 1 };
    if (action === 'canvas-publish') current.publishedVersion++;
    return plain(current);
  } };
}

test('save and publication conflicts stop publication, keep drafts and discard reloads the owning revision', async () => {
  const { prepareComponentPreviewCanvas } = await load('admin/component-preview-canvas-controller.js');
  const { createComponentConfigController } = await load('admin/component-config-controller.js');
  for (const failedAction of ['save', 'canvas-publish']) {
    const original = documentOf();
    const remote = { ...original, title: 'Changed elsewhere' };
    let conflict = true;
    let resolveRead;
    const calls = [];
    const request = async (action, body) => {
      calls.push({ action, body });
      if (action === 'list') return [{ document: original, revision: 1, publishedVersion: 0 }];
      if (action === 'canvas') return { outputId: original.id, activeSceneId: original.id, publishedVersion: 0 };
      if (action === 'document') return new Promise(resolve => { resolveRead = resolve; });
      if (conflict && action === failedAction) throw Object.assign(new Error('stale'), { status: 409 });
      return { document: body?.document || remote, revision: 8, publishedVersion: 2 };
    };
    const canvas = await prepareComponentPreviewCanvas([{ id: 'clock', controller: createComponentConfigController({ initial: clockConfig }) }], request);
    const states = [];
    const stop = canvas.controller.subscribe(state => states.push(state));
    if (failedAction === 'save') canvas.controller.edit({ document: { ...original, title: 'Local' } });
    await assert.rejects(canvas.publish(), /场景已在其他入口更新/);
    if (failedAction === 'save') {
      assert.equal(calls.some(call => call.action === 'canvas-publish'), false);
      assert.equal(canvas.controller.getState().dirty, true);
    } else {
      assert.equal(canvas.controller.getState().dirty, false, 'an already saved draft stays clean');
      assert.match(canvas.controller.getState().error, /放弃修改/);
    }
    canvas.controller.edit({ document: { ...original, title: 'Still local' } });
    assert.match(states.at(-1).error, /场景已在其他入口更新/);
    assert.equal(states.at(-1).draft.document.title, 'Still local');
    assert.match(canvas.controller.getState().error, /场景已在其他入口更新/);
    assert.equal(canvas.controller.discard(), true);
    assert.equal(canvas.controller.getState().loading, true);
    resolveRead({ document: remote, revision: 7, publishedVersion: 1 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(states.at(-1).error, '');
    assert.equal(states.at(-1).dirty, false);
    assert.equal(states.at(-1).draft.document.title, remote.title);
    conflict = false;
    await canvas.publish();
    assert.equal(calls.at(-1).body.expectedRevision, 7);
    stop();
  }
});

test('independent clock publication ignores an unused unloaded component', async () => {
  const { createComponentConfigController: create } = await load('admin/component-config-controller.js');
  const { prepareComponentPreviewCanvas: prepare } = await load('admin/component-preview-canvas-controller.js');
  const unused = create({ initial: {}, read: async () => { throw new Error('offline'); } });
  await unused.reload();
  const f = sceneRequest(documentOf());
  const canvas = await prepare([{ id: 'danmaku', controller: unused }, { id: 'clock', controller: create({ initial: clockConfig }) }], f.request);
  assert.equal((await canvas.publish()).publishedVersion, 1);
  assert.deepEqual(f.calls.map(call => call.action), ['list', 'canvas', 'canvas-publish']);
});

test('independent clock publication preserves an unrelated queue draft', async () => {
  const { createComponentConfigController: create } = await load('admin/component-config-controller.js');
  const { prepareComponentPreviewCanvas: prepare } = await load('admin/component-preview-canvas-controller.js');
  let writes = 0;
  const queue = create({ initial: { overlayQueueStyle: 'classic' }, persist: async draft => { writes++; return draft; } });
  queue.edit({ overlayQueueStyle: 'storybook' });
  const f = sceneRequest(documentOf());
  const canvas = await prepare([{ id: 'clock', controller: create({ initial: clockConfig }) }, { id: 'queue', controller: queue }], f.request);
  await canvas.publish();
  assert.equal(writes, 0);
  assert.equal(queue.getState().dirty, true);
});

test('concurrent work on an earlier owner stops publication after the batch', async () => {
  const { createComponentConfigController: create } = await load('admin/component-config-controller.js');
  const { prepareComponentPreviewCanvas: prepare } = await load('admin/component-preview-canvas-controller.js');
  let finish;
  let entered;
  const saving = new Promise(resolve => { entered = resolve; });
  const clock = create({ initial: clockConfig, persist: async draft => draft });
  const queue = create({ initial: { overlayQueueStyle: 'classic' }, persist: async draft => {
    entered(); await new Promise(resolve => { finish = resolve; }); return draft;
  } });
  clock.edit({ label: 'first' });
  queue.edit({ overlayQueueStyle: 'storybook' });
  const f = sceneRequest(documentOf([item('clock', 'shared'), item('queue', 'shared')]));
  const canvas = await prepare([{ id: 'clock', controller: clock }, { id: 'queue', controller: queue }], f.request);
  const publication = canvas.publish();
  await saving;
  clock.edit({ label: 'later unsaved' });
  finish();
  await assert.rejects(publication, /仍有未保存修改/);
  assert.equal(clock.getState().dirty, true);
  assert.equal(f.calls.some(call => call.action === 'canvas-publish'), false);
  assert.equal(clock.getState().draft.label, 'later unsaved');
});

test('publication preflights every shared owner before saving any draft', async () => {
  const { createComponentConfigController: create } = await load('admin/component-config-controller.js');
  const { prepareComponentPreviewCanvas: prepare } = await load('admin/component-preview-canvas-controller.js');
  for (const missing of [false, true]) {
    let writes = 0;
    const clock = create({ initial: clockConfig, persist: async draft => { writes++; return draft; } });
    clock.edit({ label: 'pending' });
    const queue = create({ initial: {}, read: async () => { throw new Error('offline'); } });
    const f = sceneRequest(documentOf([item('clock', 'shared'), item('queue', 'shared')]));
    const entries = [{ id: 'clock', controller: clock }, ...(!missing ? [{ id: 'queue', controller: queue }] : [])];
    const canvas = await prepare(entries, f.request);
    await assert.rejects(canvas.publish(), /尚未读取完成|缺少共享组件/);
    assert.equal(writes, 0);
    assert.equal(f.calls.some(call => call.action === 'canvas-publish'), false);
  }
});

test('canvas edits and participant resets during another owner save stop publication', async () => {
  const { createComponentConfigController: create } = await load('admin/component-config-controller.js');
  const { prepareComponentPreviewCanvas: prepare } = await load('admin/component-preview-canvas-controller.js');
  for (const mutation of ['canvas', 'generation', 'failure']) {
    let finish;
    const clock = create({ initial: clockConfig, persist: draft => new Promise((resolve, reject) => {
      finish = () => mutation === 'failure' ? reject(new Error('save failed')) : resolve(draft);
    }) });
    clock.edit({ label: 'pending' });
    const f = sceneRequest(documentOf([item('clock', 'shared')]));
    const canvas = await prepare([{ id: 'clock', controller: clock }], f.request);
    const publication = canvas.publish();
    if (mutation === 'canvas') {
      const document = canvas.controller.getState().draft.document;
      document.items.push(item('queue', 'shared'));
      canvas.controller.edit({ document });
    }
    if (mutation === 'generation') clock.reset();
    finish();
    await assert.rejects(publication, /仍有未保存修改|来源已变化|save failed/);
    assert.equal(f.calls.some(call => call.action === 'canvas-publish'), false);
  }
});

test('edits after dispatch stay as drafts without invalidating the submitted publication', async () => {
  const { createComponentConfigController: create } = await load('admin/component-config-controller.js');
  const { prepareComponentPreviewCanvas: prepare } = await load('admin/component-preview-canvas-controller.js');
  const clock = create({ initial: clockConfig });
  const f = sceneRequest(documentOf([item('clock', 'shared')]));
  const canvas = await prepare([{ id: 'clock', controller: clock }], async (action, body) => {
    if (action === 'canvas-publish') clock.edit({ label: 'next publication' });
    return f.request(action, body);
  });
  assert.equal((await canvas.publish()).publishedVersion, 1);
  assert.equal(clock.getState().dirty, true);
});

test('publication uses the normalized canvas save result but rejects a later clean replacement', async () => {
  const { createComponentConfigController: create } = await load('admin/component-config-controller.js');
  const { prepareComponentPreviewCanvas: prepare } = await load('admin/component-preview-canvas-controller.js');
  for (const replace of [false, true]) {
    let finish;
    const clock = create({ initial: clockConfig, persist: draft => new Promise(resolve => { finish = () => resolve(draft); }) });
    clock.edit({ label: 'pending' });
    const f = sceneRequest(documentOf([item('clock', 'shared')]));
    const canvas = await prepare([{ id: 'clock', controller: clock }], (action, body) => {
      if (action === 'save') body.document.title = body.document.title.trim();
      return f.request(action, body);
    });
    const document = canvas.controller.getState().draft.document;
    document.title = ' normalized ';
    canvas.controller.edit({ document });
    const publication = canvas.publish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(canvas.controller.getState().saved.document.title, 'normalized');
    if (replace) {
      const next = canvas.controller.getState().saved.document;
      next.title = 'another clean document';
      canvas.controller.receive({ document: next });
    }
    finish();
    if (replace) await assert.rejects(publication, /场景已变化/);
    else assert.equal((await publication).publishedVersion, 1);
  }
});
