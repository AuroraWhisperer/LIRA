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

test('backgrounds default to empty and preserve explicit legacy presets through template import', () => {
  const { importSceneTemplate } = require('../../public/js/admin/scene-template.js');
  const input = documentFor('background', { style: 'moonlit' });
  assert.deepEqual(normalizeSceneConfig('background', {}), createSceneExtraDefaults('background'));
  const imported = importSceneTemplate(input);
  assert.deepEqual(imported.bindings, []);
  assert.equal(imported.document.items[0].appearance.config.style, 'moonlit');
  assert.notEqual(imported.document.items[0].id, input.items[0].id);
});

test('background parameters preserve legacy fit and validate default snapshots independently', () => {
  const { getBackgroundAppearance } = require('../../public/js/shared/background-appearance.js');
  const { createMediaStyle } = require('../../public/js/shared/component-media-style.js');
  const mediaStyle = createMediaStyle('background', { id: randomUUID(), kind: 'video', width: 1920, height: 1080,
    src: `/component-media/${randomUUID()}/${'a'.repeat(64)}.webm` });
  mediaStyle.volume = 0.25;
  const legacy = normalizeSceneConfig('background', { style: 'none', mediaStyle });
  assert.equal(legacy.fit, 'fill');
  assert.equal(legacy.volume, 0.25);
  assert.equal(legacy.opacity, 1);
  assert.equal(legacy.blur, 0);
  for (const key of ['fit', 'volume']) assert.throws(() => normalizeSceneConfig('background', { ...legacy, [key]: null }), { code: 'INVALID_SCENE_CONFIG' });
  assert.equal(normalizeSceneConfig('background', { style: 'moonlit' }).fit, 'cover');
  const defaults = { opacity: 0.7, blur: 4, fit: 'contain', playbackRate: 0.75 };
  const config = normalizeSceneConfig('background', { ...legacy, opacity: 0.4, blur: 12, backgroundDefaults: defaults });
  assert.equal(config.opacity, 0.4);
  assert.deepEqual(config.backgroundDefaults, getBackgroundAppearance(defaults));
  const normalized = normalizeSceneDocument(documentFor('background', config), { normalizeConfig: normalizeSceneConfig });
  assert.deepEqual(normalized.items[0].appearance.config, config);
  assert.notEqual(normalized.items[0].appearance.config.backgroundDefaults, config.backgroundDefaults);
  for (const value of [null, [], { blur: 31 }, { playbackRate: 0.4 }, { opacity: -0.1 }, { volume: 1.1 },
    { overlayColor: 'url(private)' }, { style: 'moonlit' }, { backgroundDefaults: {} }, { token: 'secret' }]) {
    assert.throws(() => normalizeSceneConfig('background', { style: 'none', backgroundDefaults: value }), { code: 'INVALID_SCENE_CONFIG' });
  }
  assert.throws(() => normalizeSceneConfig('opening', { style: 'original', backgroundDefaults: defaults }), { code: 'INVALID_SCENE_CONFIG' });
});

test('background filters validate relations and preserve authored defaults through scene normalization', () => {
  const filters = { colorProcessing: 'standard', temperature: 35, tint: -10, liftRed: 0.05, gammaBlue: 1.2, gainGreen: 0.9,
    preserveLuminance: false, shadowColor: '#789abc', shadowStrength: 0.2,
    glowMode: 'star', glowStrength: 0.8, glowThreshold: 0.65, glowSoftness: 0.15, irisBlur: 12,
    vignetteOpacity: 0.3, levelsChannel: 'b', inputBlack: 10, inputWhite: 230, gamma: 1.2, grainSize: 2.5, grainStrength: 0.1 };
  const config = normalizeSceneConfig('background', { ...filters, backgroundDefaults: filters });
  const scene = normalizeSceneDocument(documentFor('background', config), { normalizeConfig: normalizeSceneConfig });
  for (const [key, value] of Object.entries(filters)) {
    assert.equal(scene.items[0].appearance.config[key], value);
    assert.equal(scene.items[0].appearance.config.backgroundDefaults[key], value);
  }
  for (const invalid of [{ inputBlack: 50, inputWhite: 50 }, { outputBlack: 150, outputWhite: 100 }, { gamma: 0 },
    { temperature: 101 }, { grainSize: 1.1 }, { glowMode: 'unknown' }, { colorProcessing: 'shoost' },
    { liftRed: 1.1 }, { gammaBlue: 0 }, { gainGreen: 3.1 }, { liftBlue: .001 }]) {
    assert.throws(() => normalizeSceneConfig('background', invalid), { code: 'INVALID_SCENE_CONFIG' });
    assert.throws(() => normalizeSceneConfig('background', { backgroundDefaults: invalid }), { code: 'INVALID_SCENE_CONFIG' });
  }
  assert.equal(normalizeSceneConfig('background', {}).glowStrength, 0);
});

test('background color processing preserves old non-neutral values and defaults new appearances to standard', () => {
  const { getBackgroundAppearance } = require('../../public/js/shared/background-appearance.js');
  for (const [config, mode] of [
    [{}, 'standard'], [{ temperature: 0, tint: '0' }, 'standard'], [{ glowStrength: .3 }, 'standard'],
    [{ temperature: 20 }, 'legacy'], [{ tint: '-10' }, 'legacy'], [{ midtoneStrength: .2 }, 'legacy'],
    [{ colorProcessing: 'standard', temperature: 20 }, 'standard'],
    [{ colorProcessing: 'legacy', temperature: 0 }, 'legacy'],
  ]) {
    const normalized = normalizeSceneConfig('background', { ...config, backgroundDefaults: config });
    assert.equal(getBackgroundAppearance(config).colorProcessing, mode);
    assert.equal(normalized.colorProcessing, mode);
    assert.equal(normalized.backgroundDefaults.colorProcessing, mode);
    assert.deepEqual(normalizeSceneConfig('background', normalized), normalized);
  }
});

test('opening appearances expose both built-in styles and preserve client-following and suite styles', () => {
  assert.deepEqual(SCENE_EXTRA_COMPONENTS.opening.variants.map(({ value }) => value), ['classic', 'pixel-cassette']);
  assert.deepEqual(normalizeSceneConfig('opening', {}), { style: 'original' });
  for (const style of ['classic', 'pixel-cassette', 'moonlit-fan']) {
    assert.deepEqual(normalizeSceneConfig('opening', { style }), { style });
  }
  assert.throws(() => normalizeSceneConfig('opening', { style: 'unknown' }), { code: 'INVALID_SCENE_CONFIG' });
  assert.throws(() => normalizeSceneConfig('opening', { style: 'moonlit-fan', enabled: true }), { code: 'INVALID_SCENE_CONFIG' });
});

test('guard thanks preserves legacy event styles and saves each explicit built-in style', () => {
  assert.deepEqual(SCENE_EXTRA_COMPONENTS['guard-thanks'].variants.map(({ value }) => value), ['aurora', 'classic']);
  assert.deepEqual(normalizeSceneConfig('guard-thanks', {}), { style: 'follow', textMode: 'follow', showAvatar: true, showUserName: true, nameFontSize: 45 });
  assert.deepEqual(normalizeSceneConfig('guard-thanks', { textMode: 'en' }), { style: 'follow', textMode: 'en', showAvatar: true, showUserName: true, nameFontSize: 45 });
  for (const style of ['aurora', 'classic']) {
    const input = documentFor('guard-thanks', { style, textMode: 'zh', showAvatar: true, showUserName: true, nameFontSize: 45 });
    assert.deepEqual(normalizeSceneDocument(input, { normalizeConfig: normalizeSceneConfig }), input);
  }
  assert.throws(() => normalizeSceneConfig('guard-thanks', { style: 'unknown' }), { code: 'INVALID_SCENE_CONFIG' });
});

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
      const values = field.type === 'number' ? [NaN, Infinity, field.max + 1, ...(field.optional ? [] : ['']), {}]
        : field.type === 'checkbox' ? ['yes', 1, null]
          : field.type === 'color' ? ['red', '#fff', 'url(private)']
            : field.type === 'select' ? ['unknown', '__proto__'] : ['x'.repeat(field.maxLength + 1), {}];
      for (const value of values) assert.throws(() => normalizeSceneConfig(type, { ...defaults, [key]: value }), `${type}.${key}`);
      if (field.type === 'number' && field.optional) assert.equal(normalizeSceneConfig(type, { ...defaults, [key]: '' })[key], '');
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

test('sprint canvas projects only the existing countdown and templates contain no business state', () => {
  const { exportSceneTemplate, importSceneTemplate } = require('../../public/js/admin/scene-template.js');
  const state = { giftSprint: { targetRmb: 1000, remainingCrystalBalls: 7, receivedRmb: 300, private: 'hidden' } };
  const display = createSceneExtraDisplay({ getContext: () => ({ system: { getState: () => state } }) });
  assert.deepEqual(display('gift-sprint'), { targetRmb: 1000, remainingCrystalBalls: 7 });
  state.giftSprint = null;
  assert.equal(display('gift-sprint'), null);
  const document = documentFor('gift-sprint');
  const imported = importSceneTemplate(exportSceneTemplate(document));
  assert.deepEqual(imported.document.items[0].appearance, { mode: 'independent', config: {} });
  assert.deepEqual(imported.bindings.map(({ component, kind, source }) => ({ component, kind, source })),
    [{ component: 'gift-sprint', kind: 'source', source: 'gift-sprint' }]);
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

test('targeted display invalidation refreshes configuration immediately and an older pending read cannot replace the new cache', async () => {
  let label = '原许愿';
  let reads = 0;
  let release;
  const context = {
    gifts: { getViewRevision: () => 'unchanged-gift-revision' },
    giftWishes: { getSnapshot() {
      reads++;
      if (reads === 1) return new Promise(resolve => { release = resolve; });
      return { items: [{ label }] };
    } },
  };
  const display = createSceneExtraDisplay({ getContext: () => context, getOwner: () => ({ scope: 'owner', epoch: 1 }) });
  const pending = display('gift-wishes');
  await Promise.resolve();
  label = '更新后许愿';
  display.invalidate(['gift-wishes']);
  assert.deepEqual(await display('gift-wishes'), { items: [{ label }] });
  release({ items: [{ label: '原许愿' }] });
  await pending;
  assert.deepEqual(await display('gift-wishes'), { items: [{ label }] });
  assert.equal(reads, 2);
  display.invalidate(['gift-feed']);
  await display('gift-wishes');
  assert.equal(reads, 2, 'Unrelated invalidation must retain the wish cache.');
});
