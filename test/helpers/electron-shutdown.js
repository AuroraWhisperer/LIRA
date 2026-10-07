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

// Unmodelled main dependencies resolve to inert stubs so one new require does not
// break every shutdown scenario; electron-shutdown.test.js reports them instead.
function createInertModule() {
  const inert = new Proxy(function inertStub() {}, {
    get: (_target, key) => (key === 'then' ? undefined : inert),
    apply: () => inert,
    construct: () => inert,
  });
  return inert;
}

function createClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const delays = [];
  return {
    delays,
    get pending() {
      return timers.size;
    },
    setTimeout(callback, delay) {
      const id = ++nextId;
      delays.push(delay);
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
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
  const storageCalls = [];
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
  let requestRestart;
  const unmodelledDependencies = [];
  let runtimeOptions;
  let runtimeStartOptions;
  const safeStorage = { synthetic: 'safe-storage' };
  let publishSceneCloud;
  const sceneUpdates = [];

  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    getPath: () => 'C:\\synthetic-lira-shutdown',
    setPath(name, value) {
      calls.push('app:path:' + name);
      storageCalls.push({ type: 'path', name, value });
    },
    getName: () => 'LIRA',
    setName() {},
    setAppUserModelId() {},
    getVersion: () => '0.0.0-test',
    requestSingleInstanceLock() {
      storageCalls.push({ type: 'lock' });
      return options.instanceLock !== false;
    },
    whenReady() {
      storageCalls.push({ type: 'ready' });
      return ready.promise;
    },
    releaseSingleInstanceLock: () => calls.push('app:release-lock'),
    relaunch: () => calls.push('app:relaunch'),
    exit(code) {
      assert.equal(code, options.recoveryDataDir || options.migrationError ? 1 : 0);
      state.window.main?.destroy();
      calls.push('app:exit');
    },
    quit() {
      return quit();
    },
  });

  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.isDestroyed = () => this.destroyed;
      this.webContents.mainFrame = { url: 'http://127.0.0.1:3000/license' };
      this.webContents.send = (channel) => calls.push('ipc:' + channel);
    }
    loadURL() {
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }
    close() {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      this.emit('close', event);
      if (!event.defaultPrevented) {
        this.destroy();
        app.emit('window-all-closed');
      }
    }
  }

  const runtime = {
    start(startOptions) {
      runtimeStartOptions = startOptions;
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
    setPreShutdownHook(hook) {
      preShutdownHook = hook;
    },
    onGiftCatalogInitializationStateChanged() {},
    receiveSceneCloud(update) {
      assert.equal(runtimeOpen, true);
      sceneUpdates.push(update);
    },
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
    './desktop-resource-integrity': {
      createDesktopResourceIntegrity: () => ({
        stop() {
          calls.push('integrity:stop');
          return options.integrityIdle?.promise || Promise.resolve();
        },
        getState: () => ({ status: 'idle' }),
      }),
    },
    'node:fs': {
      mkdirSync() {},
      existsSync: (value) => Boolean(options.recoveryDataDir && value === options.recoveryDataDir),
    },
    'node:path': path,
    'node:crypto': { randomUUID: () => 'shutdown-test' },
    electron: {
      app,
      BrowserWindow: FakeWindow,
      dialog: {
        showErrorBox: (_title, message) => startupErrors.push(message),
      },
      ipcMain: {
        removeHandler: (channel) => handlers.delete(channel),
        handle: (channel, handler) =>
          handlers.set(channel, (...args) => {
            const sender = state.window.main?.webContents;
            return handler({ sender, senderFrame: sender?.mainFrame }, ...args);
          }),
      },
      Menu: { setApplicationMenu() {} },
      protocol: { registerSchemesAsPrivileged() {} },
      safeStorage,
      session: { defaultSession: {} },
      shell: {},
      powerMonitor,
    },
    './desktop-readiness-controller': require('../../src/electron/desktop-readiness-controller'),
    './desktop-state': { createDesktopState: () => state },
    './client-appearance': {
      ...require('../../src/electron/client-appearance'),
      createClientAppearance: () => ({ getThemeId: () => 'neutral', whenIdle: () => options.appearanceIdle?.promise }),
    },
    './ipc/client-appearance-ipc': require('../../src/electron/ipc/client-appearance-ipc'),
    './desktop-runtime': require('../../src/electron/desktop-runtime'),
    './desktop-auth-controller': {
      createDesktopAuthController: () => ({
        dispose: () => calls.push('auth:dispose'),
        whenIdle: () => options.authIdle?.promise,
        restoreMusicCookieSnapshots: () => options.musicRestore?.promise,
        restoreBilibiliCookieSnapshot: () => options.bilibiliRestore?.promise,
      }),
    },
    './dynamic-lottery-auth': {
      createDynamicLotteryAuth: () => ({
        dispose: () => calls.push('lottery:dispose'),
        whenIdle: () => options.lotteryIdle?.promise,
      }),
    },
    './ipc/dynamic-lottery-auth-ipc': {
      registerDynamicLotteryAuthIpc: () => () => calls.push('lottery:remove-ipc'),
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
      resolveDesktopUserDataPaths: () => ({
        ...require('../../src/shared/data-paths').resolveDataPaths(app.getPath()),
        recoveryDataDir: options.recoveryDataDir,
      }),
      migrateLegacyUserData() {},
    },
    '../storage/data-directory-migration': {
      migrateBrowserData() {
        storageCalls.push({ type: 'browser-migration' });
        if (options.migrationError) throw options.migrationError;
      },
      migrateCacheData() {
        storageCalls.push({ type: 'cache-migration' });
      },
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
        return {
          ...controller('remote', remoteIdle),
          start() {
            calls.push('remote:start');
            return true;
          },
        };
      },
    },
    './scene-cloud-controller': {
      getSceneOwner(manager) {
        assert.equal(manager, licenseManager);
        return options.sceneOwner || null;
      },
      createSceneCloudController({ licenseManager: manager, publish }) {
        assert.equal(manager, licenseManager);
        calls.push('scene:create');
        publishSceneCloud = publish;
        return {
          ...controller('scene', { promise: options.sceneIdle?.promise }),
          start: () => calls.push('scene:start'),
        };
      },
    },
    './fan-profile-controller': {
      fanScopeFor: () => null,
      createFanProfileController: () => ({
        ...controller('fan', { promise: options.fanIdle?.promise }),
        start() {
          calls.push('fan:start');
        },
      }),
    },
    '../bilibili/guard-roster': { fetchGuardRoster() {} },
    './ipc/fan-profile-ipc': {
      registerFanProfileIpc: () => () => calls.push('fan:remove-ipc'),
    },
    './daily-bot-controller': {
      createDailyBotController: () => ({ dispose: () => calls.push('daily-bot:dispose') }),
    },
    './planner-reminder-controller': {
      createPlannerReminderController: () => ({ dispose: () => calls.push('planner-reminder:dispose') }),
    },
    './ipc/planner-reminder-ipc': {
      registerPlannerReminderIpc: () => () => calls.push('planner-reminder:remove-ipc'),
    },
    './ipc/daily-bot-ipc': {
      registerDailyBotIpc:
        ({ controller }) =>
        () => {
          calls.push('daily-bot:remove-ipc');
          controller.dispose();
        },
    },
    './desktop-permissions': { registerLocalFontPermissionHandler() {} },
    './local-media-access': { createLocalMediaAccess: () => ({}) },
    './local-media-protocol': { registerLocalMediaProtocol() {} },
    './media-request-headers': {
      configureMediaRequestHeaders() {},
    },
    './desktop-request-auth': require('../../src/electron/desktop-request-auth'),
    './update-manager': {},
    './playback-flush': options.realPlaybackFlush ? require('../../src/electron/playback-flush') : {
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
    './ipc/gift-interaction-ipc': {
      registerGiftInteractionIpc: () => () => calls.push('gift-interaction:remove-ipc'),
    },
    './ipc/gift-export-ipc': { registerGiftExportIpc: () => () => {} },
    './gift-export-controller': { createGiftExportController: () => ({}) },
    './component-web-picker': { createComponentWebPicker: () => async () => null },
    './license/license-manager': {
      LicenseState: { AUTHORIZED: 'AUTHORIZED' },
      createLicenseManager() {
        calls.push('license:create');
        return licenseManager;
      },
    },
    './license/remote-license-client': { resolveConfiguredBaseUrl: () => '' },
    './license/license-resume': require('../../src/electron/license/license-resume'),
    '../server': {
      createServerRuntime(options) {
        runtimeOptions = options;
        return runtime;
      },
    },
    './external-url-policy': {},
  };

  vm.runInNewContext(
    MAIN_SOURCE + '\ncaptureRestart(() => requestDesktopShutdown({ restart: true }));',
    {
      require(id) {
        if (Object.hasOwn(modules, id)) return modules[id];
        unmodelledDependencies.push(id);
        return createInertModule();
      },
      __dirname: path.dirname(MAIN_PATH),
      process: { env: {}, platform: 'win32', pid: 12345 },
      console: { warn() {} },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      URL,
      captureRestart: (callback) => {
        requestRestart = callback;
      },
    },
    { filename: MAIN_PATH },
  );

  function quit() {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    app.emit('before-quit', event);
    if (!event.defaultPrevented) calls.push('app:default-quit');
    return event;
  }

  return {
    calls,
    logs,
    state,
    clock,
    remoteIdle,
    cloudIdle,
    backendStop,
    startupErrors,
    unmodelledDependencies,
    storageCalls,
    powerMonitor,
    handlers,
    sceneUpdates,
    publishSceneCloud: (update) => publishSceneCloud(update),
    get runtimeOptions() {
      return runtimeOptions;
    },
    get runtimeStartOptions() {
      return runtimeStartOptions;
    },
    safeStorage,
    quit,
    settle,
    get runtimeOpen() {
      return runtimeOpen;
    },
    async start({ expectStartupError = false } = {}) {
      ready.resolve();
      await settle();
      if (!expectStartupError) assert.deepEqual(startupErrors, []);
    },
    restart: () => handlers.get('desktop:restart')(),
    requestRestart: () => requestRestart(),
    count: (call) => calls.filter((value) => value === call).length,
  };
}

module.exports = { createShutdownHarness };
