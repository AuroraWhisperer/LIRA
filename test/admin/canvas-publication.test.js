'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { getClockConfig } = require('../../src/server/clock-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
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
    if (action === 'save') current = { ...current, document: plain(body.document), revision: current.revision + 1 };
    if (action === 'publish') current.publishedVersion++;
    return plain(current);
  } };
}

test('canvas session preserves version conflict through edits and discard reloads the owning revision', async () => {
  const { prepareComponentPreviewCanvas } = await load('admin/component-preview-canvas-controller.js');
  for (const failedAction of ['save', 'publish']) {
    const original = documentOf();
    const remote = { ...original, title: 'Changed elsewhere' };
    let conflict = true;
    let resolveRead;
    const calls = [];
    const request = async (action, body) => {
      calls.push({ action, body });
      if (action === 'list') return [{ document: original, revision: 1, publishedVersion: 0 }];
      if (action === 'document') return new Promise(resolve => { resolveRead = resolve; });
      if (conflict && action === failedAction) throw Object.assign(new Error('stale'), { status: 409 });
      return { document: body?.document || remote, revision: 8, publishedVersion: 2 };
    };
    const canvas = await prepareComponentPreviewCanvas([], request);
    const states = [];
    const stop = canvas.controller.subscribe(state => states.push(state));
    if (failedAction === 'save') canvas.controller.edit({ document: { ...original, title: 'Local' } });
    await assert.rejects(canvas.publish(), /场景已在其他入口更新/);
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

test('A01: independent clock publication ignores an unused unloaded component', async () => {
  const { createComponentConfigController: create } = await load('admin/component-config-controller.js');
  const { prepareComponentPreviewCanvas: prepare } = await load('admin/component-preview-canvas-controller.js');
  const unused = create({ initial: {}, read: async () => { throw new Error('offline'); } });
  await unused.reload();
  const f = sceneRequest(documentOf());
  const canvas = await prepare([{ id: 'danmaku', controller: unused }, { id: 'clock', controller: create({ initial: clockConfig }) }], f.request);
  assert.equal((await canvas.publish()).publishedVersion, 1);
  assert.deepEqual(f.calls.map(call => call.action), ['list', 'publish']);
});

test('A01: independent clock publication preserves an unrelated queue draft', async () => {
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

test('A02: concurrent work on an earlier owner stops publication after the batch', async () => {
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
  assert.equal(f.calls.some(call => call.action === 'publish'), false);
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
    assert.equal(f.calls.some(call => call.action === 'publish'), false);
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
    assert.equal(f.calls.some(call => call.action === 'publish'), false);
  }
});

test('edits after dispatch stay as drafts without invalidating the submitted publication', async () => {
  const { createComponentConfigController: create } = await load('admin/component-config-controller.js');
  const { prepareComponentPreviewCanvas: prepare } = await load('admin/component-preview-canvas-controller.js');
  const clock = create({ initial: clockConfig });
  const f = sceneRequest(documentOf([item('clock', 'shared')]));
  const canvas = await prepare([{ id: 'clock', controller: clock }], async (action, body) => {
    if (action === 'publish') clock.edit({ label: 'next publication' });
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
