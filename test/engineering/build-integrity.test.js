'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('packaged Electron hashes the raw app.asar file', (t) => {
  const tempRoot = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'lira-build-integrity-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const appPath = path.join(tempDir, 'app.asar');
  const archive = Buffer.alloc(2 * 1024 * 1024 + 17, 'packaged-lira');
  fs.writeFileSync(appPath, archive);

  const modulePath = path.resolve(__dirname, '../../src/electron/license/build-integrity.js');
  const script = [
    `const { getBuildInfo } = require(${JSON.stringify(modulePath)});`,
    '(async () => {',
    'let yielded = false;',
    'setImmediate(() => { yielded = true; });',
    `const result = await getBuildInfo({ appVersion: '4.0.7', isPackaged: true, appPath: ${JSON.stringify(appPath)} });`,
    "require('node:assert/strict').equal(yielded, true, 'archive hashing must let the event loop run');",
    'process.stdout.write(JSON.stringify(result));',
    '})().catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join('\n');
  const result = spawnSync(require('electron'), ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    appVersion: '4.0.7',
    buildId: `LIRA/4.0.7/${crypto.createHash('sha256').update(archive).digest('hex')}`,
    integrityStatus: 'verified',
  });
});

test('build info preserves development, missing archive and failed read results', async () => {
  const { getBuildInfo } = require('../../src/electron/license/build-integrity');
  for (const options of [
    {},
    { isPackaged: true },
    { isPackaged: true, appPath: path.join(__dirname, 'missing-app.asar') },
  ]) {
    assert.deepEqual(await getBuildInfo({ appVersion: '4.0.7', ...options }), {
      appVersion: '4.0.7',
      buildId: 'LIRA/4.0.7/dev',
      integrityStatus: 'unverified',
    });
  }
  assert.deepEqual(await getBuildInfo({ appVersion: '4.0.7', isPackaged: true, appPath: __dirname }), {
    appVersion: '4.0.7',
    buildId: 'LIRA/4.0.7/unverified',
    integrityStatus: 'unverified',
  });
});

test('each build info request hashes the current archive bytes', async (t) => {
  const { getBuildInfo } = require('../../src/electron/license/build-integrity');
  const tempRoot = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'lira-build-integrity-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const appPath = path.join(tempDir, 'app.asar');
  for (const content of ['first archive', 'changed archive']) {
    fs.writeFileSync(appPath, content);
    const result = await getBuildInfo({ appVersion: '4.0.7', isPackaged: true, appPath });
    assert.equal(result.buildId, `LIRA/4.0.7/${crypto.createHash('sha256').update(content).digest('hex')}`);
    assert.equal(result.integrityStatus, 'verified');
  }
});

test('a failed archive read closes the file and returns unverified', async (t) => {
  const { getBuildInfo } = require('../../src/electron/license/build-integrity');
  let closed = 0;
  t.mock.method(fs.promises, 'open', async () => ({
    read: async () => { throw new Error('synthetic read failure'); },
    close: async () => { closed += 1; },
  }));
  assert.deepEqual(await getBuildInfo({ appVersion: '4.0.7', isPackaged: true, appPath: __filename }), {
    appVersion: '4.0.7',
    buildId: 'LIRA/4.0.7/unverified',
    integrityStatus: 'unverified',
  });
  assert.equal(closed, 1);
});
