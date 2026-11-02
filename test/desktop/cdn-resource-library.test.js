'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { createResourceLibrary } = require('../../src/resources/resource-library');
const { createResourcePackages, packagePath } = require('../../src/resources/resource-packages');
const { createStoredStyleZip } = require('../../scripts/component-style-zip');

const origin = 'https://assets.lirahub.cn';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const file = (name, bytes) => ({ path: name, size: bytes.length, sha256: digest(bytes), label: name });

function packageFixture(files, readBytes, { corruptMember, extraEntry } = {}) {
  const packages = [];
  const responses = new Map();
  for (const resource of createResourcePackages(files)) {
    const members = new Map(resource.files.map(file => [file.path,
      file.path === corruptMember ? Buffer.alloc(file.size, 0xff) : readBytes(file)]));
    if (resource.archive && extraEntry) members.set(extraEntry, Buffer.from('unexpected'));
    const bytes = resource.archive ? createStoredStyleZip(members) : members.values().next().value;
    const sha256 = digest(bytes);
    packages.push({ id: resource.id, size: bytes.length, sha256, files: resource.files.map(file => file.path) });
    const source = packagePath({ ...resource, sha256 }).split('/').map(encodeURIComponent).join('/');
    responses.set(`${origin}/resources/${source}`, bytes);
  }
  return { manifest: { version: 2, files, packages }, responses };
}

async function fixture(t, contents) {
  const scratch = path.resolve(__dirname, '../../tmp/cdn-resource-tests');
  await fs.mkdir(scratch, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(scratch, 'cache-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let files = Object.entries(contents).map(([name, bytes]) => file(name, bytes));
  const objects = new Map(Object.entries(contents).map(([name, bytes]) => [file(name, bytes).sha256, bytes]));
  const requests = [];
  let offline = false;
  let corrupt = false;
  let gate = null;
  let active = 0;
  let peak = 0;
  let packaged = null;
  const fetch = async (url, options) => {
    requests.push({ url, options, startedAt: Date.now() });
    if (offline) throw new Error('offline');
    if (url === `${origin}/resources/manifest.json`) return Response.json(packaged?.manifest || { version: 1, files });
    active++;
    peak = Math.max(peak, active);
    try {
      if (gate) await gate.promise;
      else await new Promise(resolve => setImmediate(resolve));
      const hash = new URL(url).pathname.split('/').at(-1).split('.')[0];
      const bytes = packaged?.responses.get(url) || objects.get(hash);
      return new Response(corrupt ? Buffer.alloc(bytes.length, 0xff) : bytes);
    } finally { active--; }
  };
  const options = { dataDir, publicDir: path.join(dataDir, 'public'), files, fetch };
  const create = () => {
    const library = createResourceLibrary(options);
    t.after(() => library.close());
    return library;
  };
  return { dataDir, requests, create, get peak() { return peak; },
    offline(value = true) { offline = value; }, corrupt(value = true) { corrupt = value; },
    block() { gate = Promise.withResolvers(); return gate; },
    update(name, bytes) {
      files = files.map(entry => entry.path === name ? file(name, bytes) : entry);
      objects.set(digest(bytes), bytes);
    },
    manifest(value) { files = value; },
    add(name, bytes) { files = [...files, file(name, bytes)]; objects.set(digest(bytes), bytes); },
    publishPackages(options) { packaged = packageFixture(files, file => objects.get(file.sha256), options); },
  };
}

test('first run downloads two files concurrently; a warm run checks once and downloads nothing', async t => {
  const contents = { 'fonts/one.woff2': Buffer.from('font one'), 'img/map.png': Buffer.from('map image') };
  const f = await fixture(t, contents);
  const library = f.create();
  const states = [];
  library.onStateChanged(state => states.push(state));
  const first = library.initialize();
  assert.equal(library.initialize(), first);
  const ready = await first;
  assert.equal(ready.status, 'ready');
  assert.equal(ready.completed, 2);
  assert.equal(ready.failed, 0);
  assert.equal(ready.downloadedBytes, ready.totalBytes);
  assert.equal(f.peak, 2);
  assert.ok(states.some(state => state.status === 'downloading' && state.downloadedBytes > 0));
  for (const [name, bytes] of Object.entries(contents))
    assert.deepEqual(await fs.readFile(library.resolveAsset(name)), bytes);
  await library.initialize();
  assert.equal(f.requests.length, 3, 'Repeated authorization events do not recheck during the same run.');
  const restored = f.create();
  const unchanged = await restored.initialize();
  assert.equal(unchanged.status, 'ready');
  assert.equal(unchanged.total, 0);
  assert.equal(f.requests.length, 4, 'A new run checks the manifest exactly once.');
  assert.equal(f.requests.every(request => request.options.credentials === 'omit'), true);
  assert.equal(f.requests.every(request => request.options.redirect === 'error'), true);
});

test('named font packages merge downloads, stay quiet unchanged, and update only the affected package', async t => {
  const contents = { 'fonts/one.woff2': Buffer.from('font one'), 'fonts/two.woff2': Buffer.from('font two'),
    'img/map.png': Buffer.from('map image') };
  const f = await fixture(t, contents);
  f.publishPackages();
  const library = f.create();
  const first = await library.initialize();
  assert.equal(first.status, 'ready');
  assert.equal(first.total, 2, 'Two fonts share one download and the image is independent.');
  assert.equal(first.downloadedBytes, first.totalBytes);
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.some(request => decodeURIComponent(request.url).includes('/fonts/直播组件专用字体-')));
  for (const [name, bytes] of Object.entries(contents)) assert.deepEqual(await fs.readFile(library.resolveAsset(name)), bytes);
  const unchanged = await f.create().initialize();
  assert.equal(unchanged.total, 0);
  assert.equal(f.requests.length, 4);
  const replacement = Buffer.from('new font one');
  f.update('fonts/one.woff2', replacement);
  f.add('fonts/for-newer-client.woff2', Buffer.from('new optional resource'));
  f.publishPackages();
  const restored = f.create();
  assert.equal((await restored.initialize()).total, 1);
  assert.equal(f.requests.length, 6);
  assert.deepEqual(await fs.readFile(restored.resolveAsset('fonts/one.woff2')), replacement);
  assert.deepEqual(await fs.readFile(restored.resolveAsset('fonts/two.woff2')), contents['fonts/two.woff2']);
  assert.equal(restored.resolveAsset('fonts/for-newer-client.woff2'), null);
  assert.equal((await fs.readdir(path.join(f.dataDir, 'cache/resources'))).some(name => /\.(tmp|zip)$/.test(name)), false);
});

test('startup skips imported nautical artwork while shared resources still download, repair and reopen offline', async t => {
  const font = 'fonts/one.woff2';
  const map = 'img/admin/world-clock/earth-day-8k.png';
  const flags = ['captain', 'admiral', 'governor'].map(tier => `img/overlays/guard-nautical/${tier}.webp`);
  const contents = { [font]: Buffer.from('font'), [map]: Buffer.from('map'),
    ...Object.fromEntries(flags.map(name => [name, Buffer.from(name)])) };
  const f = await fixture(t, contents);
  f.publishPackages();
  const library = f.create();
  const first = await library.initialize();
  assert.equal(first.status, 'ready');
  assert.equal(first.total, 2);
  assert.equal(f.requests.length, 3, 'Only the manifest, shared font and map are requested.');
  assert.equal(f.requests.some(request => decodeURIComponent(request.url).includes('航海旗帜')), false);
  for (const name of [font, map]) assert.deepEqual(await fs.readFile(library.resolveAsset(name)), contents[name]);
  for (const name of flags) assert.equal(library.resolveAsset(name), null);

  await fs.writeFile(library.resolveAsset(font), Buffer.alloc(contents[font].length));
  const repaired = await library.initialize({ force: true });
  assert.equal(repaired.total, 1, 'A damaged shared font is still repaired without fetching optional artwork.');
  assert.equal(f.requests.length, 5);
  assert.deepEqual(await fs.readFile(library.resolveAsset(font)), contents[font]);
  f.offline();
  const restored = f.create();
  const cached = await restored.initialize();
  assert.equal(cached.status, 'ready', 'Absent legacy artwork is not a missing current resource.');
  assert.equal(cached.total, 0);
  assert.equal(f.requests.length, 6);
  for (const name of [font, map]) assert.deepEqual(await fs.readFile(restored.resolveAsset(name)), contents[name]);
});

test('previously cached nautical URLs remain readable without redownloading legacy updates', async t => {
  const name = 'img/overlays/guard-nautical/captain.webp';
  const original = Buffer.from('previously cached animation');
  const f = await fixture(t, { [name]: original });
  const directory = path.join(f.dataDir, 'cache/resources');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${digest(original)}.webp`), original);
  await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify({ version: 1,
    files: { [name]: { size: original.length, sha256: digest(original) } } }));
  f.update(name, Buffer.from('a newer legacy animation'));
  f.publishPackages();
  const library = f.create();
  assert.equal((await library.initialize()).status, 'ready');
  assert.equal(f.requests.length, 1, 'Checking the shared manifest must not refresh package-owned artwork.');
  assert.deepEqual(await fs.readFile(library.resolveAsset(name)), original);
  assert.deepEqual(await fs.readFile(library.resolveAsset(name, digest(original))), original);
});

test('a bad ZIP member preserves the old font versions and a retry repairs the package', async t => {
  const contents = { 'fonts/one.woff2': Buffer.from('old first'), 'fonts/two.woff2': Buffer.from('old second') };
  const f = await fixture(t, contents);
  await f.create().initialize();
  f.update('fonts/one.woff2', Buffer.from('new first'));
  f.update('fonts/two.woff2', Buffer.from('new second'));
  f.publishPackages({ corruptMember: 'fonts/two.woff2' });
  const library = f.create();
  assert.equal((await library.initialize()).status, 'error');
  for (const [name, bytes] of Object.entries(contents)) assert.deepEqual(await fs.readFile(library.resolveAsset(name)), bytes);
  assert.equal((await library.initialize({ force: true })).status, 'error');
  for (const [name, bytes] of Object.entries(contents)) assert.deepEqual(await fs.readFile(library.resolveAsset(name)), bytes);
  f.publishPackages();
  assert.equal((await library.initialize({ force: true })).status, 'ready');
  assert.equal(await fs.readFile(library.resolveAsset('fonts/two.woff2'), 'utf8'), 'new second');
});

test('unexpected ZIP paths never become local resources', async t => {
  const f = await fixture(t, { 'fonts/one.woff2': Buffer.from('font one') });
  f.publishPackages({ extraEntry: '../escape.woff2' });
  const library = f.create();
  assert.equal((await library.initialize()).status, 'error');
  assert.equal(library.resolveAsset('fonts/one.woff2'), null);
  await assert.rejects(fs.access(path.join(f.dataDir, 'cache/escape.woff2')), { code: 'ENOENT' });
  assert.equal((await fs.readdir(path.join(f.dataDir, 'cache/resources'))).some(name => /\.(tmp|zip)$/.test(name)), false);
});

test('changed files replace atomically; failed hash checks keep the previous version and explicit retry repairs it', async t => {
  const name = 'fonts/one.woff2';
  const old = Buffer.from('old font');
  const next = Buffer.from('new font revision');
  const f = await fixture(t, { [name]: old });
  await f.create().initialize();
  f.update(name, next);
  f.corrupt();
  const library = f.create();
  const failed = await library.initialize();
  assert.equal(failed.status, 'error');
  assert.equal(failed.failed, 1);
  assert.deepEqual(await fs.readFile(library.resolveAsset(name)), old);
  assert.equal((await fs.readdir(path.join(f.dataDir, 'cache/resources'))).some(name => name.endsWith('.tmp')), false);
  f.corrupt(false);
  assert.equal((await library.initialize({ force: true })).status, 'ready');
  assert.deepEqual(await fs.readFile(library.resolveAsset(name)), next);
});

test('an offline check retains a complete cache without a download notification', async t => {
  const f = await fixture(t, { 'fonts/one.woff2': Buffer.from('cached font') });
  await f.create().initialize();
  f.offline();
  const library = f.create();
  const states = [];
  library.onStateChanged(state => states.push(state));
  const state = await library.initialize();
  assert.equal(state.status, 'ready');
  assert.equal(state.total, 0);
  assert.equal(states.some(state => state.status === 'downloading'), false);
  assert.ok(library.resolveAsset('fonts/one.woff2'));
});

test('invalid manifest paths and excessive sizes cannot introduce filesystem or network targets', async t => {
  const f = await fixture(t, { 'fonts/one.woff2': Buffer.from('font') });
  const original = file('fonts/one.woff2', Buffer.from('font'));
  f.manifest([{ ...original, path: '../private.key' }]);
  const library = f.create();
  assert.equal((await library.initialize()).status, 'error');
  assert.equal(f.requests.length, 1);
  f.manifest([{ ...original, size: 1024 * 1024 * 1024 }]);
  assert.equal((await library.initialize({ force: true })).status, 'error');
  assert.equal(f.requests.length, 2);
  assert.equal(library.resolveAsset('../private.key'), null);
});

test('a cold image request can await the current download without starting another check', async t => {
  const name = 'img/map.png';
  const f = await fixture(t, { [name]: Buffer.from('map') });
  const gate = f.block();
  const library = f.create();
  const initializing = library.initialize();
  const available = library.waitForAsset(name);
  gate.resolve();
  const resolved = await available;
  await initializing;
  assert.equal(resolved, library.resolveAsset(name));
  assert.equal(f.requests.length, 2);
});

test('small resource downloads stay below the configured CDN request rate', async t => {
  const contents = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`fonts/${index}.woff2`, Buffer.from(`font ${index}`)]));
  const f = await fixture(t, contents);
  assert.equal((await f.create().initialize()).status, 'ready');
  for (const request of f.requests)
    assert.ok(f.requests.filter(other => other.startedAt >= request.startedAt && other.startedAt - request.startedAt < 1000).length <= 8);
});

test('a complete downloaded object recovers an interrupted index without another object request', async t => {
  const name = 'fonts/one.woff2';
  const f = await fixture(t, { [name]: Buffer.from('old') });
  await f.create().initialize();
  const next = Buffer.from('newer complete object');
  f.update(name, next);
  await fs.writeFile(path.join(f.dataDir, 'cache/resources', `${digest(next)}.woff2`), next);
  const previousRequests = f.requests.length;
  const library = f.create();
  const state = await library.initialize();
  assert.equal(state.status, 'ready');
  assert.equal(state.total, 0);
  assert.equal(f.requests.length, previousRequests + 1);
  assert.deepEqual(await fs.readFile(library.resolveAsset(name)), next);
});

test('closing removes partial files while keeping committed resources for the next run', async t => {
  const first = Buffer.from('complete font');
  const second = Buffer.from('a larger map fixture');
  const contents = { 'fonts/one.woff2': first, 'img/map.png': second };
  const f = await fixture(t, contents);
  const files = Object.entries(contents).map(([name, bytes]) => file(name, bytes));
  const packaged = packageFixture(files, file => contents[file.path]);
  const fontPackage = [...packaged.responses].find(([url]) => url.endsWith('.zip'))[1];
  const resources = createResourceLibrary({ dataDir: f.dataDir, files, fetch: async (url, options) => {
    if (url.endsWith('/manifest.json')) return Response.json(packaged.manifest);
    if (url.endsWith('.zip')) return new Response(fontPackage);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(second.subarray(0, 4));
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
    } }));
  } });
  t.after(() => resources.close());
  const partial = Promise.withResolvers();
  resources.onStateChanged(state => {
    if (state.completed === 1 && state.downloadedBytes > fontPackage.length) partial.resolve();
  });
  const pending = resources.initialize();
  await partial.promise;
  await resources.close();
  await pending;
  assert.equal((await fs.readdir(path.join(f.dataDir, 'cache/resources'))).some(name => name.endsWith('.tmp')), false);
  const restored = f.create();
  assert.equal((await restored.initialize()).total, 1);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(await fs.readFile(restored.resolveAsset('fonts/one.woff2')), first);
});
