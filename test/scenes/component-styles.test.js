'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { crc32 } = require('node:zlib');
const { PassThrough, Readable } = require('node:stream');
const { createComponentStyleLibrary } = require('../../src/server/component-style-library');
const { receiveMedia } = require('../../src/server/component-media-files');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { normalizeMediaStyle } = require('../../public/js/shared/component-media-style.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

function zip(entries) {
  const local = []; const central = []; let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name); const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 6);
    header.copy(directory, 16, 14, 26); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename); local.push(header, filename, bytes); offset += header.length + filename.length + bytes.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

async function fixture(t) {
  const dataDir = createScratchDirectory('component-styles-test-', t);
  const server = await startComponentPreviewServer({ dataDir }); t.after(server.close);
  async function request(action, body, token = server.token) {
    const file = Buffer.isBuffer(body);
    const response = await fetch(`${server.origin}/api/component-styles/${action}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file ? 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : file ? body : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  return { ...server, dataDir, request };
}

test('all media style types import, normalize and survive library deletion and restart', async t => {
  const f = await fixture(t);
  for (const type of ['background', 'opening', 'clock', 'danmaku', 'gift-wishes', 'gift-frame', 'guard-thanks']) {
    const description = { type, filename: 'frame.png', name: `${type} style`, width: 640, height: 480 };
    const result = await f.request(`add?description=${encodeURIComponent(JSON.stringify(description))}`, png);
    assert.equal(result.status, 200, `${type}: ${result.error}`);
    const style = result.data.styles[0];
    assert.deepEqual(normalizeSceneConfig(type, style.config), style.config);
    const source = style.config.mediaStyle.src;
    const range = await fetch(`${f.origin}${source}`, { headers: { Range: 'bytes=4-9' } });
    assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), png.subarray(4, 10));
    assert.equal((await f.request('remove', { id: style.id })).status, 200);
    assert.ok(!createComponentStyleStore(f.dataDir).list().flatMap(pack => pack.styles).some(entry => entry.id === style.id));
    assert.equal((await fetch(`${f.origin}${source}`)).status, 200, 'Existing scene snapshots retain their files.');
  }
});

test('ZIP imports reject the wrong entry with directions and recheck the target before installation', async t => {
  const f = await fixture(t);
  const store = createComponentStyleStore(f.dataDir);
  for (const [types, target, wrongTargets, guidance] of [
    [['background', 'clock'], 'suite', ['background', 'clock'], /添加组件 → 套装 → 导入套装/],
    [['background', 'background'], 'background', ['suite', 'clock'], /添加组件 → 背景 → 添加样式/],
    [['clock'], 'clock', ['background', 'suite'], /添加组件 → 时钟 → 添加样式/],
  ]) {
    const manifest = { schemaVersion: 1, id: `test.entry-${target}`, name: '入口测试', version: '1.0.0',
      styles: types.map(type => ({ type, name: type, file: 'frame.png', width: 640, height: 360 })) };
    const bytes = zip([['lira-pack.json', JSON.stringify(manifest)], ['frame.png', png]]);
    const before = store.read();
    for (const wrong of [undefined, '', 'invalid', ...wrongTargets]) {
      const rejected = await f.request(wrong === undefined ? 'inspect' : `inspect?target=${wrong}`, bytes);
      assert.equal(rejected.status, 400, String(wrong));
      if (wrongTargets.includes(wrong)) assert.match(rejected.error, guidance);
      else assert.match(rejected.error, /导入入口/);
      assert.deepEqual(store.read(), before);
      assert.equal(fs.existsSync(store.root) && fs.readdirSync(store.root).some(name => name.startsWith('.pending-')), false);
    }
    const preview = await f.request(`inspect?target=${target}`, bytes);
    assert.equal(preview.status, 200, preview.error);
    assert.equal(preview.data.isSuite, target === 'suite');
    for (const wrong of [undefined, '', 'invalid', ...wrongTargets]) {
      const rejected = await f.request('install', { id: preview.data.id, target: wrong });
      assert.equal(rejected.status, 400, String(wrong));
      if (wrongTargets.includes(wrong)) assert.match(rejected.error, guidance);
      else assert.match(rejected.error, /导入入口/);
      assert.deepEqual(store.read(), before);
      assert.ok(fs.existsSync(store.directory(preview.data.id, true)));
    }
    const installed = await f.request('install', { id: preview.data.id, target });
    assert.equal(installed.status, 200, installed.error);
    assert.equal(installed.data.styles.length, types.length);
  }
});

test('standard ZIP previews without installation, commits atomically and recognizes duplicate versions', async t => {
  const f = await fixture(t);
  const manifest = { schemaVersion: 1, id: 'test.suite', name: '测试套装', version: '1.0.0',
    styles: [{ type: 'clock', name: '时钟', file: 'assets/frame.png', width: 600, height: 300 },
      { type: 'danmaku', name: '弹幕', file: 'assets/frame.png', width: 400, height: 600 }] };
  const bytes = zip([['lira-pack.json', JSON.stringify(manifest)], ['assets/frame.png', png], ['说明.txt', '安装说明']]);
  const preview = await f.request('inspect?target=suite', bytes);
  assert.equal(preview.status, 200, preview.error);
  assert.equal(preview.data.styles.length, 2);
  assert.deepEqual((await f.request('list')).data, []);
  const committed = await f.request('install', { id: preview.data.id, target: 'suite' });
  assert.equal(committed.status, 200, committed.error);
  const second = await f.request('inspect?target=suite', bytes);
  assert.equal((await f.request('install', { id: second.data.id, target: 'suite' })).data.alreadyInstalled, true);
  assert.equal((await f.request('list')).data.length, 1);
  const cancelled = await f.request('inspect?target=suite', bytes);
  await f.request('cancel', { id: cancelled.data.id });
  assert.ok(!fs.existsSync(createComponentStyleStore(f.dataDir).directory(cancelled.data.id, true)));
});

test('whole suites remove and restore without duplicating packages or invalidating scene media', async t => {
  const f = await fixture(t);
  const manifest = { schemaVersion: 1, id: 'test.lifecycle', name: '整套管理', version: '1.0.0',
    styles: ['clock', 'background'].map(type => ({ type, name: type, file: 'frame.png', width: 640, height: 360 })) };
  const bytes = zip([['lira-pack.json', JSON.stringify(manifest)], ['frame.png', png]]);
  const { data: preview } = await f.request('inspect?target=suite', bytes);
  assert.equal(preview.isSuite, true);
  const { data: installed } = await f.request('install', { id: preview.id, target: 'suite' });
  await f.request('remove', { id: installed.styles[0].id });
  assert.equal((await f.request('list')).data[0].isSuite, true, 'Legacy member removal must not change suite classification.');
  assert.equal((await f.request('remove-pack', { id: installed.id }, '')).status, 401);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await f.request('remove-pack', { id: installed.id })).status, 200);
    assert.deepEqual((await f.request('list')).data, []);
  }
  for (const style of installed.styles) assert.equal((await fetch(`${f.origin}${style.config.mediaStyle.src}`)).status, 200);
  const restore = await f.request('inspect?target=suite', bytes);
  const result = await f.request('install', { id: restore.data.id, target: 'suite' });
  assert.equal(result.data.restored, true);
  assert.equal(result.data.id, installed.id);
  assert.deepEqual(result.data.styles, installed.styles);
  const store = createComponentStyleStore(f.dataDir);
  assert.equal(store.read().packages.length, 1);
  assert.equal(store.list()[0].styles.length, 2);
  assert.equal((await f.request('remove-pack', { id: randomUUID() })).status, 404);
});

test('suite updates replace old versions by package identity, including reduced membership and legacy parallel versions', async t => {
  const f = await fixture(t);
  const manifest = { schemaVersion: 1, id: 'test.updates', name: '更新套装', version: '1.0.0',
    styles: ['clock', 'background'].map(type => ({ type, name: type, file: 'frame.png', width: 640, height: 360 })) };
  const inspect = () => f.request('inspect?target=suite', zip([['lira-pack.json', JSON.stringify(manifest)], ['frame.png', png]]));
  const original = await inspect();
  await f.request('install', { id: original.data.id, target: 'suite' });
  const store = createComponentStyleStore(f.dataDir);
  // Simulate the previous client's concurrently installed versions.
  const index = store.read();
  index.packages.push({ ...index.packages[0], id: randomUUID(), version: '1.1.0' });
  fs.writeFileSync(path.join(store.root, 'index.json'), JSON.stringify(index));
  manifest.id = 'test.unrelated';
  const unrelated = await inspect();
  await f.request('install', { id: unrelated.data.id, target: 'suite' });
  manifest.id = 'test.updates'; manifest.version = '2.0.0'; manifest.styles.pop();
  const wrongEntry = await f.request('inspect?target=clock', zip([['lira-pack.json', JSON.stringify(manifest)], ['frame.png', png]]));
  assert.equal(wrongEntry.status, 400);
  assert.match(wrongEntry.error, /添加组件 → 套装 → 导入套装/);
  const update = await inspect();
  assert.equal(update.data.isSuite, true, 'An existing suite may reduce to one component type.');
  assert.deepEqual(update.data.replaces.map(pack => pack.version), ['1.0.0', '1.1.0']);
  assert.equal((await f.request('list')).data.length, 3, 'Inspect must not retire installed versions.');
  const wrongInstall = await f.request('install', { id: update.data.id, target: 'clock' });
  assert.equal(wrongInstall.status, 400);
  assert.match(wrongInstall.error, /添加组件 → 套装 → 导入套装/);
  assert.equal((await f.request('list')).data.length, 3);
  const result = await f.request('install', { id: update.data.id, target: 'suite' });
  assert.equal(result.data.replaced, 2);
  assert.deepEqual(store.list().map(pack => pack.id), [unrelated.data.id, result.data.id]);
  assert.equal(store.list()[1].isSuite, true);
  assert.equal((await fetch(`${f.origin}${original.data.styles[0].config.mediaStyle.src}`)).status, 200);
  const duplicate = await inspect();
  assert.equal((await f.request('install', { id: duplicate.data.id, target: 'suite' })).data.alreadyInstalled, true);
  manifest.styles[0].name = '同版本内容修改';
  const conflict = await inspect();
  assert.equal((await f.request('install', { id: conflict.data.id, target: 'suite' })).status, 409);
  assert.deepEqual(store.list().map(pack => pack.id), [unrelated.data.id, result.data.id]);
  await f.request('cancel', { id: conflict.data.id });
  const restore = await f.request('inspect?target=suite', zip([['lira-pack.json', JSON.stringify({ ...manifest, name: '更新套装',
    version: '1.0.0', styles: ['clock', 'background'].map(type => ({ type, name: type, file: 'frame.png', width: 640, height: 360 })) })], ['frame.png', png]]));
  const restored = await f.request('install', { id: restore.data.id, target: 'suite' });
  assert.equal(restored.data.id, original.data.id);
  assert.equal(restored.data.replaced, 1);
  assert.equal(restored.data.restored, true);
});

for (const revoke of [false, true]) test(`suite installation rechecks authorization after a temporary rename lock (revoke=${revoke})`, async t => {
  const directory = createScratchDirectory('suite-rename-', t);
  const store = createComponentStyleStore(directory);
  const library = createComponentStyleLibrary(directory);
  const pack = { id: randomUUID(), styles: [{ id: randomUUID(), type: 'clock' }] };
  store.stage(pack);
  const rename = fs.renameSync;
  let attempts = 0;
  let checks = 0;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (source === store.directory(pack.id, true) && ++attempts === 1) {
      throw Object.assign(new Error('Temporary Windows file lock'), { code: 'EPERM', syscall: 'rename', path: source, dest: target });
    }
    return rename(source, target);
  });
  const installation = library.install(pack.id, () => {
    checks++;
    assert.deepEqual(store.list(), [], 'Retry must precede index mutation.');
    if (revoke && checks > 1) throw Object.assign(new Error('Preview expired'), { statusCode: 410 });
  });
  if (revoke) {
    await assert.rejects(installation, { statusCode: 410 });
    assert.equal(attempts, 1);
    assert.deepEqual(store.list(), []);
    assert.ok(fs.existsSync(store.directory(pack.id, true)));
  } else {
    assert.equal((await installation).id, pack.id);
    assert.equal(attempts, 2);
    assert.equal(store.list().length, 1);
    assert.ok(!fs.existsSync(store.directory(pack.id, true)));
  }
  assert.equal(checks, 2);
});

test('temporary index locks preserve one atomic write during install and removal', async t => {
  const directory = createScratchDirectory('suite-index-lock-', t);
  const store = createComponentStyleStore(directory);
  const library = createComponentStyleLibrary(directory);
  const pack = { id: randomUUID(), styles: [{ id: randomUUID(), type: 'clock' }] };
  store.stage(pack);
  const rename = fs.renameSync;
  const attempts = new Map();
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === path.join(store.root, 'index.json')) {
      const count = (attempts.get(source) || 0) + 1;
      attempts.set(source, count);
      if (count === 1) throw Object.assign(new Error('Temporary index lock'), { code: 'EPERM' });
    }
    return rename(source, target);
  });
  await library.install(pack.id);
  assert.equal(store.list()[0].styles.length, 1);
  store.remove(pack.styles[0].id);
  assert.equal(store.list()[0].styles.length, 0);
  assert.equal(store.read().packages.length, 1);
  assert.deepEqual([...attempts.values()], [2, 2], 'Each prepared index is renamed again without replaying its transaction.');
});

test('failed suite index commit preserves the old version and leaves the new import retryable', async t => {
  const directory = createScratchDirectory('suite-atomic-', t);
  const store = createComponentStyleStore(directory);
  const library = createComponentStyleLibrary(directory);
  const pack = { id: randomUUID(), packageId: 'test.atomic', version: '1.0.0', digest: 'old',
    styles: [{ id: randomUUID(), type: 'clock' }, { id: randomUUID(), type: 'background' }] };
  store.stage(pack); await library.install(pack.id);
  const next = { ...pack, id: randomUUID(), version: '2.0.0', digest: 'new' };
  store.stage(next);
  const rename = fs.renameSync;
  let commits = 0;
  const commitSources = new Set();
  const mocked = t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === path.join(store.root, 'index.json')) {
      commits++;
      commitSources.add(source);
      throw Object.assign(new Error('simulated commit failure'), { code: 'EPERM', syscall: 'rename', path: source, dest: target });
    }
    return rename(source, target);
  });
  await assert.rejects(library.install(next.id), /simulated commit failure/);
  assert.equal(commits, 5, 'A persistent file lock exhausts the bounded rename retries.');
  assert.equal(commitSources.size, 1, 'The prepared index must not be rebuilt or the transaction replayed.');
  assert.deepEqual(store.list().map(item => item.id), [pack.id]);
  assert.ok(fs.existsSync(store.directory(next.id, true)));
  assert.ok(!fs.existsSync(store.directory(next.id)));
  mocked.mock.restore();
  assert.equal((await library.install(next.id)).replaced, 1);
  assert.deepEqual(store.list().map(item => item.id), [next.id]);
});

test('background ZIP defaults survive instance overrides, removal and a newer package', async t => {
  const f = await fixture(t);
  const { createMoonlitEntries } = require('../../scripts/package-moonlit-suite');
  const { getBackgroundAppearance } = require('../../public/js/shared/background-appearance.js');
  const entries = createMoonlitEntries();
  const manifest = JSON.parse(entries.get('lira-pack.json'));
  manifest.styles = manifest.styles.filter(style => style.type === 'background');
  manifest.styles.push({ type: 'background', name: '普通背景', file: 'ordinary.png', width: 640, height: 360 });
  for (const style of manifest.styles) style.config = { ...style.config, opacity: 0.85, blur: 3, brightness: 1.1,
    overlayColor: '#123456', overlayOpacity: 0.15, playbackRate: 0.75, volume: 0.25,
    colorProcessing: 'standard', temperature: 30, liftRed: 0.03, gammaBlue: 1.1, gainGreen: 0.9,
    preserveLuminance: false, glowMode: 'star', glowStrength: 0.6, irisBlur: 8,
    vignetteOpacity: 0.3, levelsChannel: 'r', gamma: 1.2, grainStrength: 0.05 };
  // Both resource and ordinary media packages from before standard grading.
  for (const style of [manifest.styles[0], manifest.styles.at(-1)]) {
    for (const key of ['colorProcessing', 'liftRed', 'gammaBlue', 'gainGreen']) delete style.config[key];
  }
  entries.set('ordinary.png', png);
  entries.set('lira-pack.json', Buffer.from(JSON.stringify(manifest)));
  const preview = await f.request('inspect?target=background', zip([...entries]));
  assert.equal(preview.status, 200, preview.error);
  const installed = await f.request('install', { id: preview.data.id, target: 'background' });
  assert.equal(installed.status, 200, installed.error);
  const instances = preview.data.styles.map(style => {
    assert.deepEqual(style.config.backgroundDefaults, getBackgroundAppearance(style.config));
    assert.equal(style.config.fit, 'cover');
    return normalizeSceneConfig('background', { ...style.config, opacity: 0.4, blur: 10 });
  });
  for (const style of preview.data.styles) await f.request('remove', { id: style.id });
  manifest.version = '2.0.0';
  for (const style of manifest.styles) style.config.opacity = 0.95;
  entries.set('lira-pack.json', Buffer.from(JSON.stringify(manifest)));
  const updated = await f.request('inspect?target=background', zip([...entries]));
  assert.equal(updated.status, 200, updated.error);
  assert.equal((await f.request('install', { id: updated.data.id, target: 'background' })).status, 200);
  for (const [index, config] of instances.entries()) {
    assert.equal(config.opacity, 0.4);
    assert.equal(config.backgroundDefaults.opacity, 0.85);
    assert.equal(config.backgroundDefaults.blur, 3);
    assert.equal(config.glowStrength, 0.6);
    assert.equal(config.colorProcessing, index === 1 ? 'standard' : 'legacy');
    assert.equal(config.backgroundDefaults.colorProcessing, config.colorProcessing);
    assert.equal(config.liftRed, index === 1 ? 0.03 : 0);
    assert.equal(config.backgroundDefaults.gammaBlue, index === 1 ? 1.1 : 1);
    assert.equal(config.backgroundDefaults.gainGreen, index === 1 ? 0.9 : 1);
    assert.equal(config.backgroundDefaults.glowMode, 'star');
    assert.equal(config.backgroundDefaults.preserveLuminance, false);
  }
  for (const style of updated.data.styles) assert.equal(style.config.backgroundDefaults.opacity, 0.95);
});

test('documented background manifest imports image and video with its exact filter defaults', async t => {
  const f = await fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/examples/background-style/lira-pack.json'), 'utf8'));
  const video = fs.readFileSync(path.resolve(__dirname, '../fixtures/gift-effect-alpha.webm'));
  const bytes = zip([['lira-pack.json', JSON.stringify(manifest)], ['assets/background.png', png], ['assets/background.webm', video]]);
  const preview = await f.request('inspect?target=background', bytes);
  assert.equal(preview.status, 200, preview.error);
  const installed = await f.request('install', { id: preview.data.id, target: 'background' });
  assert.equal(installed.status, 200, installed.error);
  assert.deepEqual(preview.data.styles.map(style => style.config.mediaStyle.kind), ['image', 'video']);
  for (const [index, style] of preview.data.styles.entries()) {
    for (const [key, value] of Object.entries(manifest.styles[index].config)) {
      assert.equal(style.config[key], value, key);
      assert.equal(style.config.backgroundDefaults[key], value, key);
    }
  }
});

test('bad ZIP paths, scripts, missing resources and incompatible schemas leave no partial library', async t => {
  const f = await fixture(t);
  for (const entries of [
    [['../escape.png', png]], [['evil.js', 'alert(1)']], [['C:/image.png', png]],
    [['image.png', png], ['IMAGE.PNG', png]],
    [['lira-pack.json', JSON.stringify({ schemaVersion: 20, styles: [] })]],
    [['lira-pack.json', JSON.stringify({ schemaVersion: 1, id: 'test', name: '缺文件', version: '1.0.0',
      styles: [{ type: 'background', file: 'missing.png', name: '背景', width: 100, height: 100 }] })]],
  ]) {
    const result = await f.request('inspect?target=background', zip(entries));
    assert.equal(result.status, 400, result.error);
  }
  assert.deepEqual((await f.request('list')).data, []);
  assert.deepEqual(fs.readdirSync(path.join(f.dataDir, 'component-library')), []);
});

test('library routes require administration or the currently attached canvas capability', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('list', undefined, '')).status, 401);
  const state = { draft: { document: {} }, saved: { document: {} }, loaded: true, generation: 0 };
  const { data: session } = await f.post({ action: 'open', component: 'canvas', state });
  const attachmentId = randomUUID();
  await f.post({ action: 'attach', id: session.id, attachmentId, previousAttachmentId: null }, session.token);
  const url = `${f.origin}/api/component-preview/styles/list?id=${session.id}&attachmentId=${attachmentId}`;
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } })).status, 200);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${session.token}`, Origin: 'https://untrusted.test' } })).status, 403);
  assert.equal((await f.request('list', undefined, session.token)).status, 401);
  await f.post({ action: 'open', component: 'canvas', state });
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } })).status, 410);
});

test('media config rejects foreign paths, inappropriate component types and invalid content areas', () => {
  const input = { id: randomUUID(), src: `/component-media/${randomUUID()}/${'a'.repeat(64)}.png`, kind: 'image', width: 100, height: 100 };
  assert.throws(() => normalizeMediaStyle('browser', input));
  assert.throws(() => normalizeMediaStyle('clock', { ...input, src: 'file:///private' }));
  assert.throws(() => normalizeMediaStyle('clock', { ...input, content: { x: 80, y: 0, width: 30, height: 100 } }));
});

test('exported Moonlit ZIP installs eight native styles, validates resources and retains immutable references', async t => {
  const { createMoonlitZip } = require('../../scripts/package-moonlit-suite');
  const { COMPONENT_RESOURCE_PRESETS, normalizeResourceStyle } = require('../../public/js/shared/component-resource-style.js');
  const f = await fixture(t);
  const preview = await f.request('inspect?target=suite', createMoonlitZip());
  assert.equal(preview.status, 200, preview.error);
  assert.equal(preview.data.styles.length, 8);
  const queue = preview.data.styles.find(style => style.type === 'queue');
  assert.equal(queue.config.overlayQueueStyle, 'identity');
  assert.equal(queue.config.identityQueueFontSize, COMPONENT_RESOURCE_PRESETS['moonlit-queue'].config.identityQueueFontSize);
  assert.throws(() => normalizeSceneConfig('queue', { ...queue.config, overlayQueueStyle: 'classic' }));
  assert.equal((await f.request('install', { id: preview.data.id, target: 'suite' })).status, 200);
  for (const style of preview.data.styles) {
    assert.deepEqual(normalizeSceneConfig(style.type, style.config), style.config);
    const resource = style.config.resourceStyle;
    const first = Object.keys(resource.resources)[0];
    assert.throws(() => normalizeResourceStyle(style.type, { ...resource, resources: {} }, style.config));
    assert.throws(() => normalizeResourceStyle(style.type, { ...resource,
      resources: { ...resource.resources, [first]: 'https://example.com/art.webp' } }, style.config));
    assert.throws(() => normalizeSceneConfig(style.type, { ...style.config, mediaStyle: {} }));
    assert.throws(() => normalizeResourceStyle(style.type, { ...resource, preset: '__proto__' }, style.config));
    assert.equal((await f.request('remove', { id: style.id })).status, 200);
    for (const src of [resource.preview, ...Object.values(resource.resources)]) {
      const response = await fetch(`${f.origin}${src}`, { method: 'HEAD' });
      assert.equal(response.status, 200, src);
      if (src.endsWith('.svg')) assert.match(response.headers.get('content-security-policy'), /sandbox; default-src 'none'/);
      if (src.endsWith('.woff2')) assert.equal(response.headers.get('content-type'), 'font/woff2');
    }
  }
  const restored = await f.request('inspect?target=suite', createMoonlitZip());
  const result = await f.request('install', { id: restored.data.id, target: 'suite' });
  assert.equal(result.data.restored, true);
  assert.equal((await f.request('list')).data[0].styles.length, 8);
});

test('nautical ZIP installs one guard style with three original animated tiers and immutable local resources', async t => {
  const { normalizeResourceStyle, NAUTICAL_GUARD_ART } = require('../../public/js/shared/component-resource-style.js');
  const { createNauticalGuardEntries, createNauticalGuardZip } = require('../../scripts/package-guard-nautical');
  const directory = createScratchDirectory('guard-nautical-pack-', t);
  const library = createComponentStyleLibrary(directory);
  const pack = await library.inspect(Readable.from(createNauticalGuardZip()), () => {});
  assert.deepEqual(library.list(), [], 'Inspection must not install.');
  await library.install(pack.id);
  assert.equal(library.list().length, 1);
  assert.equal(pack.styles.length, 1);
  const style = pack.styles[0];
  assert.equal(style.type, 'guard-thanks');
  assert.deepEqual(normalizeSceneConfig(style.type, style.config), style.config);
  const resource = style.config.resourceStyle;
  assert.equal(resource.preset, 'nautical-guard-thanks');
  assert.deepEqual([resource.width, resource.height], [1920, 1080]);
  assert.equal(Object.keys(resource.resources).length, 4);
  const entries = createNauticalGuardEntries();
  for (const key of Object.values(NAUTICAL_GUARD_ART)) {
    assert.match(resource.resources[key], /^\/component-media\/[a-f0-9-]+\/[a-f0-9]{64}\.webp$/);
    const bytes = entries.get(`assets/${path.basename(key)}`);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.ok(bytes.includes(Buffer.from('ANIM')), `${key} must retain animation`);
  }
  assert.throws(() => normalizeResourceStyle('clock', resource, style.config));
  assert.throws(() => normalizeResourceStyle(style.type, { ...resource, resources: {} }, style.config));
  assert.throws(() => normalizeResourceStyle(style.type, { ...resource, resources: { ...resource.resources,
    [NAUTICAL_GUARD_ART.captain]: 'https://example.com/captain.webp' } }, style.config));
  const reopened = createComponentStyleLibrary(directory);
  assert.deepEqual(reopened.list()[0].styles[0].config, style.config);
});

test('Moonlit scroll landscape stays optional for older packs and rejects unrelated resource keys', async t => {
  const { COMPONENT_RESOURCE_PRESETS, normalizeResourceStyle } = require('../../public/js/shared/component-resource-style.js');
  const f = await fixture(t);
  const preset = COMPONENT_RESOURCE_PRESETS['moonlit-danmaku'];
  const landscape = preset.optionalResources[0];
  const artwork = fs.readFileSync(path.resolve(__dirname, '../../public/img/overlays/danmaku-moonlit/scroll-landscape.webp'));
  for (const includeLandscape of [false, true]) {
    const keys = preset.resources.concat(includeLandscape ? [landscape] : []);
    const manifest = { schemaVersion: 2, id: 'test.moonlit-scroll', name: '卷轴测试', version: includeLandscape ? '1.1.0' : '1.0.0',
      styles: [{ type: 'danmaku', name: '弹幕', preset: 'moonlit-danmaku', preview: 'preview.png', width: 640, height: 720,
        resources: Object.fromEntries(keys.map(key => [key, 'art.webp'])) }] };
    const entries = () => [['lira-pack.json', JSON.stringify(manifest)], ['preview.png', png], ['art.webp', artwork]];
    const result = await f.request('inspect?target=danmaku', zip(entries()));
    assert.equal(result.status, 200, result.error);
    const config = result.data.styles[0].config;
    assert.equal(Boolean(config.resourceStyle.resources[landscape]), includeLandscape);
    assert.deepEqual(normalizeSceneConfig('danmaku', config), config);
    assert.throws(() => normalizeResourceStyle('danmaku', { ...config.resourceStyle,
      resources: { ...config.resourceStyle.resources, [landscape]: `/component-media/${randomUUID()}/${'a'.repeat(64)}.webp` } }, config));
    manifest.styles[0].resources['/untrusted.webp'] = 'art.webp';
    assert.equal((await f.request('inspect?target=danmaku', zip(entries()))).status, 400);
  }
});

test('resource archives reject missing files and cannot execute arbitrary presets or attach fonts as media', async t => {
  const f = await fixture(t);
  const manifest = { schemaVersion: 2, id: 'test.resources', name: '资源测试', version: '1.0.0',
    styles: [{ type: 'clock', name: '时钟', preset: 'moonlit-clock', preview: 'preview.png', width: 580, height: 380, resources: {} }] };
  for (const preset of ['moonlit-clock', 'custom-script', '__proto__']) {
    manifest.styles[0].preset = preset;
    assert.equal((await f.request('inspect?target=clock', zip([['lira-pack.json', JSON.stringify(manifest)], ['preview.png', png]]))).status, 400);
  }
  const font = fs.readFileSync(path.resolve(__dirname, '../../public/fonts/clock-moon-serif-400.woff2'));
  assert.equal((await f.request(`add?description=${encodeURIComponent(JSON.stringify({ type: 'clock', filename: 'font.woff2' }))}`, font)).status, 400);
  assert.deepEqual((await f.request('list')).data, []);
});

test('damaged ZIP content is rejected even when its media header still looks valid', async t => {
  const f = await fixture(t);
  const manifest = { schemaVersion: 1, id: 'test.corrupt', name: '损坏测试', version: '1.0.0',
    styles: [{ type: 'background', name: '背景', file: 'frame.png', width: 640, height: 360 }] };
  const bytes = zip([['lira-pack.json', JSON.stringify(manifest)], ['frame.png', png]]);
  bytes[bytes.indexOf(png) + png.length - 1] ^= 1;
  assert.equal((await f.request('inspect?target=background', bytes)).status, 400);
  assert.deepEqual((await f.request('list')).data, []);
  assert.deepEqual(fs.readdirSync(path.join(f.dataDir, 'component-library')), []);
});

test('revocation before streamed upload completion and interrupted transfers leave no styles', async t => {
  const f = await fixture(t);
  const library = createComponentStyleLibrary(f.dataDir);
  const description = { type: 'clock', filename: 'clock.png', name: '时钟', width: 640, height: 360 };
  const stream = new PassThrough();
  let authorized = true;
  const pending = library.add(stream, description, () => {
    if (!authorized) throw Object.assign(new Error('expired'), { statusCode: 410 });
  });
  const rejected = assert.rejects(pending, { statusCode: 410 });
  stream.write(png.subarray(0, 16)); authorized = false; stream.end(png.subarray(16));
  await rejected;
  const interrupted = Readable.from((async function* () { yield png.subarray(0, 16); throw new Error('disconnected'); })());
  await assert.rejects(library.add(interrupted, description, () => {}), /disconnected/);
  assert.deepEqual(library.list(), []);
  assert.deepEqual(fs.readdirSync(path.join(f.dataDir, 'component-library')), []);
  await assert.rejects(receiveMedia(Readable.from([Buffer.alloc(17)]), path.join(f.dataDir, 'bounded-upload'), 16), { statusCode: 413 });
});
