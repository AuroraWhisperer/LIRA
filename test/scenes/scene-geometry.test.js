'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { SCENE_TYPES, SHARED_SCENE_TYPES } = require('../../src/shared/scene-component-types');
const { normalizeSceneDocument } = require('../../src/scenes/scene-contract');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');
const { loadModuleExports } = require('../helpers/frontend-modules');

const modules = Promise.all(['scene-template.js', 'scene-document-model.js'].map(file =>
  loadModuleExports(path.resolve(__dirname, '../../public/js/admin', file), { TextEncoder, URL })));
const plain = value => JSON.parse(JSON.stringify(value));

function scene(type = 'queue') {
  return { schemaVersion: 1, id: randomUUID(), title: '越界布局', canvas: { width: 800, height: 600 },
    items: [{ id: randomUUID(), type, name: type, x: 100, y: 100, width: 320, height: 180,
      visible: true, locked: false, appearance: SHARED_SCENE_TYPES.includes(type) ? { mode: 'shared' }
        : { mode: 'independent', config: type === 'browser'
          ? { url: 'https://example.com/', viewportWidth: 800, viewportHeight: 600 }
          : type === 'text-box' ? createTextBoxDefaults() : {} } }] };
}

test('every component can cross every edge and corner; frontend and backend enforce the same visible minimum', async () => {
  const [{ validateSceneDocument }, { moveSceneItems }] = await modules;
  for (const type of SCENE_TYPES) {
    const document = scene(type);
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
  const [{ validateSceneDocument }, { resizeSceneItem }] = await modules;
  for (const type of ['queue', 'clock', 'overtime']) {
    for (const [x, y] of [[-296, -156], [776, 576]]) {
      const document = scene(type);
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
  const [{ validateSceneDocument }, { createSceneDocumentModel, resizeSceneCanvas, alignSceneItems }] = await modules;
  const document = scene();
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
