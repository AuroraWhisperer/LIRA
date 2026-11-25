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
const { pruneUploadedMedia } = require('../../src/server/uploaded-media-retention');
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
  const text = storeTextImage(dataDir, png, 'image/png');
  const imageId = path.basename(text.imagePath, '.png');
  const entry = `${imageId}.html`;
  const web = await createComponentWebLibrary(dataDir).add([
    { path: entry, stream: Readable.from(['<html><img src="image.png"><script src="empty.js"></script></html>']) },
    { path: 'image.png', stream: Readable.from([png]) }, { path: 'empty.js', stream: Readable.from([]) },
  ], { type: 'background', entry, name: '网页背景' }, allow);
  const created = server.service.create({ title: '备份场景', canvas: { width: 1920, height: 1080 } });
  const document = { ...created.document, items: [item('gift-wishes', pack.styles[0].config),
    item('browser', { ...web.styles[0].config, styleParameters: { [`web:${web.id}`]: { outline: { width: 3 } } } }),
    item('browser', { url: 'https://provider.test/?token=SYNTHETIC_PRIVATE_TOKEN', viewportWidth: 800, viewportHeight: 600 }),
    item('text-box', { ...createTextBoxDefaults(), nodes: [{ type: 'image', name: '配图', src: text.imagePath },
      { type: 'text', text: `配图编号 ${imageId}，工单 ${randomUUID()}` }] })] };
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
  assert.equal(preview.packages, 2); assert.equal(preview.scenes, 2); assert.ok(preview.warnings.length > 0);
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
  const { url: browser, styleParameters } = scenes[0].document.items[1].appearance.config;
  assert.notEqual(browser, source.web.styles[0].config.url);
  assert.equal(styleParameters[`web:${browser.split('/')[2]}`].outline.width, 3);
  assert.equal((await fetch(`${destination.server.origin}${browser}`)).status, 200);
  const original = source.document.items.at(-1).appearance.config.nodes;
  for (const scene of scenes) {
    const nodes = scene.document.items[2].appearance.config.nodes;
    assert.equal(nodes[1].text, original[1].text);
    assert.notEqual(nodes[0].src, original[0].src);
  }
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

test('switched web styles survive backup after the previous package is reclaimed', async t => {
  const source = await fixture(t, false);
  const web = createComponentWebLibrary(source.dataDir);
  const add = name => web.add([{ path: `${name}.html`, stream: Readable.from([`<p>${name}</p>`]) }],
    { type: 'background', name, entry: `${name}.html` }, allow);
  const a = await add('A'); const b = await add('B');
  const created = source.server.service.create({ title: '更换网页样式', canvas: { width: 1280, height: 720 } });
  const browser = item('browser', { ...a.styles[0].config, styleParameters: { [`web:${a.id}`]: { outline: { width: 3 } } } });
  const document = { ...created.document, items: [browser] };
  const saved = source.server.service.save({ id: document.id, document, expectedRevision: created.revision });
  browser.appearance.config = { ...b.styles[0].config,
    styleParameters: { ...browser.appearance.config.styleParameters, [`web:${b.id}`]: { outline: { width: 5 } } } };
  const switched = source.server.service.save({ id: document.id, document, expectedRevision: saved.revision });
  source.server.service.publishCanvas({ id: document.id, expectedRevision: switched.revision, expectedPublishedVersion: 0 });
  const both = await bytes(source.transfer.backup(allow));
  source.store.removePack(a.id);
  const cleanup = await fetch(`${source.server.origin}/api/component-styles/cleanup`, { method: 'POST',
    headers: { Authorization: `Bearer ${source.server.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [a.id] }) });
  assert.equal(cleanup.status, 200);
  assert.equal(fs.existsSync(source.store.directory(a.id)), false);

  const onlyB = await bytes(source.transfer.backup(allow));
  for (const [archive, count] of [[both, 2], [onlyB, 1]]) {
    const destination = await fixture(t, false);
    const inspected = await destination.transfer.inspect(Readable.from([archive]), allow);
    assert.equal(inspected.packages, count);
    assert.equal((await destination.transfer.restore(inspected.id, allow)).created, 2);
    const packs = destination.store.list();
    const restoredB = packs.find(pack => pack.styles[0].config.url.endsWith('/B.html'));
    const historyId = count === 2 ? packs.find(pack => pack.id !== restoredB.id).id : a.id;
    assert.notEqual(restoredB.id, b.id);
    for (const { document: copy } of destination.server.service.list()) {
      const config = copy.items[0].appearance.config;
      assert.equal(config.url, restoredB.styles[0].config.url);
      assert.equal(config.styleParameters[`web:${historyId}`].outline.width, 3);
      assert.equal(config.styleParameters[`web:${restoredB.id}`].outline.width, 5);
    }
  }
});

test('literal upload and style paths require no files, while actual attachment fields do', async t => {
  const source = await fixture(t, false);
  const existing = storeTextImage(source.dataDir, png, 'image/png').imagePath;
  const missing = `/scene-text-images/${randomUUID()}.png`;
  const hidden = await createComponentWebLibrary(source.dataDir).add([
    { path: 'ink.css', stream: Readable.from(['body { color: navy }']) },
  ], { type: 'text-box', entry: 'ink.css' }, allow);
  source.store.removePack(hidden.id);
  const { cssStyle } = hidden.styles[0].config;
  const created = source.server.service.create({ title: '素材路径备忘', canvas: { width: 1280, height: 720 } });
  const config = { ...createTextBoxDefaults(), nodes: [missing, existing, cssStyle.src].map(text => ({ type: 'text', text })) };
  const document = { ...created.document, items: [item('text-box', config)] };
  let saved = source.server.service.save({ id: document.id, document, expectedRevision: created.revision });
  const preview = await source.transfer.inspect(Readable.from([await bytes(source.transfer.backup(allow))]), allow);
  assert.equal(preview.bytes, 0);
  await source.transfer.restore(preview.id, allow);
  const copy = source.server.service.list().find(scene => scene.document.id !== document.id);
  assert.deepEqual(copy.document.items[0].appearance.config.nodes, config.nodes);
  config.cssStyle = cssStyle;
  saved = source.server.service.save({ id: document.id, document, expectedRevision: saved.revision });
  const destination = await fixture(t, false);
  const styled = await destination.transfer.inspect(Readable.from([await bytes(source.transfer.backup(allow))]), allow);
  assert.equal(styled.packages, 1);
  await destination.transfer.restore(styled.id, allow);
  const restored = destination.server.service.list().map(scene => scene.document.items[0].appearance.config).find(config => config.cssStyle);
  assert.equal(restored.nodes[2].text, cssStyle.src);
  assert.notEqual(restored.cssStyle.id, cssStyle.id);
  assert.equal((await fetch(`${destination.server.origin}${restored.cssStyle.src}`)).status, 200);
  config.nodes = [{ type: 'image', name: '配图', src: missing }];
  source.server.service.save({ id: document.id, document, expectedRevision: saved.revision });
  await assert.rejects(bytes(source.transfer.backup(allow)));
});

test('an image-only backup retains its files after scene edits until the stream is cancelled', async t => {
  const source = await fixture(t, false);
  const text = storeTextImage(source.dataDir, png, 'image/png');
  const image = path.join(source.dataDir, text.imagePath);
  const now = Date.now(); const old = new Date(now - 60 * 86400000);
  fs.utimesSync(image, old, old);
  const created = source.server.service.create({ title: '图片备份', canvas: { width: 1920, height: 1080 } });
  const document = { ...created.document, items: [item('text-box', {
    ...createTextBoxDefaults(), nodes: [{ type: 'image', name: '配图', src: text.imagePath }],
  })] };
  const saved = source.server.service.save({ id: document.id, document, expectedRevision: created.revision });
  const stream = source.transfer.backup(allow); t.after(() => stream.return());
  assert.equal((await stream.next()).done, false);
  source.server.service.save({ id: document.id, document: { ...document, items: [] }, expectedRevision: saved.revision });
  const context = { system: { dataDir: source.dataDir }, scenes: source.server.service,
    componentPreviews: { visitAssetReferences() {} }, settings: { get: () => ({}) } };
  pruneUploadedMedia(context, now);
  assert.equal(fs.existsSync(image), true);
  await stream.return();
  pruneUploadedMedia(context, now + 31 * 86400000);
  assert.equal(fs.existsSync(image), false);
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
