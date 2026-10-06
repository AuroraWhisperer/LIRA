'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadModuleExports } = require('../helpers/frontend-modules');

const load = (file) => loadModuleExports(path.resolve(__dirname, '../../public/js', file), { TextEncoder, URL });
const plain = (value) => JSON.parse(JSON.stringify(value));
const url = 'https://source.example.test/overlay?access_token=private#secret=fragment';
const document = () => ({ schemaVersion: 1, id: randomUUID(), title: '浏览器模板', canvas: { width: 1920, height: 1080 },
  items: [{ id: randomUUID(), type: 'browser', name: '外部来源', x: 10, y: 20, width: 400, height: 300,
    visible: true, locked: false, appearance: { mode: 'independent', config: { url, viewportWidth: 800, viewportHeight: 600 } } }] });

test('only browser config URL permits provider capabilities and an empty URL is an editable draft', async () => {
  const { validateSceneDocument } = await load('admin/scene-template.js');
  assert.equal(validateSceneDocument(document()).items[0].appearance.config.url, url);
  const missing = document(); missing.items[0].appearance.config.url = '';
  assert.equal(validateSceneDocument(missing).items[0].appearance.config.url, '');
  for (const mutate of [
    (value) => { value.items[0].type = 'clock'; },
    (value) => { value.items[0].name = url; },
    (value) => { value.items[0].appearance.config.token = 'private'; },
    (value) => { value.items[0].appearance.config.url = 'javascript:alert(1)'; },
    (value) => { value.items[0].appearance = { mode: 'shared' }; },
  ]) {
    const value = document(); mutate(value); assert.throws(() => validateSceneDocument(value));
  }
});

test('export and import remove browser URLs and require an explicit valid replacement without leaking bindings', async () => {
  const { exportSceneTemplate, importSceneTemplate } = await load('admin/scene-template.js');
  const original = document();
  const serialized = exportSceneTemplate(original);
  assert.doesNotMatch(serialized, /source\.example|access_token|private|fragment/);
  assert.equal(original.items[0].appearance.config.url, url);
  const pending = importSceneTemplate(original, { createId: randomUUID });
  assert.doesNotMatch(JSON.stringify(pending), /source\.example|access_token|private|fragment/);
  assert.notEqual(pending.document.id, original.id);
  assert.deepEqual(plain(pending.bindings.map(({ kind, source }) => [kind, source])), [['browser-url', '']]);
  const binding = pending.bindings[0].id;
  for (const resolution of [{ confirmed: false, value: url }, { confirmed: true, value: '' }, { confirmed: true, value: 'file:///private' }]) {
    assert.throws(() => pending.resolve({ [binding]: resolution }));
  }
  const resolved = pending.resolve({ [binding]: { confirmed: true, value: url } });
  assert.equal(resolved.items[0].appearance.config.url, url);
  assert.equal(pending.document.items[0].appearance.config.url, '');
});

test('moving and resizing browser layers keeps their webpage viewport unchanged', async () => {
  const { resizeSceneItem, moveSceneItems } = await load('admin/scene-document-model.js');
  const initial = document();
  const id = initial.items[0].id;
  const resized = resizeSceneItem(initial, id, 'se', 160, 80);
  const moved = moveSceneItems(resized, [id], 40, 30);
  assert.deepEqual(plain(moved.items[0].appearance.config), initial.items[0].appearance.config);
  assert.deepEqual([moved.items[0].x, moved.items[0].y, moved.items[0].width, moved.items[0].height], [50, 50, 560, 380]);
});
