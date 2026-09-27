'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createResourceIntegrityManager } = require('../src/electron/resource-integrity-manager');
const { generateManifest } = require('../scripts/client-integrity-manifest');

async function fixture(t, overrides = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lira-integrity-manager-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(root, 'app.asar'), 'original');
  const metadata = { appVersion: '1.0.0', platform: 'win32', arch: 'x64' };
  await generateManifest({ resourcesDir: root, ...metadata });
  const events = [];
  const logs = [];
  const manager = createResourceIntegrityManager({
    fs,
    resourcesDir: root,
    isPackaged: true,
    ...metadata,
    onStateChange: (state) => events.push(state),
    writeLog: (_, data) => logs.push(data),
    ...overrides,
  });
  t.after(() => manager.stop());
  return { manager, root, events, logs, metadata };
}

test('requests coalesce, snapshots are isolated, and a recheck rereads changed files', async (t) => {
  const { manager, root, events } = await fixture(t);
  const initial = manager.check();
  assert.deepEqual(manager.check(), initial);
  await manager.whenIdle();
  assert.equal(manager.getState().status, 'passed');
  assert.equal(manager.getState().complete, true);
  await fs.promises.writeFile(path.join(root, 'app.asar'), 'tampered');
  manager.check();
  await manager.whenIdle();
  const result = manager.getState();
  assert.equal(result.status, 'issues');
  assert.equal(result.details[0].reasonCode, 'HASH_MISMATCH');
  result.details[0].path = 'mutated';
  assert.equal(manager.getState().details[0].path, 'app.asar');
  for (let index = 1; index < events.length; index += 1) assert.ok(events[index].revision > events[index - 1].revision);
});

test('development and unsupported platforms never read resources', async (t) => {
  for (const [overrides, code] of [
    [{ isPackaged: false }, 'DEV_MODE'],
    [{ platform: 'linux' }, 'PLATFORM_UNSUPPORTED'],
  ]) {
    const { manager } = await fixture(t, { ...overrides, fs: {} });
    assert.equal(manager.check().status, 'unavailable');
    assert.equal(manager.getState().reasonCode, code);
    assert.equal(manager.getState().totalFiles, null);
  }
});

test('missing baseline is inconclusive, never a zero-file pass', async (t) => {
  const { manager, root } = await fixture(t);
  await fs.promises.unlink(path.join(root, 'client-integrity-manifest.json'));
  manager.check();
  await manager.whenIdle();
  assert.equal(manager.getState().status, 'inconclusive');
  assert.equal(manager.getState().reasonCode, 'MANIFEST_MISSING');
  assert.equal(manager.getState().totalFiles, null);
});

test('cancel and installation stop cannot be overwritten by late I/O', async (t) => {
  const { manager, events } = await fixture(t);
  manager.check();
  await manager.stop('UPDATE_INSTALLING');
  assert.equal(manager.getState().status, 'cancelled');
  assert.equal(manager.getState().complete, false);
  assert.equal(events.at(-1).status, 'cancelled');
  assert.equal(manager.check().reasonCode, 'UPDATE_INSTALLING');
});

test('deadline releases resources and reports an incomplete result', async (t) => {
  const slowFs = {
    ...fs,
    promises: {
      ...fs.promises,
      async lstat(...args) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return fs.promises.lstat(...args);
      },
    },
  };
  const { manager } = await fixture(t, { fs: slowFs, timeoutMs: 1 });
  manager.check();
  await manager.whenIdle();
  assert.equal(manager.getState().reasonCode, 'CHECK_TIMEOUT');
  assert.equal(manager.getState().status, 'inconclusive');
  assert.equal(manager.getState().complete, false);
});

test('cancelling an active read closes the stream and preserves the terminal revision', async (t) => {
  let manager;
  let closed = false;
  const instrumented = {
    ...fs,
    promises: {
      ...fs.promises,
      async open(filename, ...args) {
        const handle = await fs.promises.open(filename, ...args);
        if (!filename.endsWith('app.asar')) return handle;
        return {
          stat: () => handle.stat(),
          async close() {
            closed = true;
            await handle.close();
          },
          createReadStream(options) {
            const stream = handle.createReadStream(options);
            stream.once('data', () => {
              void manager.cancel();
            });
            return stream;
          },
        };
      },
    },
  };
  ({ manager } = await fixture(t, { fs: instrumented }));
  manager.check();
  await manager.whenIdle();
  const state = manager.getState();
  assert.equal(closed, true);
  assert.equal(state.status, 'cancelled');
  assert.equal(state.complete, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.getState().revision, state.revision);
});

test('known issues survive unreadable files and details/logging are bounded', async (t) => {
  const deniedFs = {
    ...fs,
    promises: {
      ...fs.promises,
      async open(filename, ...args) {
        if (filename.endsWith('denied')) throw Object.assign(new Error('private absolute path'), { code: 'EACCES' });
        return fs.promises.open(filename, ...args);
      },
    },
  };
  const { manager, root, metadata, logs } = await fixture(t, { fs: deniedFs });
  await fs.promises.mkdir(path.join(root, 'app.asar.unpacked'));
  for (let index = 0; index < 205; index += 1)
    await fs.promises.writeFile(path.join(root, 'app.asar.unpacked', String(index)), 'ok');
  await fs.promises.writeFile(path.join(root, 'app.asar.unpacked/denied'), 'ok');
  await generateManifest({ resourcesDir: root, ...metadata });
  for (let index = 0; index < 205; index += 1)
    await fs.promises.unlink(path.join(root, 'app.asar.unpacked', String(index)));
  manager.check();
  await manager.whenIdle();
  const result = manager.getState();
  assert.equal(result.status, 'issues');
  assert.equal(result.complete, false);
  assert.equal(result.issueCount, 205);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.details.length, 20);
  assert.equal(logs.at(-1).details.length, 200);
  assert.equal(logs.at(-1).truncated, true);
  assert.ok(!JSON.stringify(logs).includes(root));
  assert.ok(!JSON.stringify(logs).includes('private absolute path'));
});
