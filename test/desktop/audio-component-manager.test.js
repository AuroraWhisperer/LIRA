'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const test = require('node:test');
const { createDeflatedZip } = require('../../scripts/component-style-zip');
const { verifyAudioDirectory, pruneObsoleteAudioVersions } = require('../../src/electron/audio-component-files');
const { createAudioComponentManager } = require('../../src/electron/audio-component-manager');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const previousId = 'fedcba9876543210fedcba98';

test('offline preparation reclaims idle versions and abandoned staging while preserving recent work and linked content', async t => {
  const f = await fixture(t);
  await f.populate(f.destination);
  const old = new Date(Date.now() - 2 * 86400000);
  const abandoned = path.join(f.root, '.prepare-abc123');
  await fs.mkdir(abandoned); await fs.writeFile(path.join(abandoned, 'download.tmp'), 'partial');
  await fs.utimes(path.join(abandoned, 'download.tmp'), old, old); await fs.utimes(abandoned, old, old);
  const recent = path.join(f.root, '.prepare-new123'); await fs.mkdir(recent);
  const previous = path.join(f.root, previousId); await f.populate(previous);
  const legacy = path.join(f.root, 'legacy'); await f.populate(legacy);
  const outside = path.join(f.dataDir, 'unrelated'); await f.populate(outside);
  await fs.symlink(outside, path.join(legacy, 'link'), 'junction');
  const linked = path.join(f.root, '.prepare-link12');
  await fs.symlink(outside, linked, 'junction');
  await fs.symlink(outside, path.join(f.root, 'a'.repeat(24)), 'junction');
  const manager = f.manager({ fetch: () => { throw new Error('Must remain offline'); } });
  await manager.initialize();
  await t.waitFor(() => assert.rejects(fs.access(previous), { code: 'ENOENT' }), { timeout: 5000 });
  await assert.rejects(fs.access(abandoned), { code: 'ENOENT' });
  await fs.access(recent); await fs.access(linked);
  await fs.access(path.join(legacy, f.manifest.entry));
  await fs.access(path.join(f.root, 'a'.repeat(24), 'dependency.dll'));
  assert.equal(await manager.getExecutable(), path.join(f.destination, f.manifest.entry));
});

async function fixture(t, executable = Buffer.from('isolated executable fixture')) {
  const scratch = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(scratch, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(scratch, 'audio-component-test-'));
  const managers = [];
  t.after(async () => {
    await Promise.all(managers.map(manager => manager.close()));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const entries = new Map([['LiraAudioAssistant.exe', executable],
    ['dependency.dll', Buffer.from('isolated library')], ['vendor/lira.onnx', Buffer.from('isolated model')]]);
  const archive = createDeflatedZip(entries);
  const manifest = { id: '0123456789abcdef01234567', platform: 'win32', arch: 'x64', entry: 'LiraAudioAssistant.exe',
    files: [...entries].map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: hash(bytes) })),
    archive: { path: 'client/resources/audio/fixture.zip', size: archive.length, sha256: hash(archive) } };
  let requests = 0;
  const states = [];
  function manager(extra = {}) {
    const result = createAudioComponentManager({ dataDir, manifest, platform: 'win32', arch: 'x64',
      onState: state => states.push(state), fetch: async () => { requests++; return new Response(archive); }, ...extra });
    managers.push(result);
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

test('audio download measures idle time from the last written bytes', async t => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Put the platform's single-shot deadline on the same synthetic clock, too.
  t.mock.method(AbortSignal, 'timeout', ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  const manager = f.manager({ fetch: async () => ({ ok: true, headers: new Headers(), body: (async function* () {
    const half = Math.floor(f.archive.length / 2);
    t.mock.timers.tick(200000); yield f.archive.subarray(0, half);
    t.mock.timers.tick(200000); yield f.archive.subarray(half);
  })() }) });
  await manager.initialize();
  assert.equal(manager.getState().status, 'ready');

  const waiting = Promise.withResolvers();
  // A fresh directory is needed because an intact component bypasses the network.
  const stalled = (await fixture(t)).manager({ fetch: async (_url, { signal }) => {
    waiting.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const failed = assert.rejects(stalled.initialize());
  await waiting.promise;
  t.mock.timers.tick(300001);
  await failed;
  assert.equal(stalled.getState().status, 'error');
});

test('a locked retired audio directory does not invalidate a verified repair', async t => {
  const f = await fixture(t);
  await f.populate(f.destination);
  await fs.writeFile(path.join(f.destination, 'dependency.dll'), 'broken');
  const rm = fs.rm;
  let locked;
  const busy = t.mock.method(fs, 'rm', async (filename, options) => {
    if (filename.startsWith(`${f.destination}.replaced-`)) {
      locked = filename;
      throw Object.assign(new Error('fixture lock'), { code: 'EBUSY' });
    }
    return rm(filename, options);
  });
  const manager = f.manager();
  const result = await manager.initialize().catch(error => error.code);
  assert.ok(locked);
  assert.equal(await verifyAudioDirectory(f.destination, f.manifest, new AbortController().signal), true);
  const executable = await manager.getExecutable().catch(error => error.cause.code);
  assert.deepEqual([result, executable], Array(2).fill(path.join(f.destination, f.manifest.entry)));
  assert.equal(f.requests(), 1);
  busy.mock.restore();
  await fs.access(locked);
  const old = new Date(Date.now() - 2 * 86400000);
  for (const entry of await fs.readdir(locked, { recursive: true })) await fs.utimes(path.join(locked, entry), old, old);
  await fs.utimes(locked, old, old);
  assert.equal(await manager.getExecutable(), executable);
  await assert.rejects(fs.access(locked), { code: 'ENOENT' });
});

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

test('verified background files are checked again when a worker requests its executable', async t => {
  const f = await fixture(t);
  await f.populate(f.destination);
  const manager = f.manager();
  await manager.initialize();
  assert.equal(f.requests(), 0);
  const library = path.join(f.destination, 'dependency.dll');
  const original = f.entries.get('dependency.dll');
  await fs.writeFile(library, Buffer.alloc(original.length));
  const paths = await Promise.all([manager.getExecutable(), manager.getExecutable()]);
  assert.ok(paths.every(filename => filename === path.join(f.destination, f.manifest.entry)));
  assert.equal(f.requests(), 1);
  assert.deepEqual(await fs.readFile(library), original);
});

test('a cancelled audio check takes precedence over a missing directory and an earlier batch mismatch', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(verifyAudioDirectory(f.destination, f.manifest, AbortSignal.abort()), { name: 'AbortError' });
  await f.populate(f.destination);
  const realpath = fs.realpath;
  let members = 0;
  t.mock.method(fs, 'realpath', async filename => {
    if (filename === f.destination) return realpath(filename);
    if (++members === 1) return path.join(f.root, 'different-file');
    controller.abort();
    throw controller.signal.reason;
  });
  await assert.rejects(verifyAudioDirectory(f.destination, f.manifest, controller.signal),
    error => error === controller.signal.reason);
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

test('a deferred audio download reports why there is no retry task', async t => {
  const f = await fixture(t);
  const manager = f.manager({ canDownload: () => false });
  await assert.rejects(manager.getExecutable(), error => {
    assert.equal(error.cause?.message, 'AUDIO_AUTHORIZATION_REQUIRED');
    assert.match(error.message, /授权/);
    assert.doesNotMatch(error.message, /下载任务/);
    return true;
  });
  assert.equal(manager.getState().status, 'idle');
  assert.equal(f.requests(), 0);
});

test('an unsupported platform reports the cause without creating a download task', async t => {
  const f = await fixture(t);
  const manager = f.manager({ arch: 'arm64' });
  await assert.rejects(manager.getExecutable(), /不支持/);
  assert.equal(manager.getState().status, 'idle');
  assert.equal(f.requests(), 0);
});

test('a failed upgrade preserves the old component until an explicit retry installs the verified replacement', async t => {
  const f = await fixture(t);
  const previous = path.join(f.root, previousId);
  const legacy = path.join(f.root, 'legacy');
  await f.populate(previous);
  await f.populate(legacy);
  await fs.writeFile(path.join(legacy, 'dependency.dll'), 'old library');
  let requests = 0;
  const manager = f.manager({ fetch: async () => {
    requests++;
    const bytes = Buffer.from(f.archive);
    if (requests === 1) bytes[0] ^= 1;
    return new Response(bytes);
  } });
  await assert.rejects(manager.initialize(), /HASH_INVALID/);
  await assert.rejects(manager.getExecutable(), /系统与关于.*重试/);
  assert.equal(requests, 1);
  assert.deepEqual((await fs.readdir(f.root)).sort(), [previousId, 'legacy']);
  await fs.access(path.join(previous, 'vendor/lira.onnx'));
  assert.equal(await fs.readFile(path.join(legacy, 'dependency.dll'), 'utf8'), 'old library');
  await manager.retry();
  assert.equal(requests, 2);
  assert.equal(manager.getState().status, 'ready');
  await t.waitFor(async () => assert.deepEqual(await fs.readdir(f.root), [f.manifest.id]), { timeout: 5000 });
});

test('repair leaves unrelated directory names untouched', async t => {
  const f = await fixture(t);
  await f.populate(f.destination);
  await fs.writeFile(path.join(f.destination, 'dependency.dll'), Buffer.alloc(f.entries.get('dependency.dll').length));
  const old = path.join(f.root, 'previous-version');
  await f.populate(old);
  await f.manager().initialize();
  assert.equal(f.requests(), 1);
  assert.equal(await fs.readFile(path.join(old, 'dependency.dll'), 'utf8'), 'isolated library');
  assert.equal(await fs.readFile(path.join(f.destination, 'dependency.dll'), 'utf8'), 'isolated library');
});

async function withRunningWindowsImage(entry, check) {
  const worker = spawn(entry, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const closed = once(worker, 'close');
  let output = '';
  worker.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  try {
    await once(worker, 'spawn');
    await check();
    worker.stdin.end('playing\r\n');
    assert.equal((await closed)[0], 0);
    assert.equal(output.trim(), 'playing');
  } finally {
    worker.stdin.end();
    await closed;
  }
}

test('a live Windows image and its dependencies survive cleanup until the next offline client start', {
  skip: process.platform !== 'win32',
}, async t => {
  const f = await fixture(t);
  await f.populate(f.destination);
  const previous = path.join(f.root, previousId);
  await f.populate(previous);
  const entry = path.join(previous, f.manifest.entry);
  await fs.copyFile(path.join(process.env.SystemRoot, 'System32', 'sort.exe'), entry);
  await withRunningWindowsImage(entry, async () => {
    await pruneObsoleteAudioVersions(f.dataDir, f.root, f.manifest, f.destination, new AbortController().signal);
    assert.equal(await fs.readFile(path.join(previous, 'vendor/lira.onnx'), 'utf8'), 'isolated model');
  });
  await f.manager().initialize();
  await t.waitFor(() => assert.rejects(fs.access(previous), { code: 'ENOENT' }), { timeout: 5000 });
  assert.equal(f.requests(), 0);
});

test('a verified legacy image stays in place while running and can be promoted after exit', {
  skip: process.platform !== 'win32',
}, async t => {
  const f = await fixture(t, await fs.readFile(path.join(process.env.SystemRoot, 'System32', 'sort.exe')));
  const legacy = path.join(f.root, 'legacy');
  await f.populate(legacy);
  const entry = path.join(legacy, f.manifest.entry);
  const manager = f.manager();
  await withRunningWindowsImage(entry, async () => {
    assert.equal(await manager.getExecutable(), entry);
  });
  assert.equal(await manager.getExecutable(), path.join(f.destination, f.manifest.entry));
  assert.equal(f.requests(), 0);
});

test('repair of the same version waits for the running image before downloading or replacing files', {
  skip: process.platform !== 'win32',
}, async t => {
  const f = await fixture(t);
  await f.populate(f.destination);
  const entry = path.join(f.destination, f.manifest.entry);
  await fs.copyFile(path.join(process.env.SystemRoot, 'System32', 'sort.exe'), entry);
  const manager = f.manager();
  await withRunningWindowsImage(entry, async () => {
    await assert.rejects(manager.initialize(), /AUDIO_COMPONENT_IN_USE/);
    assert.equal(f.requests(), 0);
    await fs.access(path.join(f.destination, 'vendor/lira.onnx'));
  });
  assert.equal(await manager.retry(), entry);
  assert.equal(f.requests(), 1);
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
