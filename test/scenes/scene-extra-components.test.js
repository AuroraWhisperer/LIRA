'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { normalizeSceneDocument } = require('../../src/scenes/scene-contract');
const { createSceneStore } = require('../../src/storage/scene-store');
const { migrateScenes, migrateComponentOutputSizes } = require('../../src/storage/scene-migration');
const { createSceneService } = require('../../src/scenes/scene-service');
const { createSceneExtraDisplay } = require('../../src/server/scene-extra-display');

function documentFor(type, config = createSceneExtraDefaults(type)) {
  return { schemaVersion: 1, id: randomUUID(), title: '新组件', canvas: { width: 1920, height: 1080 },
    items: [{ id: randomUUID(), type, name: type, x: 10, y: 20, width: 400, height: 300,
      visible: true, locked: false, appearance: { mode: 'independent', config } }] };
}

test('each extra component accepts all declared presets and preserves its geometry and parameter types', () => {
  for (const [type, definition] of Object.entries(SCENE_EXTRA_COMPONENTS)) {
    for (const preset of definition.variants) {
      const config = { ...createSceneExtraDefaults(type), ...(definition.variantKey ? { [definition.variantKey]: preset.value } : {}) };
      const input = documentFor(type, config);
      const output = normalizeSceneDocument(input, { normalizeConfig: normalizeSceneConfig });
      assert.deepEqual(output, input);
      assert.notEqual(output.items[0].appearance.config, input.items[0].appearance.config);
    }
  }
});

test('new canvas components reject invalid, secret and business configuration and unowned shared modes', () => {
  for (const [type, definition] of Object.entries(SCENE_EXTRA_COMPONENTS)) {
    const defaults = createSceneExtraDefaults(type);
    for (const key of ['streamerId', 'token', 'target', 'session', 'settings']) {
      assert.throws(() => normalizeSceneConfig(type, { ...defaults, [key]: 'private' }), { code: 'INVALID_SCENE_CONFIG' });
    }
    for (const [key, field] of Object.entries(definition.fields)) {
      const values = field.type === 'number' ? [NaN, Infinity, field.max + 1, '', {}]
        : field.type === 'checkbox' ? ['yes', 1, null]
          : field.type === 'color' ? ['red', '#fff', 'url(private)']
            : field.type === 'select' ? ['unknown', '__proto__'] : ['x'.repeat(field.maxLength + 1), {}];
      for (const value of values) assert.throws(() => normalizeSceneConfig(type, { ...defaults, [key]: value }), `${type}.${key}`);
    }
    const doc = documentFor(type); doc.items[0].appearance = { mode: 'shared' };
    assert.throws(() => normalizeSceneDocument(doc, { normalizeConfig: normalizeSceneConfig }));
  }
  assert.throws(() => normalizeSceneConfig('gift-feed', { ...createSceneExtraDefaults('gift-feed'), threshold2: 100 }));
});

test('asynchronous output rejects account changes and source revocation before releasing any display data', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close()); migrateScenes(db); migrateComponentOutputSizes(db);
  const owner = { scope: 'synthetic-owner', epoch: 1 };
  let release;
  const service = createSceneService({ store: createSceneStore(db), getOwner: () => owner,
    normalizeConfig: normalizeSceneConfig, getDefaultConfig: createSceneExtraDefaults,
    getDisplayData: () => new Promise((resolve) => { release = resolve; }),
    secretCodec: { isAvailable: () => true, encrypt: (value) => Buffer.from(value).toString('base64'),
      decrypt: (value) => Buffer.from(value, 'base64').toString() } });
  const created = service.create({ title: '直播场景', canvas: { width: 1920, height: 1080 } });
  const doc = { ...documentFor('gift-wishes'), id: created.document.id };
  const saved = service.save({ id: doc.id, expectedRevision: created.revision, document: doc });
  service.publish({ id: doc.id, expectedRevision: saved.revision });
  const source = service.getSource(doc.id);
  const pendingOwner = service.getOutput({ ...source, version: 0 });
  owner.epoch++;
  release({ 'gift-wishes': { items: [{ label: 'private' }] } });
  await assert.rejects(pendingOwner, { code: 'SCENE_OWNER_CHANGED' });
  const pendingToken = service.getOutput({ ...source, version: 0 });
  service.rotate(doc.id);
  release({ 'gift-wishes': { items: [] } });
  await assert.rejects(pendingToken, { code: 'SCENE_ACCESS_DENIED' });
});

test('extra display projection excludes game secrets, keeps lyrics separate from settings and shares slow reads', async () => {
  const owner = { scope: 'a', epoch: 1 };
  let reads = 0;
  let revision = 'gift-a';
  const context = {
    system: { getState: () => ({ settings: { roomId: 'private' }, lyricState: { lineText: '真实歌词', playing: true, private: 'hidden' }, lyricTimeline: { lines: [] } }) },
    games: { getSession: () => ({ game: 'number-bomb', state: { min: 1, max: 100, secret: 32 }, token: 'hidden' }) },
    gifts: { getViewRevision: () => revision },
    settings: { get: () => ({ openingEnabled: 'true', openingStyle: 'pixel-cassette', openingTitle: '即将开播', secret: 'hidden' }) },
    giftWishes: { getSnapshot: async () => { reads++; return { items: [], guards: [{ name: 'private' }], sourceId: 1 }; } },
  };
  const display = createSceneExtraDisplay({ getContext: () => context, getOwner: () => owner });
  assert.equal(display('opening').style, 'pixel-cassette');
  assert.equal(display('opening').enabled, true);
  assert.equal(display('opening').title, '即将开播');
  assert.equal(display('opening').secret, undefined);
  assert.deepEqual(display('games'), { session: { game: 'number-bomb', state: { min: 1, max: 100 } } });
  assert.deepEqual(display('lyrics'), { lyricState: { lineText: '真实歌词', playing: true }, lyricTimeline: { lines: [] } });
  const [first, second] = await Promise.all([display('gift-wishes'), display('gift-wishes')]);
  assert.deepEqual(first, { items: [] }); assert.deepEqual(second, first); assert.equal(reads, 1);
  await display('gift-wishes'); assert.equal(reads, 1);
  revision = 'gift-b'; await display('gift-wishes'); assert.equal(reads, 2);
  owner.epoch++; await display('gift-wishes'); assert.equal(reads, 3);
});
