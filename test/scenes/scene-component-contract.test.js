'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { SCENE_TYPES, SHARED_SCENE_TYPES } = require('../../src/shared/scene-component-types');
const { normalizeSceneDocument } = require('../../src/scenes/scene-contract');
const { COMPONENT_PORTS } = require('../../src/server/scene-components');
const { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { createComponentPreviewSessions, PREVIEW_SESSION_TYPES } = require('../../src/server/component-preview-sessions');
const { composeComponentPreviewHtml, COMPONENT_PREVIEW_FRAGMENTS } = require('../../src/server/component-preview-page');

test('scene types have explicit backend adapters while canvas is only a control session', () => {
  assert.deepEqual(Object.keys(COMPONENT_PORTS).sort(), [...SCENE_TYPES].sort());
  assert.deepEqual(Object.keys(COMPONENT_PREVIEW_FRAGMENTS), SCENE_TYPES);
  assert.deepEqual(PREVIEW_SESSION_TYPES, [...SHARED_SCENE_TYPES, 'canvas']);
  const sessions = createComponentPreviewSessions();
  const state = { draft: {}, saved: {}, generation: 0, loaded: true };
  const scene = (type) => ({ schemaVersion: 1, id: randomUUID(), title: '类型契约',
    canvas: { width: 1920, height: 1080 }, items: [{ id: randomUUID(), type, name: type,
      x: 0, y: 0, width: 320, height: 180, visible: true, locked: false,
      appearance: Object.hasOwn(SCENE_EXTRA_COMPONENTS, type)
        ? { mode: 'independent', config: createSceneExtraDefaults(type) } : { mode: 'shared' } }] });
  for (const type of SCENE_TYPES) {
    assert.equal(normalizeSceneDocument(scene(type), { normalizeConfig: (id, config) => COMPONENT_PORTS[id].normalizeConfig(config) }).items[0].type, type);
    if (SHARED_SCENE_TYPES.includes(type)) {
      const opened = sessions.open({ component: type, state });
      assert.equal(sessions.browser({ id: opened.id, action: 'read' }, opened.token).component, type);
    } else assert.throws(() => sessions.open({ component: type, state }), { statusCode: 400 });
  }
  assert.ok(sessions.open({ component: 'canvas', state }).id);
  for (const type of ['canvas', 'unknown', 'constructor', '__proto__']) {
    assert.throws(() => normalizeSceneDocument(scene(type)), { code: 'SCENE_INVALID_DOCUMENT' });
    if (type !== 'canvas') assert.throws(() => sessions.open({ component: type, state }), { statusCode: 400 });
  }
});

test('preview HTML uses only explicit component fragments and never input-derived paths', () => {
  const publicDir = path.resolve(__dirname, '../../public');
  const shell = fs.readFileSync(path.join(publicDir, 'pages/component-preview.html'), 'utf8');
  const empty = shell.replace('<!-- component-preview-template -->', '');
  const composed = composeComponentPreviewHtml(publicDir);
  assert.notEqual(composed, empty);
  for (const type of SCENE_TYPES) assert.equal(composeComponentPreviewHtml(publicDir, type), composed);
  for (const type of ['canvas', 'unknown', 'constructor', '../../private']) {
    assert.equal(composeComponentPreviewHtml(publicDir, type), empty);
  }
});
