'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { installComponentStyle } = require('../../src/server/component-style-install');
const { createComponentLibraryMaintenance } = require('../../src/server/component-library-maintenance');
const { PENDING_TTL_MS } = require('../../src/storage/component-style-files');
const { createComponentPreviewSessions } = require('../../src/server/component-preview-sessions');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');

function fixture(t) {
  const dataDir = createScratchDirectory('library-maintenance-', t);
  const store = createComponentStyleStore(dataDir);
  const references = [];
  const maintenance = createComponentLibraryMaintenance({ dataDir, visitReferences: visit => references.forEach(visit) });
  function install(version = '1.0.0') {
    const id = randomUUID();
    const pack = { id, packageId: 'test.variants', version, digest: version, name: '背景变体',
      styles: ['晨光', '暮色'].map(name => ({ id: randomUUID(), type: 'background', name,
        config: { url: `/component-web/${id}/scene.html` } })) };
    store.stage(pack);
    fs.writeFileSync(path.join(store.directory(id, true), 'asset.webp'), 'synthetic media');
    return installComponentStyle(store, id, () => {});
  }
  return { dataDir, store, references, maintenance, install };
}

test('single-category versions replace as a whole, retaining old URLs and restoring reclaimed identical packages', async t => {
  const f = fixture(t);
  const first = await f.install();
  f.store.updateConfig(first.styles[0].id, config => ({ ...config, label: '已保存参数' }));
  const second = await f.install('2.0.0');
  assert.equal(second.replaced, 1);
  assert.deepEqual(f.store.list().map(pack => pack.id), [second.id]);
  assert.ok(fs.existsSync(f.store.directory(first.id)));
  f.references.push({ css: { src: `/component-web/${first.id}/web/style.css` } });
  assert.equal(f.maintenance.inventory().entries.find(entry => entry.id === first.id).state, 'referenced');
  assert.throws(() => f.maintenance.cleanup([first.id], () => {}), { statusCode: 409 });
  f.references.length = 0;
  assert.ok(f.maintenance.cleanup([first.id], () => {}).freedBytes > 0);
  assert.equal(fs.existsSync(f.store.directory(first.id)), false);
  assert.equal(f.maintenance.cleanup([first.id], () => {}).freedBytes, 0);
  const rename = fs.renameSync; let attempts = 0;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === f.store.directory(first.id) && ++attempts === 1) {
      throw Object.assign(new Error('temporary Windows lock'), { code: 'EPERM' });
    }
    return rename(source, target);
  });
  const restored = await f.install();
  assert.equal(attempts, 2);
  assert.equal(restored.id, first.id); assert.equal(restored.restored, true);
  assert.deepEqual(restored.styles.map(style => style.id), first.styles.map(style => style.id));
  assert.equal(restored.styles[0].config.label, '已保存参数');
  assert.ok(fs.existsSync(path.join(f.store.directory(first.id), 'asset.webp')));
});

test('cleanup rechecks references and authorization and never trusts stale inventory', async t => {
  const f = fixture(t); const pack = await f.install();
  f.store.removePack(pack.id);
  assert.ok(f.maintenance.inventory().reclaimableBytes > 0);
  f.references.push({ resourceStyle: { id: pack.styles[0].id } });
  assert.throws(() => f.maintenance.cleanup([pack.id], () => {}), { statusCode: 409 });
  f.references.length = 0;
  assert.throws(() => f.maintenance.cleanup([pack.id], () => { throw new Error('revoked'); }), /revoked/);
  assert.ok(fs.existsSync(f.store.directory(pack.id)));
  const unavailable = createComponentLibraryMaintenance({ dataDir: f.dataDir, visitReferences() { throw new Error('unreadable scene'); } });
  assert.throws(() => unavailable.cleanup([pack.id], () => {}), /unreadable scene/);
  const outside = createScratchDirectory('maintenance-external-', t);
  fs.writeFileSync(path.join(outside, 'keep'), 'keep');
  fs.symlinkSync(outside, path.join(f.store.directory(pack.id), 'link'), 'junction');
  assert.throws(() => f.maintenance.cleanup([pack.id], () => {}), /链接/);
  assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'keep');
});

test('reopening reclaims expired pending files while protecting in-flight and recent imports', t => {
  const f = fixture(t);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of ids) {
    f.store.stage({ id, styles: [{ id: randomUUID(), type: 'clock' }] });
  }
  const old = new Date(Date.now() - PENDING_TTL_MS - 1000);
  for (const id of ids.slice(0, 2)) fs.utimesSync(f.store.directory(id, true), old, old);
  f.store.beginPending(ids[1]);
  try {
    createComponentStyleStore(f.dataDir);
    assert.equal(fs.existsSync(f.store.directory(ids[0], true)), false);
    assert.ok(fs.existsSync(f.store.directory(ids[1], true)));
    assert.ok(fs.existsSync(f.store.directory(ids[2], true)));
  } finally { f.store.endPending(ids[1]); }
});

test('an interrupted cleanup keeps a retryable quarantine and never follows external directories', async t => {
  const f = fixture(t); const pack = await f.install(); f.store.removePack(pack.id);
  const rm = fs.rmSync;
  const locked = t.mock.method(fs, 'rmSync', (target, options) => {
    if (target === path.join(f.store.root, `.purged-${pack.id}`)) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    return rm(target, options);
  });
  assert.deepEqual(f.maintenance.cleanup([pack.id], () => {}).failed, [pack.id]);
  assert.equal(f.maintenance.inventory().entries[0].state, 'reclaimable');
  locked.mock.restore();
  assert.ok(f.maintenance.cleanup([pack.id], () => {}).freedBytes > 0);
  assert.equal(f.maintenance.inventory().entries[0].state, 'reclaimed');
});

test('all account drafts and publications are decoded for retention; active preview commands also protect assets', async t => {
  const f = fixture(t); const pack = await f.install(); f.store.removePack(pack.id);
  const canvas = await startCanvasOutputFixture({ dataDir: f.dataDir }); t.after(() => canvas.close());
  const scene = canvas.service.create({ title: '其他账号', canvas: { width: 1920, height: 1080 } });
  const document = { ...scene.document, items: [{ id: randomUUID(), type: 'browser', name: '网页素材',
    x: 0, y: 0, width: 800, height: 600, visible: true, locked: false,
    appearance: { mode: 'independent', config: { url: `/component-web/${pack.id}/scene.html`, viewportWidth: 800, viewportHeight: 600 } } }] };
  const saved = canvas.service.save({ id: document.id, expectedRevision: scene.revision, document });
  canvas.service.publish({ id: document.id, expectedRevision: saved.revision });
  canvas.service.save({ id: document.id, expectedRevision: saved.revision, document: scene.document });
  canvas.owner.scope = 'second-owner'; canvas.owner.epoch++;
  const maintenance = createComponentLibraryMaintenance({ dataDir: f.dataDir, visitReferences: visit => canvas.service.visitAssetReferences(visit) });
  assert.equal(maintenance.inventory().entries[0].state, 'referenced');
  assert.throws(() => maintenance.cleanup([pack.id], () => {}), { statusCode: 409 });
  const previews = createComponentPreviewSessions();
  const session = previews.open({ component: 'canvas', state: { draft: { document: scene.document }, saved: { document: scene.document }, generation: 1, loaded: true } });
  const attachmentId = randomUUID();
  previews.browser({ id: session.id, action: 'attach', attachmentId, previousAttachmentId: null }, session.token);
  previews.browser({ id: session.id, attachmentId, action: 'edit', change: { document } }, session.token);
  const draftMaintenance = createComponentLibraryMaintenance({ dataDir: f.dataDir, visitReferences: visit => previews.visitAssetReferences(visit) });
  assert.equal(draftMaintenance.inventory().entries[0].state, 'referenced');
  previews.open({ component: 'canvas', state: { draft: { document: scene.document }, saved: { document: scene.document },
    generation: 2, loaded: true, presets: [{ id: randomUUID(), title: '后台未保存预设', dirty: true }] } });
  assert.throws(() => draftMaintenance.cleanup([pack.id], () => {}), { statusCode: 503 });
});
