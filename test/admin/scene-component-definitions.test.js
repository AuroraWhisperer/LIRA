'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { SCENE_TYPES } = require('../../src/shared/scene-component-types');
const { PREVIEW_SESSION_TYPES } = require('../../src/server/component-preview-sessions');
const { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { BROWSER_SOURCE_DEFAULTS } = require('../../public/js/shared/scene-browser-source.js');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');

const load = (file) => loadModuleExports(path.resolve(__dirname, '../../public/js', file), { TextEncoder, URL });
const plain = (value) => JSON.parse(JSON.stringify(value));
const scene = (type) => ({ schemaVersion: 1, id: randomUUID(), title: '类型契约',
  canvas: { width: 1920, height: 1080 }, items: [{ id: randomUUID(), type, name: type,
    x: 0, y: 0, width: 320, height: 180, visible: true, locked: false,
    appearance: type === 'browser'
      ? { mode: 'independent', config: { ...BROWSER_SOURCE_DEFAULTS, url: 'https://example.test/source?token=display' } }
      : type === 'text-box' ? { mode: 'independent', config: createTextBoxDefaults() }
      : Object.hasOwn(SCENE_EXTRA_COMPONENTS, type)
      ? { mode: 'independent', config: createSceneExtraDefaults(type) } : { mode: 'shared' } }] });

test('frontend capabilities and preview definitions agree on production scene types', async () => {
  const shared = await load('shared/scene-components.js');
  const { COMPONENT_PREVIEW_DEFINITIONS: definitions } = await load('admin/component-preview-definitions.js');
  assert.deepEqual(plain(shared.SCENE_TYPES), SCENE_TYPES);
  assert.deepEqual(Object.keys(shared.SCENE_COMPONENTS), SCENE_TYPES);
  assert.deepEqual(Object.keys(definitions), SCENE_TYPES);
});

test('frontend document validation and draft recovery keep render and control types distinct', async () => {
  const { validateSceneDocument } = await load('admin/scene-template.js');
  const { readPreviewDraft } = await load('admin/component-preview-drafts.js');
  const snapshot = (types) => JSON.stringify({ schemaVersion: 1,
    components: Object.fromEntries(types.map(type => [type, { saved: {}, draft: { label: 'draft' } }])) });
  const read = (types) => readPreviewDraft('a'.repeat(64), { getItem: () => snapshot(types) });
  for (const type of SCENE_TYPES) assert.equal(validateSceneDocument(scene(type)).items[0].type, type);
  assert.deepEqual(Object.keys(read(PREVIEW_SESSION_TYPES).components), PREVIEW_SESSION_TYPES);
  for (const type of ['canvas', 'unknown', 'constructor', '__proto__']) {
    assert.throws(() => validateSceneDocument(scene(type)));
    if (type !== 'canvas') assert.equal(read([type]), null);
  }
});
