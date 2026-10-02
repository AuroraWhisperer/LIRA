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
const clockConfig = getClockConfig(DEFAULT_SETTINGS);
function item(type = 'clock', mode = 'independent', config = clockConfig) {
  return { id: randomUUID(), type, name: type, x: 0, y: 0, width: 320, height: 180, visible: true, locked: false,
    appearance: mode === 'shared' ? { mode } : { mode, config } };
}
const documentOf = (items = [item()]) => ({ schemaVersion: 1, id: randomUUID(), title: 'Audit', canvas: { width: 1920, height: 1080 }, items });
test('A08: moving one item does not notify unchanged appearances across 32 instances', async () => {
  const { createSceneDocumentModel } = await load('admin/scene-document-model.js');
  const { createSceneItemController } = await load('admin/scene-item-controller.js');
  const document = documentOf(Array.from({ length: 32 }, () => item()));
  const model = createSceneDocumentModel(document);
  let notifications = 0;
  let changed = 0;
  const defaults = { getState: () => ({ loaded: true, draft: {}, saved: {} }), subscribe(fn) { fn(); return () => {}; } };
  const stops = document.items.map(item => createSceneItemController(model, item.id, defaults).subscribe(state => {
    notifications++; if (JSON.stringify(state.draft) !== JSON.stringify(item.appearance.config)) changed++;
  }));
  notifications = changed = 0;
  model.edit(draft => { draft.items[0].x++; });
  assert.equal(notifications, 0); assert.equal(changed, 0);
  stops.forEach(stop => stop());
});

test('appearance and shared-default edits notify only their consumers, including undo and gestures', async () => {
  const { createSceneDocumentModel } = await load('admin/scene-document-model.js');
  const { createSceneItemController } = await load('admin/scene-item-controller.js');
  const { createComponentConfigController } = await load('admin/component-config-controller.js');
  const document = documentOf([item(), item(), item('clock', 'shared')]);
  const model = createSceneDocumentModel(document);
  const defaults = createComponentConfigController({ initial: clockConfig });
  const notices = [0, 0, 0];
  const controllers = document.items.map(item => createSceneItemController(model, item.id, defaults));
  const stops = controllers.map((controller, index) => controller.subscribe(() => { notices[index]++; }));
  assert.deepEqual(notices, [1, 1, 1]);
  controllers[0].edit({ label: 'independent' });
  assert.deepEqual(notices, [2, 1, 1]);
  defaults.edit({ label: 'shared' });
  assert.deepEqual(notices, [2, 1, 2]);
  model.beginGesture();
  model.updateGesture(draft => { draft.items[0].x += 20; });
  model.commitGesture();
  model.undo();
  assert.deepEqual(notices, [2, 1, 2]);
  model.undo();
  assert.deepEqual(notices, [3, 1, 2]);
  assert.equal(Object.isFrozen(model.getSnapshot().items[0].appearance.config), true);
  controllers[0].getState().draft.label = 'external mutation';
  assert.notEqual(model.getSnapshot().items[0].appearance.config.label, 'external mutation');
  stops.forEach(stop => stop());
});
