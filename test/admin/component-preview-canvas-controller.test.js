'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadModuleExports } = require('../helpers/frontend-modules');

const admin = path.join(__dirname, '../../public/js/admin');
const modules = Promise.all(['component-preview-canvas-controller.js', 'component-config-controller.js'].map((file) =>
  loadModuleExports(path.join(admin, file), { TextEncoder, queueMicrotask })));
const copy = (value) => JSON.parse(JSON.stringify(value));

async function fixture(records = []) {
  const [{ prepareComponentPreviewCanvas }, { createComponentConfigController }] = await modules;
  const controller = createComponentConfigController({ initial: { layout: { canvas: { width: 2560, height: 1440 } } } });
  const components = [{ id: 'danmaku', controller }];
  const calls = [];
  let conflict = false;
  const request = async (action, body, id) => {
    calls.push({ action, body: copy(body || {}) });
    if (action === 'list') return copy(records);
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
    if (action === 'publish') { current.publishedVersion = (current.publishedVersion || 0) + 1; return copy(current); }
    current.document = copy(body.document);
    current.revision += 1;
    return copy(current);
  };
  return { calls, records, components, prepare: () => prepareComponentPreviewCanvas(components, request),
    conflict: () => { conflict = true; }, request };
}

test('common canvas uses the prior danmaku size once and shares initialization across preview openings', async () => {
  const f = await fixture();
  const [first, second] = await Promise.all([f.prepare(), f.prepare()]);
  assert.equal(first, second);
  assert.deepEqual(f.calls.map(({ action }) => action), ['list', 'create']);
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
  assert.deepEqual(f.calls.map(({ action }) => action), ['list']);
  const document = copy(controller.getState().draft.document);
  document.id = randomUUID();
  controller.edit({ document });
  assert.equal(await controller.save(), false);
  assert.match(controller.getState().error, /标识不匹配/);
  assert.equal(f.calls.length, 1);
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
  assert.deepEqual(f.calls.slice(-2).map(call => call.action), ['save', 'publish']);
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

test('failed canvas save stops publication and preserves the editable draft', async () => {
  const f = await fixture();
  const canvas = await f.prepare();
  const document = copy(canvas.controller.getState().draft.document);
  document.canvas.width = 2200;
  canvas.controller.edit({ document });
  f.conflict();
  await assert.rejects(canvas.publish(), /其他入口更新/);
  assert.equal(f.calls.some(call => call.action === 'publish'), false);
  assert.equal(canvas.controller.getState().dirty, true);
});

test('publication revision conflicts can reload even when the local draft was already saved', async () => {
  const f = await fixture();
  const canvas = await f.prepare();
  await canvas.publish();
  f.records[0].document.canvas.width = 2300;
  f.conflict();
  await assert.rejects(canvas.publish(), /其他入口更新/);
  assert.equal(canvas.controller.getState().dirty, false);
  assert.match(canvas.controller.getState().error, /放弃修改/);
  canvas.controller.discard();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(canvas.controller.getState().draft.document.canvas.width, 2300);
  assert.equal(canvas.controller.getState().error, '');
});
