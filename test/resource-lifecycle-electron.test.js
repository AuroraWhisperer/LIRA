'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('real Electron releases overlay connections, media and WebContents across reconnects and destruction', {
  skip: process.platform !== 'win32', timeout: 90000,
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-resource-lifecycle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(require('electron'), [path.join(__dirname, 'fixtures/resource-lifecycle-probe.cjs'), directory], {
    env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-4000); });
  const deadline = setTimeout(() => child.kill(), 80000);
  t.after(() => { clearTimeout(deadline); if (child.exitCode === null) child.kill(); });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  clearTimeout(deadline);
  const file = path.join(directory, 'result.json');
  assert.equal(fs.existsSync(file), true, `No result after exit ${exitCode}: ${diagnostics}`);
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  t.diagnostic(JSON.stringify(result));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(exitCode, 0);
});
