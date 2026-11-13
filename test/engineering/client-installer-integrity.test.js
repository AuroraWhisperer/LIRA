'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const { generateManifest } = require('../../scripts/client-integrity-manifest');
const { validateArchiveEntries, verifyInstaller } = require('../../scripts/verify-client-installer');
const { createPackagedApp } = require('../helpers/packaged-app');

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
  'final artifact extraction verifies an embedded payload beyond the tar SFX scan limit',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { appOutDir: root, resourcesDir } = await createPackagedApp(t);
    const metadata = { appVersion: '1.0.0', platform: 'win32', arch: 'x64' };
    await generateManifest({ resourcesDir, ...metadata });
    const artifact = path.join(root, 'fixture.exe');
    const payload = path.join(root, 'payload.7z');
    const sevenZip = await getPath7za();
    // The safe uninstaller precedes the application archive in the NSIS payload.
    const prefix = Buffer.alloc(1024 * 1024);
    prefix.write('MZ');
    const pack = async () => {
      await fs.rm(payload, { force: true });
      execFileSync(sevenZip, ['a', '-t7z', payload, 'resources'], { cwd: root, windowsHide: true });
      await fs.writeFile(artifact, Buffer.concat([prefix, await fs.readFile(payload), Buffer.from('installer tail')]));
    };
    await pack();
    await fs.writeFile(path.join(resourcesDir, 'app.asar'), 'outside changed');
    assert.deepEqual(await verifyInstaller(artifact, metadata), { totalFiles: 1 });
    await pack();
    await assert.rejects(verifyInstaller(artifact, metadata), { code: 'SIZE_MISMATCH' });
    await fs.unlink(path.join(resourcesDir, 'client-integrity-manifest.json'));
    await pack();
    await assert.rejects(verifyInstaller(artifact, metadata), { code: 'MANIFEST_MISSING' });
  },
);

test('final installer rejects missing runtime dependencies even when every resource hash matches',
  { skip: process.platform !== 'win32' }, async (t) => {
    const { appOutDir, resourcesDir } = await createPackagedApp(t, {
      '': { dependencies: { 'qrc-decoder': '1.0.2' } },
      'node_modules/qrc-decoder': { dependencies: { pako: '2' } },
    });
    const metadata = { appVersion: '1.0.0', platform: 'win32', arch: 'x64' };
    await generateManifest({ resourcesDir, ...metadata });
    const artifact = path.join(appOutDir, 'fixture.exe');
    execFileSync('tar', ['-cf', artifact, '-C', appOutDir, 'resources'], { windowsHide: true });
    await assert.rejects(verifyInstaller(artifact, metadata), /qrc-decoder\/package.json -> pako/);
  });
