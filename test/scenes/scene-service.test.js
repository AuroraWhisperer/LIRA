'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createCipheriv, createDecipheriv, randomBytes, randomUUID, createHash } = require('node:crypto');
const { migrateScenes, migrateComponentOutputSizes, migrateCanvasPresets } = require('../../src/storage/scene-migration');
const { createSceneStore } = require('../../src/storage/scene-store');
const { createSceneService } = require('../../src/scenes/scene-service');
const { MAX_SCENE_BYTES, normalizeSceneDocument } = require('../../src/scenes/scene-contract');
const { createScratchDirectory } = require('../helpers/scratch-directory');

function item(type = 'clock', changes = {}) {
  return {
    id: randomUUID(), type, name: '组件', x: 0, y: 0, width: 320, height: 180,
    visible: true, locked: false, appearance: { mode: 'shared' }, ...changes,
  };
}

function document(items = []) {
  return { schemaVersion: 1, id: randomUUID(), title: '本地场景', canvas: { width: 1920, height: 1080 }, items };
}

function normalizeConfig(type, config) {
  if (Object.keys(config).length !== 1 || typeof config.color !== 'string' || config.color.length > 80) {
    throw new Error('private configuration failure');
  }
  return { color: config.color };
}

function fixture(t, persistent = false) {
  const directory = persistent ? createScratchDirectory('scene-service-') : null;
  const filename = directory ? path.join(directory, 'scenes.sqlite') : ':memory:';
  let db = new DatabaseSync(filename);
  t.after(() => {
    db.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });
  migrateScenes(db);
  migrateComponentOutputSizes(db);
  migrateCanvasPresets(db);
  const store = createSceneStore(db);
  const state = {
    owner: { scope: 'https://server.test/streamer-a', epoch: 1 },
    available: true, encryptFailure: false, decryptFailure: false,
    color: 'white', dataCalls: [],
  };
  const key = randomBytes(32);
  const secretCodec = {
    isAvailable: () => state.available,
    encrypt(value) {
      if (state.encryptFailure) throw new Error('PRIVATE encryption details');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    decrypt(value) {
      if (state.decryptFailure) throw new Error('PRIVATE decryption details');
      const bytes = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  const ports = {
    store, secretCodec, normalizeConfig,
    getOwner: () => state.owner,
    getDefaultConfig: () => ({ color: state.color }),
    getDisplayData(types, cursor) {
      state.dataCalls.push({ types, cursor });
      return { epoch: 'stream-1', cursor: 9, reset: false, gap: false, events: [] };
    },
  };
  return {
    db, store, state, ports, service: createSceneService(ports),
    restart() {
      db.close();
      db = new DatabaseSync(filename);
      migrateScenes(db);
      migrateComponentOutputSizes(db);
  migrateCanvasPresets(db);
      return createSceneService({ ...ports, store: createSceneStore(db) });
    },
  };
}

function create(service) {
  return service.create({ title: '场景', canvas: { width: 1920, height: 1080 } });
}

function saveItems(service, created, items) {
  return service.save({ id: created.document.id, expectedRevision: created.revision, document: { ...created.document, items } });
}

test('deleting surplus presets preserves live output and rejects protected, stale or foreign scenes', t => {
  const f = fixture(t, true);
  const { service, state } = f;
  const first = create(service);
  const binding = service.getCanvas();
  const live = create(service);
  service.publishCanvas({ id: live.document.id, expectedRevision: 1, expectedPublishedVersion: 0 });
  const source = service.getSource(binding.outputId);
  const output = service.getOutput({ ...source, version: 0 });
  const remove = dto => service.delete({ id: dto.document.id, expectedRevision: dto.revision });
  assert.throws(() => remove(first), { code: 'SCENE_OUTPUT_PROTECTED' });
  assert.throws(() => remove(live), { code: 'SCENE_ACTIVE_PROTECTED' });
  const extra = create(service);
  const updated = service.save({ id: extra.document.id, expectedRevision: extra.revision,
    document: { ...extra.document, title: 'Updated' } });
  assert.throws(() => remove(extra), { code: 'SCENE_CONFLICT' });
  const owner = state.owner;
  state.owner = { scope: 'another-owner', epoch: 1 };
  assert.throws(() => remove(updated), { code: 'SCENE_NOT_FOUND' });
  state.owner = owner;
  assert.deepEqual(remove(updated), { id: extra.document.id });
  assert.throws(() => service.get(extra.document.id), { code: 'SCENE_NOT_FOUND' });
  assert.throws(() => remove(updated), { code: 'SCENE_NOT_FOUND' });
  assert.equal(service.list().length, 2);
  assert.deepEqual(service.getSource(binding.outputId), source);
  const after = service.getOutput({ ...source, version: 0 });
  assert.deepEqual(after.document, output.document);
  assert.equal(after.version, output.version);
  assert.equal(service.getCanvas().activeSceneId, live.document.id);
  assert.equal(f.restart().list().some(dto => dto.document.id === extra.document.id), false);
});

test('canvas presets retain independent drafts and switch one persistent live source only on apply', t => {
  const f = fixture(t, true);
  const first = create(f.service);
  const binding = f.service.getCanvas();
  const source = f.service.getSource(binding.outputId);
  f.service.publishCanvas({ id: first.document.id, expectedRevision: 1, expectedPublishedVersion: 0 });
  const second = f.service.create({ title: '游戏预设', canvas: { width: 1280, height: 720 } });
  const saved = saveItems(f.service, second, [item()]);
  assert.equal(f.service.getOutput({ ...source, version: 0 }).document.title, first.document.title);
  assert.equal(f.service.getCanvas().outputId, first.document.id);
  f.service.publishCanvas({ id: saved.document.id, expectedRevision: saved.revision, expectedPublishedVersion: 1 });
  const output = f.service.getOutput({ ...source, version: 0 });
  assert.equal(output.version, 2);
  assert.equal(output.document.title, '游戏预设');
  assert.equal(output.document.id, source.id);
  assert.deepEqual(output.document.canvas, second.document.canvas);
  assert.deepEqual(f.service.get(first.document.id).document, first.document);
  assert.deepEqual(f.service.get(second.document.id).document, saved.document);
  assert.equal(f.service.getSource(source.id).token, source.token);
  const restarted = f.restart();
  assert.equal(restarted.getCanvas().activeSceneId, second.document.id);
  assert.equal(restarted.getCanvas().outputId, source.id);
  assert.equal(restarted.getOutput({ ...source, version: 0 }).document.title, '游戏预设');
});

test('failed, stale and cross-owner preset publications preserve the active scene, output and dimensions', t => {
  const { db, service, store, state } = fixture(t);
  const first = create(service);
  const binding = service.getCanvas();
  service.publishCanvas({ id: first.document.id, expectedRevision: 1, expectedPublishedVersion: 0 });
  const second = saveItems(service, create(service), [item()]);
  const input = { id: second.document.id, expectedRevision: second.revision, expectedPublishedVersion: 1 };
  assert.throws(() => service.publishCanvas({ ...input, expectedRevision: 1 }), { statusCode: 409 });
  assert.throws(() => service.publishCanvas({ ...input, expectedPublishedVersion: 0 }), { statusCode: 409 });
  const before = store.get(state.owner.scope, binding.outputId);
  db.exec(`CREATE TRIGGER reject_canvas_switch BEFORE UPDATE ON component_canvas
    BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
  assert.throws(() => service.publishCanvas(input), { statusCode: 500 });
  assert.deepEqual(store.get(state.owner.scope, binding.outputId), before);
  assert.equal(service.getCanvas().activeSceneId, first.document.id);
  assert.equal(store.getComponentSize(state.owner.scope, 'clock'), null);
  state.owner = { scope: 'other-account', epoch: 2 };
  assert.throws(() => service.publishCanvas(input), { statusCode: 404 });
  const other = create(service);
  assert.equal(service.getCanvas().outputId, other.document.id);
});

test('output projection receipts bind version, scene, item, owner epoch, capability and process lifetime', t => {
  const { service, state, ports } = fixture(t);
  const first = create(service);
  const entries = [item('queue'), item('clock')];
  const saved = saveItems(service, first, entries);
  service.publish({ id: first.document.id, expectedRevision: saved.revision });
  const source = service.getSource(first.document.id);
  const output = service.getOutput({ ...source, version: 0 });
  const active = { ...source, version: output.version, projection: output.projection };
  assert.ok(output.projection.length < 512);
  assert.doesNotMatch(output.projection, new RegExp(source.token));
  service.getOutput(active);
  assert.deepEqual(state.dataCalls.at(-1).types, ['queue', 'clock']);
  const reject = (reader, input) => assert.throws(() => reader.getOutput(input), { statusCode: 403 });
  reject(service, { ...active, projection: output.projection + 'a' });
  reject(service, { ...active, version: 9 });
  reject(service, { ...active, item: entries[0].id });
  const selected = service.getOutput({ ...source, item: entries[0].id, version: 0 });
  reject(service, { ...active, projection: selected.projection });
  const second = create(service);
  service.publish({ id: second.document.id, expectedRevision: second.revision });
  reject(service, { ...service.getSource(second.document.id), version: output.version, projection: output.projection });
  state.owner.epoch++;
  reject(service, active);
  const renewed = service.getOutput({ ...source, version: 0 });
  const current = { ...source, version: renewed.version, projection: renewed.projection };
  reject(createSceneService(ports), current);
  const rotated = service.rotate(source.id);
  reject(service, { ...current, token: rotated.token });
  state.owner = null;
  reject(service, { ...current, token: rotated.token });
});

function expectError(action, code, statusCode) {
  assert.throws(action, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    assert.doesNotMatch(error.message, /PRIVATE|private configuration|SELECT|sqlite|ciphertext/i);
    assert.equal(error.cause, undefined);
    return true;
  });
}

test('shared dimensions publish to default sources, persist across restart and stay owner scoped', (t) => {
  const { service, state, restart } = fixture(t, true);
  const shared = item('clock', { width: 800, height: 400 });
  const independent = item('clock', { width: 240, height: 120, appearance: { mode: 'independent', config: { color: 'blue' } } });
  const saved = saveItems(service, create(service), [shared, independent]);
  const id = saved.document.id;
  assert.equal(service.getComponentSize('clock'), null);
  service.publish({ id, expectedRevision: saved.revision });
  assert.deepEqual(service.getComponentSize('clock'), { width: 800, height: 400 });
  const source = service.getSource(id);
  const output = service.getOutput({ ...source, item: independent.id });
  assert.deepEqual(output.document.canvas, { width: 240, height: 120 });
  assert.deepEqual(output.document.items, [{ ...independent, x: 0, y: 0 }]);
  assert.deepEqual(state.dataCalls.at(-1).types, ['clock']);
  expectError(() => service.getOutput({ ...source, item: randomUUID() }), 'SCENE_ITEM_NOT_FOUND', 404);
  const revised = service.save({ id, expectedRevision: saved.revision,
    document: { ...saved.document, items: [{ ...shared, width: 900 }, independent] } });
  expectError(() => service.publish({ id, expectedRevision: saved.revision }), 'SCENE_CONFLICT', 409);
  assert.deepEqual(service.getComponentSize('clock'), { width: 800, height: 400 });
  const restored = restart();
  assert.deepEqual(restored.getComponentSize('clock'), { width: 800, height: 400 });
  assert.equal(restored.getOutput({ ...source, item: shared.id }).document.canvas.width, 800);
  restored.publish({ id, expectedRevision: revised.revision });
  assert.equal(restored.getComponentSize('clock').width, 900);
  assert.equal(restored.getOutput({ ...source, item: independent.id }).document.canvas.width, 240);
  const owner = state.owner;
  state.owner = { scope: 'another-account', epoch: 2 };
  assert.equal(restored.getComponentSize('clock'), null);
  state.owner = null;
  assert.equal(restored.getComponentSize('clock'), null);
  state.owner = owner;
  restored.rotate(id);
  expectError(() => restored.getOutput({ ...source, item: independent.id }), 'SCENE_ACCESS_DENIED', 403);
});

test('inconsistent shared dimensions reject publication before changing the source', (t) => {
  const { service } = fixture(t);
  const saved = saveItems(service, create(service), [item('clock'), item('clock', { width: 400 })]);
  expectError(() => service.publish({ id: saved.document.id, expectedRevision: saved.revision }), 'SCENE_SHARED_SIZE_CONFLICT', 400);
  assert.equal(service.getComponentSize('clock'), null);
  assert.equal(service.get(saved.document.id).publishedVersion, 0);
});

test('publication rejects delayed or changed shared appearance without replacing the current version', (t) => {
  const { service, state } = fixture(t);
  const scene = saveItems(service, create(service), [item('clock')]);
  const input = { id: scene.document.id, expectedRevision: scene.revision, expectedDefaults: { clock: { color: 'white' } } };
  assert.equal(service.publish(input).publishedVersion, 1);
  state.color = 'black';
  expectError(() => service.publish(input), 'SCENE_DEFAULT_CHANGED', 503);
  assert.equal(service.get(scene.document.id).publishedVersion, 1);
  expectError(() => service.publish({ ...input, expectedDefaults: {} }), 'SCENE_INVALID_DEFAULTS', 400);
  assert.equal(service.publish({ ...input, expectedDefaults: { clock: { color: 'black' } } }).publishedVersion, 2);
});

test('document normalization preserves empty scenes, layer order and valid boundaries without aliasing', () => {
  const empty = document();
  assert.deepEqual(normalizeSceneDocument(empty), empty);
  const source = document(Array.from({ length: 32 }, () => item('queue')));
  source.title = '场'.repeat(80);
  source.canvas = { width: 7680, height: 320 };
  source.items[0] = item('queue', { name: '😀'.repeat(80), x: 7648, y: 288, width: 32, height: 32 });
  source.items[1].x = 0.5;
  const normalized = normalizeSceneDocument(source);
  assert.deepEqual(normalized, source);
  assert.notEqual(normalized.items[0], source.items[0]);
  normalized.items[0].name = 'changed';
  assert.equal(source.items[0].name, '😀'.repeat(80));
});

const invalidChanges = [
  ['unknown document field', (value) => { value.token = 'secret'; }],
  ['unknown canvas field', (value) => { value.canvas.scale = 1; }],
  ['unknown item field', (value) => { value.items[0].revision = 1; }],
  ['unknown shared field', (value) => { value.items[0].appearance.config = {}; }],
  ['unknown independent field', (value) => { value.items[0].appearance = { mode: 'independent', config: { color: 'red' }, token: 'secret' }; }],
  ['schema version', (value) => { value.schemaVersion = 2; }],
  ['invalid id', (value) => { value.id = 'arbitrary'; }],
  ['invalid item id', (value) => { value.items[0].id = 'arbitrary'; }],
  ['duplicate id case', (value) => { value.items.push({ ...value.items[0], id: value.items[0].id.toUpperCase() }); }],
  ['wrong type', (value) => { value.items[0].type = 'admin'; }],
  ['title too long', (value) => { value.title = '场'.repeat(81); }],
  ['blank title', (value) => { value.title = '  '; }],
  ['name too long', (value) => { value.items[0].name = '名'.repeat(81); }],
  ['canvas too small', (value) => { value.canvas.width = 319; }],
  ['canvas too big', (value) => { value.canvas.height = 7681; }],
  ['fractional canvas', (value) => { value.canvas.width = 1920.5; }],
  ['too many items', (value) => { value.items = Array.from({ length: 33 }, () => item()); }],
  ['insufficient visible width', (value) => { value.items[0].x = 23 - value.items[0].width; }],
  ['infinite geometry', (value) => { value.items[0].height = Infinity; }],
  ['NaN geometry', (value) => { value.items[0].width = NaN; }],
  ['string geometry', (value) => { value.items[0].x = '0'; }],
  ['small item', (value) => { value.items[0].width = 31; }],
  ['outside canvas', (value) => { value.items[0].y = 1080; }],
  ['visibility coercion', (value) => { value.items[0].visible = 1; }],
  ['lock coercion', (value) => { value.items[0].locked = 'false'; }],
  ['unknown appearance', (value) => { value.items[0].appearance.mode = 'inherited'; }],
  ['missing field', (value) => { delete value.items[0].name; }],
  ['cyclic config', (value) => { value.items[0].appearance = { mode: 'independent', config: value }; }],
  ['non JSON config', (value) => { value.items[0].appearance = { mode: 'independent', config: { value: new Date() } }; }],
];

for (const [label, mutate] of invalidChanges) {
  test(`document rejects ${label}`, () => {
    const value = document([item()]);
    mutate(value);
    expectError(() => normalizeSceneDocument(value, { normalizeConfig }), 'SCENE_INVALID_DOCUMENT', 400);
  });
}

test('independent config validation is mandatory, delegated and detached', () => {
  const value = document([item('clock', { appearance: { mode: 'independent', config: { color: 'red' } } })]);
  expectError(() => normalizeSceneDocument(value), 'SCENE_INVALID_DOCUMENT', 400);
  let calls = 0;
  const result = normalizeSceneDocument(value, { normalizeConfig(type, config) {
    assert.equal(type, 'clock');
    calls += 1;
    config.color = 'blue';
    return config;
  } });
  assert.equal(calls, 1);
  assert.equal(value.items[0].appearance.config.color, 'red');
  assert.equal(result.items[0].appearance.config.color, 'blue');
  value.items[0].appearance.config.token = 'private';
  expectError(() => normalizeSceneDocument(value, { normalizeConfig }), 'SCENE_INVALID_DOCUMENT', 400);
});

test('256 KiB UTF-8 limit applies before and after config normalization', () => {
  const value = document([item('clock', { appearance: { mode: 'independent', config: { text: '' } } })]);
  const config = value.items[0].appearance.config;
  const remaining = MAX_SCENE_BYTES - Buffer.byteLength(JSON.stringify(value));
  config.text = '界'.repeat(Math.floor(remaining / 3)) + 'x'.repeat(remaining % 3);
  const passthrough = { normalizeConfig: (type, input) => input };
  assert.equal(Buffer.byteLength(JSON.stringify(normalizeSceneDocument(value, passthrough))), MAX_SCENE_BYTES);
  config.text += 'x';
  expectError(() => normalizeSceneDocument(value, passthrough), 'SCENE_INVALID_DOCUMENT', 400);
  config.text = '';
  expectError(() => normalizeSceneDocument(value, { normalizeConfig: () => ({ text: 'x'.repeat(MAX_SCENE_BYTES) }) }), 'SCENE_INVALID_DOCUMENT', 400);
});

test('create returns only management DTO, generates unique encrypted source and supports empty publication', (t) => {
  const { service, store, state, ports } = fixture(t);
  const created = create(service);
  const id = created.document.id;
  assert.deepEqual(Object.keys(created).sort(), ['document', 'hasPublication', 'publishedVersion', 'revision']);
  assert.equal(created.revision, 1);
  assert.equal(created.publishedVersion, 0);
  assert.equal(created.hasPublication, false);
  assert.deepEqual(created.document.items, []);
  const source = service.getSource(id);
  assert.match(source.token, /^[0-9a-f]{64}$/);
  const stored = store.get(state.owner.scope, id);
  assert.equal(stored.capability.hash, createHash('sha256').update(source.token).digest('hex'));
  assert.equal(stored.capability.encrypted.includes(source.token), false);
  const decoded = JSON.parse(ports.secretCodec.decrypt(stored.capability.encrypted));
  assert.deepEqual(decoded, { schemaVersion: 1, ownerScope: state.owner.scope, sceneId: id, capabilityVersion: 1, token: source.token });
  assert.deepEqual(service.list(), [created]);
  expectError(() => service.getOutput(source), 'SCENE_NOT_PUBLISHED', 409);
  assert.equal(service.publish({ id, expectedRevision: 1 }).hasPublication, true);
  assert.deepEqual(service.getOutput(source).document.items, []);
  assert.deepEqual(state.dataCalls.at(-1).types, []);
  assert.deepEqual(createSceneService(ports).getSource(id), source);
  const another = create(service);
  assert.notEqual(another.document.id, id);
  assert.notEqual(service.getSource(another.document.id).token, source.token);
  assert.doesNotMatch(JSON.stringify(service.list()), /capability|encrypted|hash|token/);
});

test('publication freezes all appearances while draft saves, business data and cursor remain separate', (t) => {
  const { service, state } = fixture(t);
  const created = create(service);
  const saved = saveItems(service, created, [
    item('clock'), item('clock'), item('overtime', { visible: false }),
    item('queue', { appearance: { mode: 'independent', config: { color: 'blue' } } }), item('danmaku'),
  ]);
  const id = saved.document.id;
  const source = service.getSource(id);
  const published = service.publish({ id, expectedRevision: 2 });
  assert.equal(published.revision, 2);
  assert.equal(published.publishedVersion, 1);
  assert.equal(published.document.items[0].appearance.mode, 'shared');
  const output = service.getOutput({ ...source, epoch: 'stream-before', cursor: 5 });
  assert.deepEqual(state.dataCalls.at(-1), { types: ['clock', 'queue', 'danmaku'], cursor: { epoch: 'stream-before', cursor: 5 } });
  assert.equal(output.document.items[0].appearance.config.color, 'white');
  assert.equal(output.document.items[2].appearance.mode, 'independent');
  assert.equal(output.document.items[3].appearance.config.color, 'blue');
  state.color = 'black';
  const draft = { ...saved.document, title: 'unpublished changes' };
  service.save({ id, expectedRevision: 2, document: draft });
  assert.deepEqual(service.getSource(id), { ...source, itemIds: output.document.items.map((item) => item.id) });
  assert.deepEqual(service.getOutput({ ...source, version: 0 }).document, output.document);
  assert.equal(service.getOutput({ ...source, version: 1 }).document, null);
  assert.equal(state.dataCalls.length, 3);
  expectError(() => service.save({ id, expectedRevision: 2, document: draft }), 'SCENE_CONFLICT', 409);
  expectError(() => service.publish({ id, expectedRevision: 2 }), 'SCENE_CONFLICT', 409);
  const republished = service.publish({ id, expectedRevision: 3 });
  assert.equal(republished.publishedVersion, 2);
  assert.equal(service.getOutput({ ...source, version: 1 }).document.items[0].appearance.config.color, 'black');
  assert.deepEqual(service.getSource(id), { ...source, itemIds: output.document.items.map((item) => item.id) });
});

test('cross-scene tokens, changed owner, changed server and logout cannot read previous scene', (t) => {
  const { service, state } = fixture(t);
  const first = create(service);
  const second = create(service);
  const id = first.document.id;
  const source = service.getSource(id);
  service.publish({ id, expectedRevision: 1 });
  expectError(() => service.getOutput({ ...source, token: service.getSource(second.document.id).token }), 'SCENE_ACCESS_DENIED', 403);
  expectError(() => service.getOutput({ ...source, token: 'not-a-token' }), 'SCENE_ACCESS_DENIED', 403);
  for (const scope of ['https://server.test/streamer-b', 'https://another.test/streamer-a']) {
    state.owner = { scope, epoch: 2 };
    assert.deepEqual(service.list(), []);
    expectError(() => service.get(id), 'SCENE_NOT_FOUND', 404);
    expectError(() => service.getSource(id), 'SCENE_NOT_FOUND', 404);
    expectError(() => service.rotate(id), 'SCENE_NOT_FOUND', 404);
    expectError(() => service.getOutput(source), 'SCENE_NOT_FOUND', 404);
    expectError(() => service.save({ id, expectedRevision: 1, document: first.document }), 'SCENE_NOT_FOUND', 404);
    expectError(() => service.publish({ id, expectedRevision: 1 }), 'SCENE_NOT_FOUND', 404);
  }
  state.owner = null;
  expectError(() => service.getOutput(source), 'SCENE_OWNER_REQUIRED', 403);
  expectError(() => create(service), 'SCENE_OWNER_REQUIRED', 403);
  state.owner = { scope: 'https://server.test/streamer-a', epoch: 9 };
  assert.equal(service.getOutput(source).sceneId, id);
});

test('rotation invalidates old source without touching draft or publication and output never decrypts', (t) => {
  const { service, state, store } = fixture(t);
  const created = create(service);
  const id = created.document.id;
  service.publish({ id, expectedRevision: 1 });
  const before = service.get(id);
  const oldSource = service.getSource(id);
  const nextSource = service.rotate(id);
  assert.notEqual(nextSource.token, oldSource.token);
  assert.deepEqual(service.get(id), before);
  assert.equal(store.get(state.owner.scope, id).capability.version, 2);
  expectError(() => service.getOutput(oldSource), 'SCENE_ACCESS_DENIED', 403);
  state.available = false;
  state.decryptFailure = true;
  assert.equal(service.getOutput(nextSource).sceneId, id);
  expectError(() => service.getSource(id), 'SCENE_SOURCE_UNAVAILABLE', 503);
});

test('codec unavailability and encrypt/decrypt failures never replace an existing capability', (t) => {
  const { service, state, store } = fixture(t);
  const created = create(service);
  const id = created.document.id;
  const before = store.get(state.owner.scope, id);
  for (const property of ['available', 'encryptFailure', 'decryptFailure']) {
    state[property] = property !== 'available';
    expectError(() => service.rotate(id), 'SCENE_SOURCE_UNAVAILABLE', 503);
    expectError(() => create(service), 'SCENE_SOURCE_UNAVAILABLE', 503);
    assert.deepEqual(store.get(state.owner.scope, id), before);
    assert.equal(service.list().length, 1);
    state[property] = property === 'available';
  }
});

test('ciphertext tampering and mismatched encrypted package fields are rejected without writes', (t) => {
  const { service, state, store, db, ports } = fixture(t);
  const id = create(service).document.id;
  const original = store.get(state.owner.scope, id).capability;
  const decoded = JSON.parse(ports.secretCodec.decrypt(original.encrypted));
  const variants = [
    'corrupted ciphertext',
    ...[
      { schemaVersion: 2 }, { ownerScope: 'another owner' }, { sceneId: randomUUID() },
      { capabilityVersion: 2 }, { token: randomBytes(32).toString('hex') }, { unknown: true },
    ].map((changes) => ports.secretCodec.encrypt(JSON.stringify({ ...decoded, ...changes }))),
  ];
  for (const encrypted of variants) {
    db.prepare('UPDATE component_scenes SET capability_encrypted = ? WHERE id = ?').run(encrypted, id);
    const before = store.get(state.owner.scope, id);
    expectError(() => service.getSource(id), 'SCENE_SOURCE_UNAVAILABLE', 503);
    expectError(() => service.rotate(id), 'SCENE_SOURCE_UNAVAILABLE', 503);
    assert.deepEqual(store.get(state.owner.scope, id), before);
  }
});

test('failed config resolution, normalization and SQLite commit preserve prior publication', (t) => {
  const { service, state, store, ports, db } = fixture(t);
  const saved = saveItems(service, create(service), [item()]);
  const id = saved.document.id;
  service.publish({ id, expectedRevision: 2 });
  const before = store.get(state.owner.scope, id);
  state.color = 'x'.repeat(81);
  expectError(() => service.publish({ id, expectedRevision: 2 }), 'SCENE_INVALID_DOCUMENT', 400);
  assert.deepEqual(store.get(state.owner.scope, id), before);
  const broken = createSceneService({ ...ports, getDefaultConfig() { throw new Error('PRIVATE default read'); } });
  expectError(() => broken.publish({ id, expectedRevision: 2 }), 'SCENE_OPERATION_FAILED', 500);
  assert.deepEqual(store.get(state.owner.scope, id), before);
  state.color = 'blue';
  db.exec(`CREATE TRIGGER fail_publish AFTER UPDATE OF published_json ON component_scenes
    BEGIN SELECT RAISE(ABORT, 'PRIVATE SQLite failure'); END;`);
  expectError(() => service.publish({ id, expectedRevision: 2 }), 'SCENE_OPERATION_FAILED', 500);
  assert.deepEqual(store.get(state.owner.scope, id), before);
});

test('owner generation changes inside injected work prevent writes and reject late output', (t) => {
  const { service, ports, state, store } = fixture(t);
  const created = create(service);
  const id = created.document.id;
  service.publish({ id, expectedRevision: 1 });
  const source = service.getSource(id);
  const before = store.get(state.owner.scope, id);
  const changed = createSceneService({ ...ports, normalizeConfig(type, config) {
    state.owner.epoch += 1;
    return normalizeConfig(type, config);
  } });
  expectError(() => saveItems(changed, created, [item('clock', { appearance: { mode: 'independent', config: { color: 'red' } } })]), 'SCENE_OWNER_CHANGED', 409);
  assert.deepEqual(store.get(state.owner.scope, id), before);
  const late = createSceneService({ ...ports, getDisplayData() {
    state.owner = null;
    return { privateData: 'old account' };
  } });
  expectError(() => late.getOutput(source), 'SCENE_OWNER_CHANGED', 409);
});

test('a concurrent draft save during publication resolution fails its final atomic revision check', (t) => {
  const { service, ports } = fixture(t);
  const saved = saveItems(service, create(service), [item()]);
  const id = saved.document.id;
  service.publish({ id, expectedRevision: 2 });
  const raced = createSceneService({ ...ports, getDefaultConfig() {
    service.save({ id, expectedRevision: 2, document: { ...saved.document, title: 'newer' } });
    return { color: 'red' };
  } });
  expectError(() => raced.publish({ id, expectedRevision: 2 }), 'SCENE_CONFLICT', 409);
  assert.equal(service.get(id).revision, 3);
  assert.equal(service.get(id).publishedVersion, 1);
});

test('published source survives actual database close/reopen and a new service instance', (t) => {
  const { service, restart } = fixture(t, true);
  const saved = saveItems(service, create(service), [item()]);
  const id = saved.document.id;
  service.publish({ id, expectedRevision: 2 });
  const source = service.rotate(id);
  service.save({ id, expectedRevision: 2, document: { ...saved.document, title: 'next draft' } });
  const expected = service.get(id);
  const published = service.getOutput(source).document;
  const restored = restart();
  assert.deepEqual(restored.getSource(id), { ...source, itemIds: published.items.map((item) => item.id) });
  assert.deepEqual(restored.get(id), expected);
  assert.deepEqual(restored.getOutput(source).document, published);
  assert.equal(restored.getOutput({ ...source, version: 1 }).document, null);
});

test('malformed operation arguments and document identity mismatch return safe domain errors', (t) => {
  const { service } = fixture(t);
  const created = create(service);
  const id = created.document.id;
  for (const method of ['create', 'get', 'save', 'publish', 'getSource', 'rotate', 'getOutput']) {
    expectError(() => service[method](null), 'SCENE_INVALID_DOCUMENT', 400);
  }
  for (const expectedRevision of [0, 1.5, '1', NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expectError(() => service.save({ id, expectedRevision, document: created.document }), 'SCENE_INVALID_REVISION', 400);
    expectError(() => service.publish({ id, expectedRevision }), 'SCENE_INVALID_REVISION', 400);
  }
  expectError(() => service.save({ id, expectedRevision: 1, document: { ...created.document, id: randomUUID() } }), 'SCENE_ID_MISMATCH', 400);
  assert.deepEqual(service.get(id), created);
  service.publish({ id, expectedRevision: 1 });
  expectError(() => service.getOutput({ ...service.getSource(id), version: '1' }), 'SCENE_INVALID_VERSION', 400);
});

test('publication snapshots shared defaults once per type and rejects account changes before commit', (t) => {
  const { service, ports, state, store } = fixture(t);
  const saved = saveItems(service, create(service), [item(), item()]);
  const id = saved.document.id;
  let calls = 0;
  const publisher = createSceneService({ ...ports, getDefaultConfig(type) {
    assert.equal(type, 'clock');
    calls += 1;
    return { color: String(calls) };
  } });
  publisher.publish({ id, expectedRevision: 2 });
  assert.equal(calls, 1);
  const output = service.getOutput(service.getSource(id));
  assert.equal(output.document.items[0].appearance.config.color, '1');
  assert.equal(output.document.items[1].appearance.config.color, '1');
  const before = store.get(state.owner.scope, id);
  const changed = createSceneService({ ...ports, getDefaultConfig() {
    state.owner.epoch += 1;
    return { color: 'red' };
  } });
  expectError(() => changed.publish({ id, expectedRevision: 2 }), 'SCENE_OWNER_CHANGED', 409);
  assert.deepEqual(store.get(state.owner.scope, id), before);
});

test('corrupt newly encrypted packages cannot create or rotate a source', (t) => {
  const { service, ports, state, store } = fixture(t);
  const id = create(service).document.id;
  const before = store.get(state.owner.scope, id);
  const broken = createSceneService({ ...ports, secretCodec: {
    ...ports.secretCodec,
    encrypt() { return 'broken new ciphertext'; },
  } });
  expectError(() => create(broken), 'SCENE_SOURCE_UNAVAILABLE', 503);
  expectError(() => broken.rotate(id), 'SCENE_SOURCE_UNAVAILABLE', 503);
  assert.equal(service.list().length, 1);
  assert.deepEqual(store.get(state.owner.scope, id), before);
});

test('output access retains active projection types without display reads or secret decryption', (t) => {
  const { ports, state } = fixture(t);
  const { normalizeBrowserSourceConfig } = require('../../public/js/shared/scene-browser-source.js');
  const service = createSceneService({ ...ports, normalizeConfig(type, config) {
    return type === 'browser' ? normalizeBrowserSourceConfig(config) : ports.normalizeConfig(type, config);
  } });
  const browser = item('browser', { appearance: { mode: 'independent', config: {
    url: 'https://widgets.example.test/display?token=private-provider', viewportWidth: 800, viewportHeight: 600,
  } } });
  const saved = saveItems(service, create(service), [item('queue'), browser]);
  const id = saved.document.id;
  service.publish({ id, expectedRevision: saved.revision });
  const source = service.getSource(id);
  const output = service.getOutput({ ...source, version: 0 });
  const active = { ...source, version: output.version, projection: output.projection };
  const replacement = saveItems(service, saved, [item('clock'), browser]);
  service.publish({ id, expectedRevision: replacement.revision });
  state.decryptFailure = true;
  state.dataCalls.length = 0;

  const access = service.getOutputAccess(active);
  assert.equal(access.version, 2);
  assert.deepEqual(access.types, ['clock', 'browser', 'queue']);
  const current = service.getOutputAccess({ ...source, version: 0 });
  assert.deepEqual(current.types, ['clock', 'browser']);
  assert.equal(current.binding, access.binding);
  assert.doesNotMatch(JSON.stringify(access), /private-provider/);
  assert.ok(!access.binding.includes(source.token));

  state.decryptFailure = false;
  const rotated = service.rotate(id);
  state.decryptFailure = true;
  expectError(() => service.getOutputAccess({ ...active, token: rotated.token }), 'SCENE_PROJECTION_EXPIRED', 403);
  const rotatedAccess = service.getOutputAccess({ ...rotated, version: 0 });
  assert.notEqual(rotatedAccess.binding, access.binding);
  state.owner.epoch++;
  assert.notEqual(service.getOutputAccess({ ...rotated, version: 0 }).binding, rotatedAccess.binding);
  assert.deepEqual(state.dataCalls, []);
});

test('output change notifications observe committed publication and rotation but skip drafts and failed writes', (t) => {
  const { ports, state, db } = fixture(t);
  const notifications = [];
  const service = createSceneService({ ...ports, onOutputChanged(event) {
    const source = service.getSource(event.id);
    notifications.push({ event, source, access: service.getOutputAccess({ ...source, version: 0 }) });
  } });
  const saved = saveItems(service, create(service), [item('queue')]);
  const id = saved.document.id;
  const original = service.getSource(id);
  assert.deepEqual(notifications, []);
  expectError(() => service.publish({ id, expectedRevision: saved.revision - 1 }), 'SCENE_CONFLICT', 409);
  assert.deepEqual(notifications, []);

  const first = service.publish({ id, expectedRevision: saved.revision });
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0].event, { id });
  assert.equal(notifications[0].access.version, first.publishedVersion);
  assert.equal(notifications[0].source.token, original.token);
  const replacement = saveItems(service, saved, [item('clock')]);
  assert.equal(notifications.length, 1);
  db.exec(`CREATE TRIGGER fail_notified_publish AFTER UPDATE OF published_json ON component_scenes
    BEGIN SELECT RAISE(ABORT, 'synthetic publication failure'); END;`);
  expectError(() => service.publish({ id, expectedRevision: replacement.revision }), 'SCENE_OPERATION_FAILED', 500);
  assert.equal(notifications.length, 1);
  db.exec('DROP TRIGGER fail_notified_publish');

  const second = service.publish({ id, expectedRevision: replacement.revision });
  assert.equal(notifications.length, 2);
  assert.equal(notifications[1].access.version, second.publishedVersion);
  assert.deepEqual(notifications[1].access.types, ['clock']);
  state.encryptFailure = true;
  expectError(() => service.rotate(id), 'SCENE_SOURCE_UNAVAILABLE', 503);
  assert.equal(notifications.length, 2);
  state.encryptFailure = false;
  const rotated = service.rotate(id);
  assert.equal(notifications.length, 3);
  assert.deepEqual(notifications[2].event, { id });
  assert.equal(notifications[2].source.token, rotated.token);
  assert.notEqual(notifications[2].source.token, original.token);
  assert.equal(notifications[2].access.version, second.publishedVersion);
  expectError(() => service.getOutputAccess({ ...original, version: 0 }), 'SCENE_ACCESS_DENIED', 403);
});
