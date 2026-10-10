'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

const projectDir = path.resolve(__dirname, '../..');
const entry = path.join(projectDir, require('../../package.json').main);
const main = path.join(projectDir, 'src/electron/main.js');

test('Electron startup reports load failures and exits instead of remaining in the background', {
  skip: process.platform !== 'win32',
  timeout: 30000,
}, async (t) => {
  for (const scenario of ['missing-dependency', 'report-failure', 'loaded']) {
    await t.test(scenario, async () => {
      const directory = createScratchDirectory('electron-startup-');
      const report = path.join(directory, 'report.json');
      const probe = path.join(directory, 'probe.cjs');
      fs.writeFileSync(probe, `
        const fs = require('node:fs');
        const path = require('node:path');
        const Module = require('node:module');
        const { app, dialog } = require('electron');
        const directory = ${JSON.stringify(directory)};
        const report = ${JSON.stringify(report)};
        const scenario = ${JSON.stringify(scenario)};
        app.setPath('userData', directory);
        app.setPath('sessionData', directory);
        app.setPath('crashDumps', path.join(directory, 'crashes'));
        app.disableHardwareAcceleration();
        const messages = [];
        dialog.showErrorBox = (title, message) => {
          messages.push({ title, message });
          fs.writeFileSync(report, JSON.stringify(messages));
          if (scenario === 'report-failure') throw new Error('fixture dialog failed');
        };
        // Suppress Electron's native unhandled-error dialog in the failing baseline.
        process.on('uncaughtException', error => {
          fs.writeFileSync(report, JSON.stringify({ unhandled: error.message }));
        });
        const load = Module._load;
        Module._load = function (request, parent, isMain) {
          if (Module._resolveFilename(request, parent) === ${JSON.stringify(main)}) {
            if (scenario !== 'loaded') return require('./missing-startup-dependency');
            app.whenReady().then(() => app.exit(0));
            return {};
          }
          return load.call(this, request, parent, isMain);
        };
        require(${JSON.stringify(entry)});
      `);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [probe], { env, windowsHide: true, stdio: 'ignore' });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 8000);
      try {
        const code = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
        });
        assert.equal(timedOut, false, 'failed startup must not leave an Electron process running');
        assert.equal(code, scenario === 'loaded' ? 0 : 1);
        assert.equal(fs.existsSync(report), scenario !== 'loaded');
        if (scenario !== 'loaded') {
          const messages = JSON.parse(fs.readFileSync(report, 'utf8'));
          assert.equal(messages.length, 1);
          assert.equal(messages[0].title, 'LIRA 启动失败');
          assert.match(messages[0].message, /missing-startup-dependency/);
          assert.match(messages[0].message, /重新安装/);
        }
      } finally {
        clearTimeout(timer);
        assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(path.join(projectDir, 'tmp')));
        removeScratchDirectory(directory);
      }
    });
  }
});
