'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

test(
  'real Electron retains cookies, partitions, localStorage and encryption across profile migration',
  {
    skip: process.platform !== 'win32',
    timeout: 40_000,
  },
  async (t) => {
    const temporaryDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'lira-electron-layout-'),
    );
    const root = path.join(temporaryDir, 'data');
    const children = [];
    t.after(async () => {
      for (const { child, done } of children) {
        if (child.exitCode === null) child.kill();
        await done.catch(() => {});
      }
      fs.rmSync(temporaryDir, { recursive: true, force: true });
    });
    function launch(mode) {
      const output = path.join(temporaryDir, `${mode}.json`);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(
        require('electron'),
        [
          path.join(__dirname, 'fixtures/electron/data-layout.cjs'),
          mode,
          root,
          output,
        ],
        { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let errors = '';
      child.stderr.on('data', (chunk) => {
        errors += chunk;
      });
      child.stdout.resume();
      const done = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0
            ? resolve()
            : reject(new Error(errors || `Electron exited: ${code}`)),
        );
      });
      // The test owns and later awaits every child, including the held instance.
      done.catch(() => {});
      children.push({ child, done });
      return { child, output, done };
    }
    await launch('seed').done;
    await launch('migrate').done;
    await launch('repeat').done;
    const held = launch('hold');
    for (
      let attempt = 0;
      !fs.existsSync(held.output) && attempt < 100;
      attempt++
    )
      await delay(50);
    assert.equal(fs.existsSync(held.output), true, 'held profile became ready');
    assert.equal(
      held.child.exitCode,
      null,
      'first instance still owns its lock',
    );
    const second = launch('second');
    await second.done;
    assert.equal(
      JSON.parse(fs.readFileSync(second.output, 'utf8')).locked,
      false,
    );
    fs.writeFileSync(`${held.output}.stop`, 'stop');
    await held.done;
    assert.equal(
      fs.existsSync(path.join(root, 'browser', 'Partitions', 'music-qq')),
      true,
    );
    for (const name of [
      'Partitions',
      'Network',
      'Local State',
      'Local Storage',
      'Preferences',
    ]) {
      assert.equal(
        fs.existsSync(path.join(root, name)),
        false,
        `${name} stays inside the browser profile`,
      );
    }
  },
);
