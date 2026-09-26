'use strict';

if (!process.versions.electron) return;

const electron = require('electron');
const { app, BrowserWindow, session, safeStorage } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const http = require('node:http');

const directory = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
app.setPath('sessionData', path.join(directory, 'sessions'));
app.on('window-all-closed', () => {});
const dataDir = path.join(directory, 'data');
const windows = [];
const jobs = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const header = (id) => `DedeUserID=${id}; SESSDATA=synthetic-session-${id}; bili_jct=synthetic-csrf-${id}`;

// Only replace window presentation/navigation. Cookie storage and encryption are real Electron APIs.
function ProbeWindow(options) {
  const window = new BrowserWindow({ ...options, show: false });
  const load = window.loadURL.bind(window);
  window.loadURL = () => load('data:text/html,<title>Synthetic login</title>');
  windows.push(window);
  return window;
}
const originalLoad = Module._load;
let createDesktopAuthController;
try {
  Module._load = function (request, ...args) {
    if (request === 'electron') return { ...electron, BrowserWindow: ProbeWindow };
    return originalLoad.call(this, request, ...args);
  };
  ({ createDesktopAuthController } = require('../../src/electron/desktop-auth-controller'));
} finally {
  Module._load = originalLoad;
}
const auth = require('../../src/electron/bilibili-auth');
const musicAuth = require('../../src/electron/auth-manager');

function track(promise) {
  jobs.push(promise.catch(() => {}));
  return promise;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the deterministic race checkpoint');
    await pause(10);
  }
}

async function openLogin(controller, platform) {
  const count = windows.length;
  const completion = track(platform ? controller.loginMusicAccount(platform) : controller.loginBilibiliAccount());
  await waitFor(() => windows.length > count);
  const window = windows.at(-1);
  await waitFor(() => window.isDestroyed() || !window.webContents.isLoadingMainFrame());
  return { completion, window };
}

async function runProbe() {
  assert.equal(safeStorage.isEncryptionAvailable(), true, 'Windows safeStorage is required for this regression');
  const cookies = session.fromPartition(auth.BILIBILI_LOGIN_CONFIG.partition).cookies;
  const results = [];
  await checkLegacyIpc(results);
  async function check(name, action) {
    const controller = createDesktopAuthController({
      BrowserWindow: ProbeWindow, shell: electron.shell,
      getMainWindow: () => null, getDataDir: () => dataDir, writeLog: () => {},
    });
    try {
      await auth.logoutBilibiliAccount(dataDir);
      await musicAuth.logoutMusicAccount('qq', dataDir);
      await action(controller);
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.stack });
    } finally {
      controller.dispose?.();
      for (const window of windows) if (!window.isDestroyed()) window.destroy();
      await Promise.all(jobs);
      await controller.whenIdle?.();
    }
  }

  await check('logout cancels unfinished Bilibili login', async (controller) => {
    const login = await openLogin(controller);
    await controller.logoutBilibiliAccount();
    assert.equal(login.window.isDestroyed(), true, 'logout left a login window able to write revoked credentials');
    assert.equal((await login.completion).state.loggedIn, false);
  });

  await check('a new login invalidates the previous login', async (controller) => {
    const first = await openLogin(controller);
    const second = await openLogin(controller);
    assert.equal(first.window.isDestroyed(), true, 'two login windows share the same account session');
    assert.equal((await first.completion).state.loggedIn, false);
    second.window.close();
    await second.completion;
  });

  await check('cloud replacement cancels local login without stale success', async (controller) => {
    const login = await openLogin(controller);
    await controller.replaceBilibiliCookieHeader(header(202));
    assert.equal(login.window.isDestroyed(), true, 'cloud credentials left the old login active');
    assert.equal((await login.completion).state.loggedIn, false, 'old login reported the cloud account as its own success');
    assert.equal(await controller.getBilibiliUid(), 202);
  });

  await check('a delayed closed-window snapshot cannot resurrect an account after logout', async (controller) => {
    await controller.replaceBilibiliCookieHeader(header(101));
    const login = await openLogin(controller);
    const originalGet = cookies.get.bind(cookies);
    let captured = false;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    cookies.get = async (filter) => {
      const values = await originalGet(filter);
      if (!captured) { captured = true; await gate; }
      return values;
    };
    try {
      login.window.close();
      await waitFor(() => captured);
      const logout = track(controller.logoutBilibiliAccount());
      await pause(100); // Allow logout to reach the blocked snapshot, then release in either implementation.
      release();
      await Promise.all([login.completion, logout]);
    } finally {
      release();
      cookies.get = originalGet;
    }
    await controller.restoreBilibiliCookieSnapshot();
    assert.equal((await controller.getBilibiliAuthState()).loggedIn, false, 'old encrypted snapshot restored the logged-out account');
    assert.equal(fs.existsSync(path.join(dataDir, 'bilibili-auth', 'cookies.enc')), false);
  });

  await check('overlapping cloud imports finish with one complete newer account', async (controller) => {
    const originalSet = cookies.set.bind(cookies);
    let captured = false;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    cookies.set = async (details) => {
      await originalSet(details);
      if (details.name === 'SESSDATA' && details.value === 'synthetic-session-101') {
        captured = true;
        await gate;
      }
    };
    try {
      const older = track(controller.replaceBilibiliCookieHeader(header(101)));
      await waitFor(() => captured);
      const newer = track(controller.replaceBilibiliCookieHeader(header(202)));
      await pause(100);
      release();
      await Promise.all([older, newer]);
    } finally {
      release();
      cookies.set = originalSet;
    }
    const expected = Object.fromEntries(header(202).split('; ').map((part) => part.split('=')));
    const assertCurrent = async () => {
      const actual = Object.fromEntries((await cookies.get({})).map((cookie) => [cookie.name, cookie.value]));
      assert.deepEqual(actual, expected);
    };
    await assertCurrent();
    await session.fromPartition(auth.BILIBILI_LOGIN_CONFIG.partition).clearStorageData({ storages: ['cookies'] });
    await controller.restoreBilibiliCookieSnapshot();
    await assertCurrent();
  });

  await check('logout cancels unfinished music login', async (controller) => {
    const login = await openLogin(controller, 'qq');
    await controller.logoutMusicAccount('QQ');
    assert.equal(login.window.isDestroyed(), true, 'music logout left a window writing the same partition');
    assert.equal((await login.completion).state.loggedIn, false);
  });

  await check('shutdown drains an already running debounced music snapshot', async (controller) => {
    const login = await openLogin(controller, 'qq');
    const musicCookies = session.fromPartition(musicAuth.MUSIC_LOGIN_CONFIG.qq.partition).cookies;
    // A non-auth cookie starts the real 800 ms persistence timer without closing the login window.
    await musicCookies.set({ url: 'https://y.qq.com/', name: 'syntheticPreference', value: 'one' });
    await pause(50);
    const originalGet = musicCookies.get.bind(musicCookies);
    let captured = false;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    musicCookies.get = async (filter) => {
      const values = await originalGet(filter);
      if (!captured) { captured = true; await gate; }
      return values;
    };
    try {
      await waitFor(() => captured);
      controller.dispose();
      assert.equal(login.window.isDestroyed(), true);
      let idle = false;
      const completion = controller.whenIdle().then(() => { idle = true; });
      await pause(50);
      assert.equal(idle, false, 'shutdown returned while a captured Cookie write was still in flight');
      release();
      await completion;
      assert.equal((await login.completion).state.loggedIn, false);
    } finally {
      release();
      musicCookies.get = originalGet;
    }
  });

  await check('normal encrypted login restoration and logout remain usable', async (controller) => {
    const login = await openLogin(controller);
    await auth.replaceBilibiliCookieHeader(dataDir, header(303));
    await waitFor(() => login.window.isDestroyed());
    assert.equal((await login.completion).state.loggedIn, true);
    assert.equal(fs.existsSync(path.join(dataDir, 'bilibili-auth', 'cookies.txt')), false);
    await session.fromPartition(auth.BILIBILI_LOGIN_CONFIG.partition).clearStorageData({ storages: ['cookies'] });
    await controller.restoreBilibiliCookieSnapshot();
    assert.equal(await controller.getBilibiliUid(), 303);
    await controller.logoutBilibiliAccount();
    assert.equal((await controller.getBilibiliAuthState()).loggedIn, false);
  });
  return { ok: results.every((result) => result.ok), results };
}

async function checkLegacyIpc(results) {
  const { ipcMain } = electron;
  const { registerMusicIpc } = require('../../src/electron/ipc/music-ipc');
  const { registerBilibiliIpc } = require('../../src/electron/ipc/bilibili-ipc');
  const { registerUpdateIpc } = require('../../src/electron/ipc/update-ipc');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(req.url === '/frame' ? '<html><body>Subframe</body></html>' :
      '<html><body><button onclick="window.checkResult=Promise.all([musicAPI.getAuthState(\'qq\'),bilibiliAuth.getAuthState(),songAssistantDesktop.checkForUpdates()])">Check bridge</button><iframe src="/frame"></iframe></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let mainWindow;
  let calls = 0;
  const channels = [];
  const run = () => { calls += 1; return { ok: true }; };
  const dependencies = {
    ipcMain: { handle: (channel, handler) => { channels.push(channel); ipcMain.handle(channel, handler); } },
    getMainWindow: () => mainWindow, getDesktopBaseUrl: () => baseUrl,
    getAuthState: run, getMusicAuthState: run, checkForUpdates: run, writeLog() {},
  };
  registerMusicIpc(dependencies);
  registerBilibiliIpc(dependencies);
  registerUpdateIpc(dependencies);
  const owned = [];
  function windowFor(partition) {
    const window = new BrowserWindow({ show: false, webPreferences: {
      partition, preload: path.resolve(__dirname, '../../src/electron/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      // Adversarial fixture: explicitly expose preload in subframes so the main-frame check is exercised.
      nodeIntegrationInSubFrames: true,
    } });
    owned.push(window);
    return window;
  }
  const invoke = 'Promise.all([musicAPI.getAuthState("qq"), bilibiliAuth.getAuthState(), songAssistantDesktop.checkForUpdates()])';
  const allowed = { ok: true };
  const denied = { ok: false, error: 'IPC_SOURCE_INVALID' };
  try {
    assert.equal((await fetch(`${baseUrl}/admin`)).status, 200);
    mainWindow = windowFor('ipc-main');
    for (const pathname of ['/admin', '/', '/settings', '/songs', '/license']) {
      await mainWindow.loadURL(baseUrl + pathname);
      await mainWindow.webContents.executeJavaScript('document.querySelector("button").click()');
      assert.deepEqual(await mainWindow.webContents.executeJavaScript('window.checkResult'),
        pathname === '/license' ? [denied, denied, allowed] : [allowed, allowed, allowed]);
    }
    await mainWindow.loadURL(`${baseUrl}/admin`);
    const before = calls;
    const frame = mainWindow.webContents.mainFrame.frames[0];
    assert.ok(frame);
    assert.deepEqual(await frame.executeJavaScript(invoke), [denied, denied, denied]);
    for (const partition of ['ipc-main', 'ipc-other']) {
      const other = windowFor(partition);
      await other.loadURL(`${baseUrl}/admin`);
      assert.deepEqual(await other.webContents.executeJavaScript(invoke), [denied, denied, denied]);
    }
    for (const url of [`${baseUrl}/clock`, `${baseUrl.replace('127.0.0.1', 'localhost')}/admin`]) {
      await mainWindow.loadURL(url);
      assert.deepEqual(await mainWindow.webContents.executeJavaScript(invoke), [denied, denied, denied]);
    }
    assert.equal(calls, before, 'rejected frames must not invoke privileged actions');
    results.push({ name: 'real preload IPC main window, session, subframe, origin and page matrix', ok: true });
  } catch (error) {
    results.push({ name: 'real preload IPC caller matrix', ok: false, error: error.stack });
  } finally {
    for (const window of owned) if (!window.isDestroyed()) window.destroy();
    for (const channel of channels) ipcMain.removeHandler(channel);
    await new Promise((resolve) => server.close(resolve));
  }
}

global.runAuthProbe = runProbe;
app.whenReady().then(async () => {
  if (process.argv.includes('--interactive-probe')) return;
  let result;
  try { result = await runProbe(); } catch (error) { result = { ok: false, error: error.stack }; }
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
});
