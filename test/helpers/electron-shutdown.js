'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDesktopState } = require('../../src/electron/desktop-state');

const MAIN_PATH = path.resolve(__dirname, '../../src/electron/main.js');
const MAIN_SOURCE = fs.readFileSync(MAIN_PATH, 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function createClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const delays = [];
  return {
    delays,
    get pending() { return timers.size; },
    setTimeout(callback, delay) {
      const id = ++nextId;
      delays.push(delay);
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of timers) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

function createShutdownHarness(options = {}) {
  const calls = [];
  const logs = [];
  const startupErrors = [];
  const state = createDesktopState();
  const clock = createClock();
  const ready = Promise.withResolvers();
  const remoteIdle = Promise.withResolvers();
  const cloudIdle = Promise.withResolvers();
  const backendStop = Promise.withResolvers();
  const handlers = new Map();
  const powerMonitor = new EventEmitter();
  let preShutdownHook;
  let startPromise;
  let runtimeOpen = false;

  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    getPath: () => 'C:\\synthetic-lira-shutdown',
    setPath() {},
    getName: () => 'LIRA',
    setName() {},
    getVersion: () => '0.0.0-test',
    requestSingleInstanceLock: () => true,
    whenReady: () => ready.promise,
    releaseSingleInstanceLock: () => calls.push('app:release-lock'),
    relaunch: () => calls.push('app:relaunch'),
    exit(code) {
      assert.equal(code, 0);
      calls.push('app:exit');
    },
    quit() { return quit(); },
  });

  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
    }
    loadURL() { return Promise.resolve(); }
    isDestroyed() { return false; }
  }

  const runtime = {
    start() {
      calls.push('runtime:start');
      runtimeOpen = true;
      startPromise = Promise.resolve(options.runtimeStart?.promise).then(() => ({
        baseUrl: 'http://127.0.0.1:3000',
      }));
      return startPromise;
    },
    async stop(stopOptions) {
      assert.equal(stopOptions.exitProcess, false);
      calls.push('runtime:stop');
      await startPromise;
      await preShutdownHook();
      await backendStop.promise;
      runtimeOpen = false;
      calls.push('runtime:stopped');
    },
    setPreShutdownHook(hook) { preShutdownHook = hook; },
    onGiftCatalogInitializationStateChanged() {},
  };
  const licenseManager = {
    bootstrap: () => options.licenseBootstrap?.promise,
    getState: () => 'NEEDS_ACTIVATION',
    getSnapshot: () => ({ state: 'NEEDS_ACTIVATION' }),
    onStateChanged() {},
    dispose() {
      calls.push('license:dispose');
      if (options.licenseDisposeError) throw options.licenseDisposeError;
    },
  };
  const controller = (name, idle) => ({
    dispose() {
      assert.equal(runtimeOpen, true, 'sync disposal still needs the runtime');
      calls.push(`${name}:dispose`);
      if (options.syncDisposeError) throw options.syncDisposeError;
    },
    whenIdle() {
      calls.push(`${name}:idle`);
      return idle.promise;
    },
  });
  const modules = {
    'node:fs': { mkdirSync() {}, existsSync: () => false },
    'node:path': path,
    'node:crypto': { randomUUID: () => 'shutdown-test' },
    electron: {
      app,
      BrowserWindow: FakeWindow,
      dialog: { showErrorBox: (_title, message) => startupErrors.push(message) },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      Menu: { setApplicationMenu() {} },
      protocol: { registerSchemesAsPrivileged() {} },
      session: { defaultSession: {} },
      shell: {},
      powerMonitor,
    },
    './desktop-state': { createDesktopState: () => state },
    './desktop-runtime': require('../../src/electron/desktop-runtime'),
    './desktop-auth-controller': {
      createDesktopAuthController: () => ({
        restoreMusicCookieSnapshots: () => options.musicRestore?.promise,
        restoreBilibiliCookieSnapshot: () => options.bilibiliRestore?.promise,
      }),
    },
    './desktop-update-controller': {
      createDesktopUpdateController: () => ({
        configureAutoUpdater() {},
        sendUpdateState() {},
        installUpdate: () => calls.push('update:install'),
      }),
    },
    './desktop-logger': {
      createDesktopLogger: () => ({
        writeLog: (scope, value) => logs.push({ scope, value }),
      }),
    },
    './desktop-user-data': {
      resolveDesktopUserDataPaths: () => ({ dataDir: app.getPath() }),
      migrateLegacyUserData() {},
    },
    './cloud-sync-controller': {
      createCloudSyncController() {
        calls.push('cloud:create');
        return controller('cloud', cloudIdle);
      },
    },
    './remote-gift-controller': {
      createRemoteGiftController() {
        calls.push('remote:create');
        return controller('remote', remoteIdle);
      },
    },
    './desktop-permissions': { registerLocalFontPermissionHandler() {} },
    './local-media-access': { createLocalMediaAccess: () => ({}) },
    './local-media-protocol': { registerLocalMediaProtocol() {} },
    './media-request-headers': {
      configureMediaRequestHeaders() {},
    },
    './update-manager': {},
    './playback-flush': {
      async requestPlaybackFlush() {
        assert.equal(runtimeOpen, true, 'playback flush precedes resource close');
        calls.push('playback:flush');
        await options.playbackFlush?.promise;
        calls.push('playback:flushed');
        return { status: 'ack' };
      },
    },
    './terminal-log': { installTerminalLog() {} },
    './ipc/update-ipc': require('../../src/electron/ipc/update-ipc'),
    './ipc/music-ipc': { registerMusicIpc() {} },
    './ipc/bilibili-ipc': { registerBilibiliIpc() {} },
    './ipc/license-ipc': { registerLicenseIpc() {} },
    './license/license-manager': {
      LicenseState: { AUTHORIZED: 'AUTHORIZED' },
      createLicenseManager() {
        calls.push('license:create');
        return licenseManager;
      },
    },
    './license/remote-license-client': { resolveConfiguredBaseUrl: () => '' },
    './license/license-resume': require('../../src/electron/license/license-resume'),
    '../server': runtime,
    './external-url-policy': {},
  };

  vm.runInNewContext(MAIN_SOURCE, {
    require(id) {
      assert.ok(Object.hasOwn(modules, id), `Unexpected main dependency: ${id}`);
      return modules[id];
    },
    __dirname: path.dirname(MAIN_PATH),
    process: { env: {}, platform: 'win32', pid: 12345 },
    console: { warn() {} },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    URL,
  }, { filename: MAIN_PATH });

  function quit() {
    const event = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    app.emit('before-quit', event);
    if (!event.defaultPrevented) calls.push('app:default-quit');
    return event;
  }

  return {
    calls, logs, state, clock, remoteIdle, cloudIdle, backendStop, startupErrors,
    powerMonitor, handlers, quit, settle,
    get runtimeOpen() { return runtimeOpen; },
    async start() {
      ready.resolve();
      await settle();
      assert.deepEqual(startupErrors, []);
    },
    restart: () => handlers.get('desktop:restart')(),
    count: (call) => calls.filter((value) => value === call).length,
  };
}

module.exports = { createShutdownHarness };
