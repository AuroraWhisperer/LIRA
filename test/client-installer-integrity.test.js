'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { generateManifest } = require('../scripts/client-integrity-manifest');
const { validateArchiveEntries, verifyInstaller } = require('../scripts/verify-client-installer');

test('installer extraction rejects unsafe paths, links and duplicate resource entries first', () => {
  const baseline = ['resources/', 'resources/app.asar', 'resources/client-integrity-manifest.json'];
  const types = ['d', '-', '-'];
  assert.equal(validateArchiveEntries(baseline, types).length, 3);
  for (const [name, type] of [
    ['resources/app.asar.unpacked/../outside', '-'],
    ['resources/app.asar.unpacked/link', 'l'],
    ['resources/app.asar.unpacked/ads:stream', '-'],
    ['resources/app.asar', '-'],
    ['resources/APP.ASAR', '-'],
    ['RESOURCES/app.asar', '-'],
  ])
    assert.throws(() => validateArchiveEntries([...baseline, name], [...types, type]));
  assert.throws(() => validateArchiveEntries(baseline, ['l', '-', '-']));
});

test(
  'final artifact extraction verifies the payload rather than a sibling unpacked directory',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-installer-fixture-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const resourcesDir = path.join(root, 'resources');
    await fs.mkdir(resourcesDir);
    await fs.writeFile(path.join(resourcesDir, 'app.asar'), 'packaged');
    const metadata = { appVersion: '1.0.0', platform: 'win32', arch: 'x64' };
    await generateManifest({ resourcesDir, ...metadata });
    const artifact = path.join(root, 'fixture.exe');
    const pack = () => execFileSync('tar', ['-cf', artifact, '-C', root, 'resources'], { windowsHide: true });
    pack();
    await fs.writeFile(path.join(resourcesDir, 'app.asar'), 'outside changed');
    assert.deepEqual(await verifyInstaller(artifact, metadata), { totalFiles: 1 });
    pack();
    await assert.rejects(verifyInstaller(artifact, metadata), { code: 'SIZE_MISMATCH' });
    await fs.unlink(path.join(resourcesDir, 'client-integrity-manifest.json'));
    pack();
    await assert.rejects(verifyInstaller(artifact, metadata), { code: 'MANIFEST_MISSING' });
  },
);
