'use strict';

// Run only as a child Electron process; node:test may discover this fixture.
if (process.versions.electron) {
  run().catch((error) => {
    console.error(error);
    require('electron').app.exit(1);
  });
}

async function run() {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const { app, BrowserWindow, session, safeStorage } = require('electron');
  app.on('window-all-closed', () => {});
  const {
    migrateBrowserData,
    migrateCacheData,
  } = require('../../../src/storage/data-directory-migration');
  const [mode, root, output] = process.argv.slice(2);
  fs.mkdirSync(root, { recursive: true });
  app.setPath('userData', root);
  const locked = app.requestSingleInstanceLock();
  if (!locked) {
    fs.writeFileSync(output, JSON.stringify({ locked }));
    app.exit(0);
    return;
  }
  if (mode !== 'seed') {
    migrateBrowserData({ dataDir: root });
    migrateCacheData({ dataDir: root });
    app.setPath('userData', path.join(root, 'browser'));
    app.setPath('sessionData', path.join(root, 'browser'));
  } else {
    app.setPath('sessionData', root);
  }
  app.setPath('crashDumps', path.join(root, 'browser', 'Crashpad'));
  await app.whenReady();
  const partition = session.fromPartition('persist:music-qq');
  const htmlPath = path.join(root, 'profile-test.html');
  const secretPath = path.join(root, 'test-secret.enc');
  if (mode === 'seed') {
    fs.writeFileSync(htmlPath, '<!doctype html><title>Profile test</title>');
    for (const current of [session.defaultSession, partition]) {
      await current.cookies.set({
        url: 'https://lira.example',
        name: 'fixture',
        value: 'retained',
        expirationDate: Math.floor(Date.now() / 1000) + 86400,
      });
      await current.cookies.flushStore();
    }
    fs.writeFileSync(secretPath, safeStorage.encryptString('retained-secret'));
  }
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await window.loadURL(pathToFileURL(htmlPath).href);
  if (mode === 'seed') {
    await window.webContents.executeJavaScript(
      "localStorage.setItem('fixture', 'retained-storage')",
    );
  } else {
    for (const current of [session.defaultSession, partition]) {
      const cookies = await current.cookies.get({
        url: 'https://lira.example',
        name: 'fixture',
      });
      assert.equal(cookies[0]?.value, 'retained');
    }
    assert.equal(
      safeStorage.decryptString(fs.readFileSync(secretPath)),
      'retained-secret',
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "localStorage.getItem('fixture')",
      ),
      'retained-storage',
    );
  }
  session.defaultSession.flushStorageData();
  partition.flushStorageData();
  window.destroy();
  fs.writeFileSync(
    output,
    JSON.stringify({ locked, mode, userData: app.getPath('userData') }),
  );
  if (mode === 'hold') {
    const timer = setInterval(() => {
      if (!fs.existsSync(`${output}.stop`)) return;
      clearInterval(timer);
      app.quit();
    }, 50);
  } else {
    app.quit();
  }
}
