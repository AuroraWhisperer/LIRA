'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCipheriv, createDecipheriv, randomBytes, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { normalizeBrowserSourceConfig, BROWSER_SOURCE_DEFAULTS } = require('../../public/js/shared/scene-browser-source.js');
const { normalizeSceneDocument } = require('../../src/scenes/scene-contract');
const { normalizeSceneConfig, createSceneComponentPorts } = require('../../src/server/scene-components');
const { createSceneService } = require('../../src/scenes/scene-service');
const { createSceneStore } = require('../../src/storage/scene-store');
const { migrateScenes, migrateComponentOutputSizes, migrateCanvasPresets } = require('../../src/storage/scene-migration');

const sourceUrl = 'https://overlay.example.test/widget?token=private-provider-capability#session=private-fragment';
const sourceConfig = () => ({ ...BROWSER_SOURCE_DEFAULTS, url: sourceUrl });
const sourceItem = () => ({ id: randomUUID(), type: 'browser', name: '外部浏览器源',
  x: 80, y: 40, width: 400, height: 300, visible: true, locked: false,
  appearance: { mode: 'independent', config: sourceConfig() } });

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  migrateScenes(db); migrateComponentOutputSizes(db);
  migrateCanvasPresets(db);
  const owner = { scope: 'synthetic-browser-source-owner', epoch: 1 };
  const state = { available: true, failEncrypt: false, failDecrypt: false };
  const key = randomBytes(32);
  const secretCodec = {
    isAvailable: () => state.available,
    encrypt(value) {
      if (state.failEncrypt) throw new Error('private encryption failure');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64');
    },
    decrypt(value) {
      if (state.failDecrypt) throw new Error('private decryption failure');
      const bytes = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  const store = createSceneStore(db);
  const ports = { store, getOwner: () => owner, secretCodec,
    ...createSceneComponentPorts({ getState: () => ({}) }) };
  const service = createSceneService(ports);
  const created = service.create({ title: '浏览器源场景', canvas: { width: 1920, height: 1080 } });
  const document = { ...created.document, items: [sourceItem()] };
  return { db, store, service, state, owner, ports, document, created };
}

test('browser config accepts provider capability URLs and rejects unsafe URLs, extra fields and invalid viewports', () => {
  assert.deepEqual(normalizeBrowserSourceConfig(sourceConfig()), sourceConfig());
  assert.deepEqual(normalizeBrowserSourceConfig(BROWSER_SOURCE_DEFAULTS, { allowEmptyUrl: true }), BROWSER_SOURCE_DEFAULTS);
  for (const url of ['', '/local', 'https:example.test', 'javascript:alert(1)', 'data:text/html,hello', 'file:///C:/private',
    'https://user:password@example.test/source', 'https://example.test/\nsecret', 'https://example.test/' + 'x'.repeat(8192)]) {
    assert.throws(() => normalizeBrowserSourceConfig({ ...sourceConfig(), url }), { code: 'INVALID_SCENE_CONFIG' });
  }
  for (const size of [0, 31, 7681, 32.5, Infinity, '800']) {
    for (const field of ['viewportWidth', 'viewportHeight']) {
      assert.throws(() => normalizeBrowserSourceConfig({ ...sourceConfig(), [field]: size }), { code: 'INVALID_SCENE_CONFIG' });
    }
  }
  assert.throws(() => normalizeBrowserSourceConfig({ ...sourceConfig(), token: 'unexpected' }));
  assert.equal(normalizeBrowserSourceConfig({ ...sourceConfig(), url: 'http://127.0.0.1:1234/source' }).url, 'http://127.0.0.1:1234/source');
});

test('applying a browser preset rebinds encrypted URLs to the persistent output without changing either draft', t => {
  const { service, store, owner, created, state } = fixture(t);
  const binding = service.getCanvas();
  const source = service.getSource(binding.outputId);
  service.publishCanvas({ id: created.document.id, expectedRevision: 1, expectedPublishedVersion: 0 });
  const second = service.create({ title: '第二预设', canvas: created.document.canvas });
  const saved = service.save({ id: second.document.id, expectedRevision: 1,
    document: { ...second.document, items: [sourceItem()] } });
  state.failEncrypt = true;
  assert.throws(() => service.publishCanvas({ id: second.document.id, expectedRevision: saved.revision, expectedPublishedVersion: 1 }));
  assert.equal(service.getCanvas().activeSceneId, created.document.id);
  state.failEncrypt = false;
  service.publishCanvas({ id: second.document.id, expectedRevision: saved.revision, expectedPublishedVersion: 1 });
  assert.equal(service.getOutput({ ...source, version: 0 }).document.items[0].appearance.config.url, sourceUrl);
  assert.equal(service.get(second.document.id).document.items[0].appearance.config.url, sourceUrl);
  assert.deepEqual(service.get(created.document.id).document, created.document);
  assert.doesNotMatch(JSON.stringify(store.list(owner.scope)), /private-provider-capability|private-fragment/);
});

test('browser scenes are independent and source viewport is distinct from item geometry', t => {
  const { document } = fixture(t);
  assert.deepEqual(normalizeSceneDocument(document, { normalizeConfig: normalizeSceneConfig }), document);
  document.items[0].appearance = { mode: 'shared' };
  assert.throws(() => normalizeSceneDocument(document, { normalizeConfig: normalizeSceneConfig }), { code: 'SCENE_INVALID_DOCUMENT' });
});

test('browser source save, publish and reopen encrypt URLs at rest and preserve authorized output', t => {
  const { service, store, owner, ports, document, created } = fixture(t);
  const saved = service.save({ id: document.id, expectedRevision: created.revision, document });
  assert.equal(saved.document.items[0].appearance.config.url, sourceUrl);
  const publication = service.publish({ id: document.id, expectedRevision: saved.revision });
  assert.equal(publication.publishedVersion, 1);
  const stored = store.get(owner.scope, document.id);
  for (const value of [stored.document, stored.publishedDocument]) {
    assert.doesNotMatch(JSON.stringify(value), /overlay\.example|private-provider-capability|private-fragment/);
    assert.equal(typeof value.items[0].appearance.config.url.encrypted, 'string');
  }
  const reopened = createSceneService(ports);
  assert.deepEqual(reopened.get(document.id).document, document);
  assert.deepEqual(reopened.list()[0].document, document);
  const source = reopened.getSource(document.id);
  const output = reopened.getOutput({ ...source, version: 0 });
  assert.deepEqual(output.document, document);
  assert.deepEqual(output.data, {});
  const single = reopened.getOutput({ ...source, version: 0, item: document.items[0].id });
  assert.deepEqual(single.document.canvas, { width: 400, height: 300 });
  assert.deepEqual(single.document.items[0].appearance.config, sourceConfig());
  assert.equal(single.document.items[0].x, 0);
  assert.equal(single.document.items[0].y, 0);
});

test('invalid or unprotectable browser changes preserve the saved and published versions', t => {
  const { service, store, owner, state, document, created } = fixture(t);
  const saved = service.save({ id: document.id, expectedRevision: created.revision, document });
  service.publish({ id: document.id, expectedRevision: saved.revision });
  const before = store.get(owner.scope, document.id);
  const incomplete = structuredClone(document); incomplete.items[0].appearance.config.url = '';
  assert.throws(() => service.save({ id: document.id, expectedRevision: saved.revision, document: incomplete }), { code: 'SCENE_INVALID_DOCUMENT' });
  for (const field of ['failEncrypt', 'failDecrypt']) {
    state[field] = true;
    assert.throws(() => service.save({ id: document.id, expectedRevision: saved.revision, document }), { code: 'SCENE_BROWSER_SOURCE_UNAVAILABLE' });
    assert.throws(() => service.publish({ id: document.id, expectedRevision: saved.revision }), { code: 'SCENE_BROWSER_SOURCE_UNAVAILABLE' });
    assert.deepEqual(store.get(owner.scope, document.id), before);
    state[field] = false;
  }
});

test('browser output checks authorization before decrypting and unchanged polls do not decrypt URL snapshots', t => {
  const { service, state, document, created } = fixture(t);
  const saved = service.save({ id: document.id, expectedRevision: created.revision, document });
  service.publish({ id: document.id, expectedRevision: saved.revision });
  const source = service.getSource(document.id);
  state.failDecrypt = true;
  assert.throws(() => service.getOutput({ ...source, token: 'wrong', version: 0 }), { code: 'SCENE_ACCESS_DENIED' });
  assert.equal(service.getOutput({ ...source, version: 1 }).document, null);
  assert.throws(() => service.getOutput({ ...source, version: 0 }), { code: 'SCENE_BROWSER_SOURCE_UNAVAILABLE' });
});

test('encrypted browser URLs cannot be rebound to a different scene or item', t => {
  const { service, store, db, owner, document, created } = fixture(t);
  service.save({ id: document.id, expectedRevision: created.revision, document });
  const original = store.get(owner.scope, document.id).document;
  const source = service.getSource(document.id);
  for (const mutate of [(value) => { value.id = randomUUID(); }, (value) => { value.items[0].id = randomUUID(); }]) {
    const changed = structuredClone(original); mutate(changed);
    db.prepare('UPDATE component_scenes SET draft_json = ? WHERE id = ?').run(JSON.stringify(changed), document.id);
    assert.throws(() => service.get(document.id), { code: 'SCENE_BROWSER_SOURCE_UNAVAILABLE' });
  }
  assert.notEqual(service.rotate(document.id).token, source.token, 'a broken provider URL does not prevent scene capability revocation');
});
