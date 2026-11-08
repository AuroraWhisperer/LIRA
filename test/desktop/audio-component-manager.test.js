'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { createDeflatedZip } = require('../../scripts/component-style-zip');
const { createAudioComponentManager } = require('../../src/electron/audio-component-manager');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('audio preparation removes abandoned staging without deleting completed versions, recent work or linked content', async t => {
  const f = await fixture(t);
  await f.populate(f.destination);
  const old = new Date(Date.now() - 2 * 86400000);
  const abandoned = path.join(f.root, '.prepare-abc123');
  await fs.mkdir(abandoned); await fs.writeFile(path.join(abandoned, 'download.tmp'), 'partial');
  await fs.utimes(path.join(abandoned, 'download.tmp'), old, old); await fs.utimes(abandoned, old, old);
  const recent = path.join(f.root, '.prepare-new123'); await fs.mkdir(recent);
  const previous = path.join(f.root, 'fedcba9876543210fedcba98'); await f.populate(previous);
  const linked = path.join(f.root, '.prepare-link12');
  await fs.symlink(previous, linked, 'junction');
  const manager = f.manager({ fetch: () => { throw new Error('Must remain offline'); } });
  await manager.initialize();
  await assert.rejects(fs.access(abandoned), { code: 'ENOENT' });
  await fs.access(recent); await fs.access(linked);
  assert.equal((await fs.readFile(path.join(previous, 'dependency.dll'))).toString(), 'isolated library');
  assert.equal(await manager.getExecutable(), path.join(f.destination, f.manifest.entry));
});

async function fixture(t) {
  const scratch = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(scratch, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(scratch, 'audio-component-test-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const entries = new Map([['LiraAudioAssistant.exe', Buffer.from('isolated executable fixture')],
    ['dependency.dll', Buffer.from('isolated library')], ['vendor/lira.onnx', Buffer.from('isolated model')]]);
  const archive = createDeflatedZip(entries);
  const manifest = { id: '0123456789abcdef01234567', platform: 'win32', arch: 'x64', entry: 'LiraAudioAssistant.exe',
    files: [...entries].map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: hash(bytes) })),
    archive: { path: 'resources/audio/fixture.zip', size: archive.length, sha256: hash(archive) } };
  let requests = 0;
  const states = [];
  function manager(extra = {}) {
    const result = createAudioComponentManager({ dataDir, manifest, platform: 'win32', arch: 'x64',
      onState: state => states.push(state), fetch: async () => { requests++; return new Response(archive); }, ...extra });
    t.after(() => result.close());
    return result;
  }
  async function populate(directory) {
    for (const [name, bytes] of entries) {
      await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await fs.writeFile(path.join(directory, name), bytes);
    }
  }
  const root = path.join(dataDir, 'components/audio');
  return { dataDir, root, entries, archive, manifest, manager, states, populate,
    destination: path.join(root, manifest.id), requests: () => requests };
}

test('one cold download serves concurrent consumers; subsequent starts and retries use verified local files offline', async t => {
  const f = await fixture(t);
  const manager = f.manager();
  const paths = await Promise.all([manager.initialize(), manager.getExecutable(), manager.initialize()]);
  assert.equal(f.requests(), 1);
  assert.ok(paths.every(filename => filename === path.join(f.destination, f.manifest.entry)));
  assert.equal(manager.getState().status, 'ready');
  assert.equal(manager.getState().downloadedBytes, f.archive.length);
  await manager.retry();
  await manager.close();
  const offline = f.manager({ fetch: () => { throw new Error('Network must not be used'); } });
  assert.equal(await offline.getExecutable(), paths[0]);
  assert.deepEqual(await fs.readdir(f.root), [f.manifest.id]);
});

test('6.0.0 installer preservation is promoted without download or a duplicate legacy copy', async t => {
  const f = await fixture(t);
  const legacy = path.join(f.root, 'legacy');
  await f.populate(legacy);
  await f.manager().initialize();
  assert.equal(f.requests(), 0);
  assert.deepEqual(await fs.readdir(f.root), [f.manifest.id]);
  assert.equal(await fs.readFile(path.join(f.destination, 'dependency.dll'), 'utf8'), 'isolated library');
});

test('download corruption leaves no partial executable and retries only when explicitly requested', async t => {
  const f = await fixture(t);
  let requests = 0;
  const manager = f.manager({ fetch: async () => {
    requests++;
    const bytes = Buffer.from(f.archive);
    if (requests === 1) bytes[0] ^= 1;
    return new Response(bytes);
  } });
  await assert.rejects(manager.initialize(), /HASH_INVALID/);
  await assert.rejects(manager.getExecutable());
  assert.equal(requests, 1);
  assert.deepEqual(await fs.readdir(f.root), []);
  await manager.retry();
  assert.equal(requests, 2);
  assert.equal(manager.getState().status, 'ready');
});

test('a damaged installed version is repaired while a different version is preserved', async t => {
  const f = await fixture(t);
  await f.populate(f.destination);
  await fs.writeFile(path.join(f.destination, 'dependency.dll'), 'damaged');
  const old = path.join(f.root, 'previous-version');
  await f.populate(old);
  await f.manager().initialize();
  assert.equal(f.requests(), 1);
  assert.equal(await fs.readFile(path.join(old, 'dependency.dll'), 'utf8'), 'isolated library');
  assert.equal(await fs.readFile(path.join(f.destination, 'dependency.dll'), 'utf8'), 'isolated library');
});

test('a valid archive hash cannot authorize an unexpected member or a path outside the component', async t => {
  for (const name of ['unapproved.dll', '../escaped.exe']) {
    const f = await fixture(t);
    const bytes = createDeflatedZip(new Map([...f.entries, [name, Buffer.from('unexpected')]]));
    const manifest = { ...f.manifest, archive: { ...f.manifest.archive, size: bytes.length, sha256: hash(bytes) } };
    await assert.rejects(f.manager({ manifest, fetch: async () => new Response(bytes) }).initialize());
    assert.deepEqual(await fs.readdir(f.root), []);
  }
});

test('closing cancels a live download and prevents late publication', async t => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const manager = f.manager({ fetch: async (_url, { signal }) => {
    started.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const work = manager.initialize();
  const rejected = assert.rejects(work);
  await started.promise;
  await manager.close();
  await rejected;
  assert.deepEqual(await fs.readdir(f.root), []);
  await assert.rejects(manager.initialize(), /CLOSED/);
});

test('a linked component directory is rejected without touching the linked destination', async t => {
  const f = await fixture(t);
  const outside = path.join(f.dataDir, 'unrelated');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'preserve');
  await fs.symlink(outside, path.join(f.dataDir, 'components'), 'junction');
  await assert.rejects(f.manager().initialize(), /PATH_INVALID/);
  assert.equal(f.requests(), 0);
  assert.deepEqual(await fs.readdir(outside), ['keep.txt']);
});
