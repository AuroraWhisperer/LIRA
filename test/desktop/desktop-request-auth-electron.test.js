'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

test(
  'Electron applies main-only credentials while sandboxed overlays and other windows remain unprivileged',
  {
    skip: process.platform !== 'win32',
    timeout: 20000,
  },
  async (t) => {
    const directory = createScratchDirectory('lira-desktop-auth-');
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.NODE_TEST_CONTEXT;
    const child = spawn(
      require('electron'),
      [path.join(__dirname, '../fixtures', 'desktop-request-auth-probe.cjs'), directory, '--disable-gpu'],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: environment },
    );
    const closed = new Promise((resolve) => child.once('close', resolve));
    let spawnError;
    child.once('error', (error) => { spawnError = error; });
    let diagnostics = '';
    child.stderr.on('data', (data) => {
      diagnostics = (diagnostics + data).slice(-4000);
    });
    const deadline = setTimeout(() => child.kill(), 15000);
    t.after(async () => {
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
      removeScratchDirectory(directory);
    });
    const exitCode = await closed;
    clearTimeout(deadline);
    if (spawnError) throw spawnError;
    const resultPath = path.join(directory, 'result.json');
    assert.equal(fs.existsSync(resultPath), true, `Electron probe exited ${exitCode} without a result: ${diagnostics}`);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(result.ok, true, result.error);
    assert.equal(exitCode, 0);
  },
);
