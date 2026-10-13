'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

test('real Electron persists page errors, rejected promises, preload failures, failed loads and renderer crashes', {
  timeout: 30_000,
}, async () => {
  const directory = createScratchDirectory('desktop-diagnostics-');
  const report = path.join(directory, 'report.json');
  const probe = path.join(directory, 'probe.cjs');
  const preload = path.join(directory, 'preload.cjs');
  fs.writeFileSync(preload, "throw new Error('synthetic preload failure');");
  fs.writeFileSync(probe, `
    const fs = require('node:fs');
    const http = require('node:http');
    const { app, BrowserWindow } = require('electron');
    const directory = ${JSON.stringify(directory)};
    app.setPath('userData', directory);
    app.setPath('sessionData', directory);
    app.setPath('crashDumps', directory + '/crashes');
    app.disableHardwareAcceleration();
    const { installDesktopDiagnostics } = require(${JSON.stringify(require.resolve('../../src/electron/desktop-diagnostics'))});
    const { createDesktopLogger } = require(${JSON.stringify(require.resolve('../../src/electron/desktop-logger'))});
    const logger = createDesktopLogger({getLogFile: () => directory + '/desktop.log', loggingState: {runId:'test',sequence:0}});
    let baseUrl = '';
    const dispose = installDesktopDiagnostics({app, writeLog: logger.writeLog, getBaseUrl: () => baseUrl});
    const server = http.createServer((req, res) => {
      if (req.url === '/broken') return req.socket.destroy();
      if (req.url !== '/diagnostics') {res.writeHead(404);return res.end();}
      res.writeHead(200, {'Content-Type':'text/html'});
      res.end('<!doctype html><title>Diagnostics fixture</title><script>setTimeout(() => { console.error("synthetic console failure Authorization: Bearer fixture-secret"); Promise.reject(new Error("synthetic rejection")); setTimeout(() => { throw new Error("synthetic timer failure"); }, 0); }, 20);</script>');
    });
    function waitFor(predicate) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (predicate()) {clearInterval(timer); resolve();}
          else if (Date.now() - start > 5000) {clearInterval(timer); reject(new Error('diagnostic timeout'));}
        }, 20);
      });
    }
    app.whenReady().then(async () => {
      try {
        await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
        baseUrl = 'http://127.0.0.1:' + server.address().port;
        if ((await fetch(baseUrl + '/diagnostics')).status !== 200) throw new Error('fixture route unavailable');
        const win = new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,sandbox:false}});
        await win.loadURL(baseUrl + '/diagnostics');
        const errorPath = directory + '/errors/desktop.log';
        const read = () => fs.existsSync(errorPath) ? fs.readFileSync(errorPath,'utf8') : '';
        await waitFor(() => read().includes('synthetic rejection') && read().includes('synthetic timer failure'));
        const failed = new BrowserWindow({show:false});
        await failed.loadURL(baseUrl + '/broken').catch(() => {});
        await waitFor(() => read().includes('page-load-error'));
        const crashed = new Promise(resolve => win.webContents.once('render-process-gone', resolve));
        win.webContents.forcefullyCrashRenderer();
        await crashed;
        fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({content:read()}));
        failed.destroy(); win.destroy(); dispose();
        server.close(() => app.exit(0));
      } catch(error) {
        fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({failure:error.stack}));
        app.exit(1);
      }
    });
  `);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [probe], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
  let timeout;
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
    timeout = setTimeout(() => child.kill(), 20_000);
  });
  try {
    assert.equal(await closed, 0, output + (fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : ''));
    const { content } = JSON.parse(fs.readFileSync(report, 'utf8'));
    for (const expected of ['synthetic console failure', 'synthetic rejection', 'synthetic timer failure',
      'preload-error', 'page-load-error', 'renderer-process-error']) assert.ok(content.includes(expected), expected);
    assert.doesNotMatch(content, /fixture-secret/);
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) { child.kill(); await closed; }
    removeScratchDirectory(directory);
  }
});
