'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

test('real Electron authentication operations cannot restore or mix obsolete accounts', {
  skip: process.platform !== 'win32', timeout: 35000,
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-auth-races-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NODE_TEST_CONTEXT;
  const child = spawn(require('electron'), [
    path.join(__dirname, 'fixtures', 'desktop-auth-race-probe.cjs'), directory, '--disable-gpu',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: environment });
  let diagnostics = '';
  child.stderr.on('data', (data) => { diagnostics = (diagnostics + data).slice(-4000); });
  const deadline = setTimeout(() => child.kill(), 30000);
  t.after(() => { clearTimeout(deadline); if (child.exitCode === null) child.kill(); });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  clearTimeout(deadline);
  const resultPath = path.join(directory, 'result.json');
  assert.equal(fs.existsSync(resultPath), true, `Electron exited ${exitCode} without a result: ${diagnostics}`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(exitCode, 0);
});
