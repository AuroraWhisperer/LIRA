'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createPackage } = require('@electron/asar');
const { generateManifest } = require('../scripts/client-integrity-manifest');

test(
  'real Electron streams an ASAR with responsive UI, detects recheck changes and denies license IPC',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-integrity-electron-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'source');
    const resourcesDir = path.join(directory, 'resources');
    await fs.mkdir(source);
    await fs.mkdir(resourcesDir);
    const handle = await fs.open(path.join(source, 'large-resource.bin'), 'w');
    try {
      const chunk = Buffer.alloc(1024 * 1024);
      for (let index = 0; index < 128; index += 1) await handle.write(chunk);
    } finally {
      await handle.close();
    }
    await createPackage(source, path.join(resourcesDir, 'app.asar'));
    await generateManifest({ resourcesDir, appVersion: '1.0.0', platform: 'win32', arch: 'x64' });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(
      require('electron'),
      [path.join(__dirname, 'fixtures/resource-integrity-probe.cjs'), directory],
      {
        env,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let diagnostics = '';
    child.stderr.on('data', (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-4000);
    });
    const deadline = setTimeout(() => child.kill(), 80000);
    t.after(() => {
      clearTimeout(deadline);
      if (child.exitCode === null) child.kill();
    });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    clearTimeout(deadline);
    const result = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
    t.diagnostic(JSON.stringify(result));
    assert.equal(result.ok, true, JSON.stringify(result) + diagnostics);
    assert.equal(exit, 0);
  },
);
