'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('packaged Electron hashes the raw app.asar file', (t) => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-build-integrity-'),
  );
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const appPath = path.join(tempDir, 'app.asar');
  const archive = Buffer.from('packaged-lira');
  fs.writeFileSync(appPath, archive);

  const modulePath = path.resolve(
    __dirname,
    '../src/electron/license/build-integrity.js',
  );
  const script = [
    `const { getBuildInfo } = require(${JSON.stringify(modulePath)});`,
    `const result = getBuildInfo({ appVersion: '4.0.7', isPackaged: true, appPath: ${JSON.stringify(appPath)} });`,
    'process.stdout.write(JSON.stringify(result));',
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
