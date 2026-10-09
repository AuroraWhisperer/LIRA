'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');
const { createComponentLibraryTransfer } = require('../../src/server/component-library-transfer');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { createComponentStyleLibrary } = require('../../src/server/component-style-library');
const { createComponentWebLibrary } = require('../../src/server/component-web-library');
const { storeTextImage } = require('../../src/server/scene-text-images');
const { createStoredStyleZip } = require('../../scripts/component-style-zip');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const webp = fs.readFileSync(path.resolve(__dirname, '../../public/img/component-previews/clock-moonlit-fan.webp'));
const allow = () => {};
const bytes = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); };
const item = (type, config, name = type) => ({ id: randomUUID(), type, name, x: 0, y: 0, width: 320, height: 180,
  visible: true, locked: false, appearance: { mode: 'independent', config } });

async function fixture(t, withContents = true) {
  const dataDir = createScratchDirectory('library-transfer-', t);
  const server = await startCanvasOutputFixture({ dataDir }); t.after(() => server.close());
  const library = createComponentStyleLibrary(dataDir); const store = createComponentStyleStore(dataDir);
  const transfer = createComponentLibraryTransfer({ dataDir, scenes: server.service });
  if (!withContents) return { dataDir, server, library, store, transfer };
  const manifest = { schemaVersion: 2, id: 'test.transfer', version: '1.0.0', name: '配套许愿', styles: [{
    type: 'gift-wishes', name: '许愿', preset: 'moonlit-wishes', width: 640, height: 143, preview: 'frame.webp',
    resources: { '/img/shared/gift-wish-moonlit.webp': 'frame.webp', '/img/shared/gift-wish-moonlit-start.svg': 'star.svg' },
  }] };
  const archive = createStoredStyleZip(new Map([['lira-pack.json', Buffer.from(JSON.stringify(manifest))],
    ['frame.webp', webp], ['star.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]]));
  const inspected = await library.inspect(Readable.from([archive]), allow, 'gift-wishes');
  const pack = await library.install(inspected.id, allow, 'gift-wishes');
  library.config({ id: pack.styles[0].id, patch: { limit: 4, gap: 20 } });
  const web = await createComponentWebLibrary(dataDir).add([
    { path: 'scene.html', stream: Readable.from(['<html><img src="image.png"><script src="empty.js"></script></html>']) },
    { path: 'image.png', stream: Readable.from([png]) }, { path: 'empty.js', stream: Readable.from([]) },
  ], { type: 'background', entry: 'scene.html', name: '网页背景' }, allow);
  const text = storeTextImage(dataDir, png, 'image/png');
  const created = server.service.create({ title: '备份场景', canvas: { width: 1920, height: 1080 } });
  const document = { ...created.document, items: [item('gift-wishes', pack.styles[0].config), item('browser', web.styles[0].config),
    item('browser', { url: 'https://provider.test/?token=SYNTHETIC_PRIVATE_TOKEN', viewportWidth: 800, viewportHeight: 600 }),
    item('text-box', { ...createTextBoxDefaults(), nodes: [{ type: 'image', name: '配图', src: text.imagePath }] })] };
  const saved = server.service.save({ id: document.id, document, expectedRevision: created.revision });
  server.service.publishCanvas({ id: document.id, expectedRevision: saved.revision, expectedPublishedVersion: 0 });
  return { dataDir, server, library, store, transfer, pack, web, document };
}

test('portable backup restores current parameters, media, local HTML and text images into a different data directory', async t => {
  const source = await fixture(t); const destination = await fixture(t, false);
  const archive = await bytes(source.transfer.backup(allow));
  assert.equal(archive.includes(Buffer.from('SYNTHETIC_PRIVATE_TOKEN')), false);
  assert.equal(archive.includes(Buffer.from('capability')), false);
  const before = destination.server.service.create({ title: '当前直播', canvas: { width: 1920, height: 1080 } });
  destination.server.service.publishCanvas({ id: before.document.id, expectedRevision: before.revision, expectedPublishedVersion: 0 });
  const binding = destination.server.service.getCanvas(); const token = destination.server.service.getSource(before.document.id).token;
  const preview = await destination.transfer.inspect(Readable.from([archive]), allow);
  assert.equal(preview.packages, 2); assert.equal(preview.scenes, 2); assert.match(preview.warnings.join(''), /外部浏览器源/);
  assert.deepEqual(destination.store.list(), []);
  const restored = await destination.transfer.restore(preview.id, allow);
  assert.equal(restored.created, 2);
  assert.deepEqual(destination.server.service.getCanvas(), binding);
  assert.equal(destination.server.service.getSource(before.document.id).token, token);
  const scenes = destination.server.service.list().filter(record => record.document.id !== before.document.id);
  assert.ok(scenes.every(scene => scene.publishedVersion === 0 && scene.document.items.length === 3));
  const resource = destination.store.list().flatMap(pack => pack.styles).find(style => style.type === 'gift-wishes');
  assert.equal(resource.config.limit, 4); assert.equal(resource.config.gap, 20);
  assert.notEqual(resource.id, source.pack.styles[0].id);
  assert.equal(scenes[0].document.items[0].appearance.config.resourceStyle.id, resource.id);
  const browser = scenes[0].document.items[1].appearance.config.url;
  assert.notEqual(browser, source.web.styles[0].config.url);
  assert.equal((await fetch(`${destination.server.origin}${browser}`)).status, 200);
  const image = scenes[0].document.items[2].appearance.config.nodes[0].src;
  assert.deepEqual(Buffer.from(await (await fetch(`${destination.server.origin}${image}`)).arrayBuffer()), png);
  const again = await destination.transfer.inspect(Readable.from([archive]), allow);
  assert.equal((await destination.transfer.restore(again.id, allow)).existing, 2);
  assert.equal(destination.server.service.list().length, 3); assert.equal(destination.store.list().length, 2);
  const roundTrip = await bytes(destination.transfer.backup(allow));
  const final = await fixture(t, false);
  const roundPreview = await final.transfer.inspect(Readable.from([roundTrip]), allow);
  assert.equal(roundPreview.packages, 2);
  await final.transfer.restore(roundPreview.id, allow);
  assert.equal(final.store.list().flatMap(pack => pack.styles).find(style => style.type === 'gift-wishes').config.limit, 4);
});

test('backup stays within the current account and restoration rechecks owner and staged file integrity', async t => {
  const source = await fixture(t); const destination = await fixture(t, false);
  const archive = await bytes(source.transfer.backup(allow));
  source.server.owner.scope = 'different-account'; source.server.owner.epoch++;
  const otherArchive = await bytes(source.transfer.backup(allow));
  const other = await destination.transfer.inspect(Readable.from([otherArchive]), allow);
  assert.equal(other.scenes, 0); destination.store.removePending(other.id);
  const inspected = await destination.transfer.inspect(Readable.from([archive]), allow);
  destination.server.owner.epoch++;
  await assert.rejects(destination.transfer.restore(inspected.id, allow), { statusCode: 409 });
  assert.deepEqual(destination.store.list(), []);
  const current = await destination.transfer.inspect(Readable.from([archive]), allow);
  const directory = destination.store.directory(current.id, true);
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'restore.json')));
  const target = path.join(directory, receipt.manifest.files[0].name);
  const damaged = fs.readFileSync(target); damaged[damaged.length - 1] ^= 1; fs.writeFileSync(target, damaged);
  await assert.rejects(destination.transfer.restore(current.id, allow));
  assert.deepEqual(destination.store.list(), []); assert.deepEqual(destination.server.service.list(), []);
});

test('failed scene restore is retryable and never publishes or duplicates partially restored data', async t => {
  const source = await fixture(t); const destination = await fixture(t, false);
  const archive = await bytes(source.transfer.backup(allow));
  const inspected = await destination.transfer.inspect(Readable.from([archive]), allow);
  const mocked = t.mock.method(destination.server.service, 'restoreBackup', () => { throw new Error('synthetic database failure'); });
  await assert.rejects(destination.transfer.restore(inspected.id, allow), /synthetic database failure/);
  assert.deepEqual(destination.store.list(), []); assert.deepEqual(destination.server.service.list(), []);
  mocked.mock.restore();
  assert.equal((await destination.transfer.restore(inspected.id, allow)).created, 2);
  assert.equal(destination.store.list().length, 2); assert.equal(destination.server.service.list().length, 2);
});

test('restoration tolerates temporary Windows locks before committing the package batch', async t => {
  const source = await fixture(t); const destination = await fixture(t, false);
  const inspected = await destination.transfer.inspect(Readable.from([await bytes(source.transfer.backup(allow))]), allow);
  const rename = fs.renameSync; const attempts = new Map();
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (from.includes('.pending-')) {
      const count = attempts.get(from) || 0; attempts.set(from, count + 1);
      if (!count) throw Object.assign(new Error('temporary lock'), { code: 'EPERM' });
    }
    return rename(from, to);
  });
  assert.equal((await destination.transfer.restore(inspected.id, allow)).created, 2);
  assert.deepEqual([...attempts.values()], [2, 2]);
});

test('malformed archives and permission loss leave no staged backup or installed files', async t => {
  const source = await fixture(t); const destination = await fixture(t, false);
  const bad = createStoredStyleZip(new Map([['../escape.png', png]]));
  await assert.rejects(destination.transfer.inspect(Readable.from([bad]), allow));
  const archive = await bytes(source.transfer.backup(allow));
  await assert.rejects(destination.transfer.inspect(Readable.from([archive]), () => { throw new Error('revoked'); }), /revoked/);
  assert.equal(fs.readdirSync(destination.store.root).length, 0);
  assert.deepEqual(destination.store.list(), []);
});

test('backup HTTP entry streams an authenticated ZIP and rejects anonymous or obsolete canvas access', async t => {
  const f = await fixture(t);
  for (const action of ['inventory', 'cleanup', 'backup', 'inspect-backup', 'restore-backup']) {
    const response = await fetch(`${f.server.origin}/api/component-styles/${action}`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401, action);
    const canvas = await fetch(`${f.server.origin}/api/component-preview/styles/${action}?id=${randomUUID()}&attachmentId=${randomUUID()}`,
      { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(64)}` }, body: '{}' });
    assert.ok([403, 410].includes(canvas.status), action);
  }
  const response = await fetch(`${f.server.origin}/api/component-styles/backup`, { method: 'POST',
    headers: { Authorization: `Bearer ${f.server.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/zip');
  assert.ok((await response.arrayBuffer()).byteLength > png.length);
});
