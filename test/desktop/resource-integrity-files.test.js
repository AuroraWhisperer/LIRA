'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  validateManifest,
  readManifest,
  inspectFile,
  MAX_MANIFEST_BYTES,
} = require('../../src/electron/resource-integrity-files');
const { generateManifest } = require('../../scripts/client-integrity-manifest');

const metadata = { appVersion: '1.2.3', platform: 'win32', arch: 'x64' };
async function fixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lira-integrity-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(root, 'app.asar'), 'archive');
  await fs.promises.mkdir(path.join(root, 'app.asar.unpacked', 'native'), { recursive: true });
  await fs.promises.writeFile(path.join(root, 'app.asar.unpacked/native/addon.node'), 'native');
  await fs.promises.writeFile(path.join(root, 'app-update.yml'), 'out of scope');
  const manifest = await generateManifest({ resourcesDir: root, ...metadata });
  return { root, manifest };
}

test('build manifest is deterministic, scoped to actual raw packaged bytes and rereadable', async (t) => {
  const { root, manifest } = await fixture(t);
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    ['app.asar', 'app.asar.unpacked/native/addon.node'],
  );
  assert.equal(manifest.files[0].sha256, crypto.createHash('sha256').update('archive').digest('hex'));
  assert.deepEqual(await generateManifest({ resourcesDir: root, ...metadata }), manifest);
  assert.deepEqual(await readManifest(fs, root, metadata), manifest);
  for (const file of manifest.files) assert.equal(await inspectFile(fs, root, file), null);
});

test('missing, size mismatch and same-size changes have distinct results', async (t) => {
  const { root, manifest } = await fixture(t);
  const file = manifest.files[0];
  await fs.promises.writeFile(path.join(root, file.path), 'changed');
  assert.equal(await inspectFile(fs, root, file), 'HASH_MISMATCH');
  await fs.promises.writeFile(path.join(root, file.path), 'short');
  assert.equal(await inspectFile(fs, root, file), 'SIZE_MISMATCH');
  await fs.promises.unlink(path.join(root, file.path));
  assert.equal(await inspectFile(fs, root, file), 'FILE_MISSING');
});

test('manifest rejects unsupported or incomplete baselines and unsafe Windows paths', async (t) => {
  const { manifest } = await fixture(t);
  for (const patch of [
    { schemaVersion: 2 },
    { appVersion: '0.0.0' },
    { platform: 'linux' },
    { arch: 'arm64' },
    { scope: 'all' },
    { algorithm: 'md5' },
    { files: [] },
    { files: [manifest.files[1]] },
    { files: Array(10001).fill(manifest.files[0]) },
  ])
    assert.throws(() => validateManifest({ ...manifest, ...patch }, metadata));
  for (const name of [
    '/app.asar',
    'C:/app.asar',
    '//server/share',
    'app.asar:secret',
    'app.asar.unpacked/../secret',
    'app.asar.unpacked/./a',
    'app.asar.unpacked//a',
    'app.asar.unpacked\\a',
    'userData/secret',
    'app.asar.unpacked/NUL',
    'app.asar.unpacked/a.',
  ]) {
    assert.throws(() =>
      validateManifest({ ...manifest, files: [...manifest.files, { ...manifest.files[0], path: name }] }, metadata),
    );
  }
  for (const patch of [{ size: -1 }, { size: 1.5 }, { size: Number.MAX_SAFE_INTEGER + 1 }, { sha256: 'bad' }]) {
    assert.throws(() => validateManifest({ ...manifest, files: [{ ...manifest.files[0], ...patch }] }, metadata));
  }
  assert.throws(() =>
    validateManifest(
      { ...manifest, files: [...manifest.files, { ...manifest.files[1], path: manifest.files[1].path.toUpperCase() }] },
      metadata,
    ),
  );
});

test('oversized or missing manifests cannot be replaced with a runtime baseline', async (t) => {
  const { root } = await fixture(t);
  const filename = path.join(root, 'client-integrity-manifest.json');
  await fs.promises.writeFile(filename, Buffer.alloc(MAX_MANIFEST_BYTES + 1, 32));
  await assert.rejects(readManifest(fs, root, metadata), { code: 'MANIFEST_INVALID' });
  await fs.promises.unlink(filename);
  await assert.rejects(readManifest(fs, root, metadata), { code: 'MANIFEST_MISSING' });
  assert.equal(fs.existsSync(filename), false);
});

test('junctions and non-regular targets are rejected before following them', async (t) => {
  const { root, manifest } = await fixture(t);
  const external = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lira-integrity-outside-'));
  t.after(() => fs.promises.rm(external, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(root, 'app.asar.unpacked/link'));
  await fs.promises.rmdir(path.join(root, 'app.asar.unpacked/link'));
  await fs.promises.symlink(external, path.join(root, 'app.asar.unpacked/link'), 'junction');
  const unsafe = { ...manifest.files[0], path: 'app.asar.unpacked/link/secret' };
  assert.equal(await inspectFile(fs, root, unsafe), 'PATH_UNSAFE');
  await assert.rejects(generateManifest({ resourcesDir: root, ...metadata }), { code: 'PATH_UNSAFE' });
  await fs.promises.unlink(path.join(root, 'app.asar'));
  await fs.promises.mkdir(path.join(root, 'app.asar'));
  assert.equal(await inspectFile(fs, root, manifest.files[0]), 'PATH_UNSAFE');
});

test('a changed file or replaced pathname during streaming is unresolved, not static corruption', async (t) => {
  for (const replace of [false, true]) {
    const { root, manifest } = await fixture(t);
    const filename = path.join(root, 'app.asar');
    const instrumented = {
      ...fs,
      promises: {
        ...fs.promises,
        async open(target, ...args) {
          const handle = await fs.promises.open(target, ...args);
          return {
            stat: () => handle.stat(),
            close: () => handle.close(),
            createReadStream(options) {
              const stream = handle.createReadStream(options);
              stream.once('data', () => {
                if (replace) fs.renameSync(filename, path.join(root, 'old.asar'));
                fs.writeFileSync(filename, 'changed');
              });
              return stream;
            },
          };
        },
      },
    };
    assert.equal(await inspectFile(instrumented, root, manifest.files[0]), 'FILE_CHANGED');
  }
});
