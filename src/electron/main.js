'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  powerMonitor,
} = require('electron');
const { createDesktopAuthController } = require('./desktop-auth-controller');
const { createCloudSyncController } = require('./cloud-sync-controller');
const { createRemoteGiftController } = require('./remote-gift-controller');
const { createDesktopLogger } = require('./desktop-logger');
const { createDesktopRuntime } = require('./desktop-runtime');
const {
  createDesktopUpdateController,
} = require('./desktop-update-controller');
const { createDesktopState } = require('./desktop-state');
const { registerLocalFontPermissionHandler } = require('./desktop-permissions');
const {
  createLocalMediaAccess,
  hasExactOrigin,
} = require('./local-media-access');
const { registerLocalMediaProtocol } = require('./local-media-protocol');
const {
  configureMusicMediaRequestHeaders,
  configureBilibiliMediaRequestHeaders,
} = require('./media-request-headers');
const updateMgr = require('./update-manager');
const playbackFlush = require('./playback-flush');
const { installTerminalLog } = require('./terminal-log');
const { registerUpdateIpc } = require('./ipc/update-ipc');
const { registerMusicIpc } = require('./ipc/music-ipc');
const { registerBilibiliIpc } = require('./ipc/bilibili-ipc');
const { registerLicenseIpc } = require('./ipc/license-ipc');
const {
  createLicenseManager,
  LicenseState,
} = require('./license/license-manager');
const { resolveConfiguredBaseUrl } = require('./license/remote-license-client');
const { createLicenseResumeHandler } = require('./license/license-resume');
const serverRuntimeModule = require('../server');
const {
  isAllowedExternal,
  isAllowedLocalUrl,
} = require('./external-url-policy');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const GITHUB_REPO_URL = 'https://github.com/AuroraWhisperer/LIRA';
const desktopState = createDesktopState();
const windowState = desktopState.window;
const lifecycleState = desktopState.lifecycle;
const mediaState = desktopState.media;
const pathState = desktopState.paths;
const loggingState = desktopState.logging;
const updateRuntime = desktopState.update;
const startupTiming = { startedAt: 0 };
const { writeLog, nextSequence: nextLogSequence } = createDesktopLogger({
  getLogFile: () => pathState.logFile,
  loggingState,
});
const desktopAuth = createDesktopAuthController({
  BrowserWindow,
  shell,
  getMainWindow: () => windowState.main,
  getDataDir: () => pathState.dataDir,
  writeLog,
});
const {
  getMusicAuthState,
  getMusicCookieHeader,
  getMusicProviderRegistry,
  loginMusicAccount,
  logoutMusicAccount,
  clearMusicBrowserCache,
  restoreMusicCookieSnapshots,
  getBilibiliAuthState,
  getBilibiliAccountProfile,
  getBilibiliCookieHeader,
  getBilibiliUid,
  restoreBilibiliCookieSnapshot,
  replaceBilibiliCookieHeader,
  loginBilibiliAccount,
  logoutBilibiliAccount,
} = desktopAuth;
const desktopUpdate = createDesktopUpdateController({
  app,
  updateManager: updateMgr,
  updateRuntime,
  getRuntime: () => lifecycleState.runtime,
  getMainWindow: () => windowState.main,
  writeLog,
});
const {
  configureAutoUpdater,
  checkForUpdates,
  readAutoUpdateSetting,
  downloadUpdate,
  installUpdate,
  setUpdateError,
  sendUpdateState,
} = desktopUpdate;
var licenseManager = null;
var licenseResumeController = null;
var cloudSyncController = null;
var remoteGiftController = null;
const remoteGiftCatalogBootstrapBase = resolveConfiguredBaseUrl();

// ---- app lifecycle ----

// Register local-media:// protocol for local audio file playback
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

// 将 Electron userData 目录重定向到应用安装目录下的 data/，
// 确保卸载时所有登录态（包括 Chromium 持久化分区）一并清理，
// 不会残留在 %APPDATA% 中。
const appDir = app.isPackaged ? path.dirname(app.getPath('exe')) : ROOT_DIR;
app.setPath('userData', path.join(appDir, 'data'));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app
    .whenReady()
    .then(startDesktopApp)
    .catch(function (error) {
      dialog.showErrorBox('启动失败', error.message || String(error));
      app.quit();
    });
}

app.setName('LIRA');

app.on('second-instance', function () {
  if (!windowState.main) return;
  if (windowState.main.isMinimized()) windowState.main.restore();
  windowState.main.focus();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', function (event) {
  if (lifecycleState.gracefulQuitStarted || !lifecycleState.shutdown) return;
  event.preventDefault();
  lifecycleState.gracefulQuitStarted = true;
  licenseResumeController?.unregister();
  const controllersToDrain = [remoteGiftController, cloudSyncController].filter(
    Boolean,
  );
  for (const controller of controllersToDrain) controller.dispose();
  remoteGiftController = null;
  cloudSyncController = null;
  writeLog('lifecycle', { event: 'QUIT_BEGIN' });
  lifecycleState.forceQuitTimer = setTimeout(function () {
    writeLog('lifecycle', { event: 'QUIT_TIMEOUT' });
    app.releaseSingleInstanceLock();
    app.exit(0);
  }, 5000);
  Promise.all(
    controllersToDrain.map((controller) => controller.whenIdle()),
  )
    .then(function () {
      return lifecycleState.shutdown({ exitProcess: false });
    })
    .catch(function (error) {
      writeLog('shutdown-error', error);
      console.warn('Shutdown failed:', error.message);
    })
    .finally(function () {
      if (lifecycleState.forceQuitTimer) {
        clearTimeout(lifecycleState.forceQuitTimer);
        lifecycleState.forceQuitTimer = null;
      }
      writeLog('lifecycle', { event: 'QUIT_DONE' });
      licenseManager?.dispose();
      licenseManager = null;
      app.releaseSingleInstanceLock();
      app.exit(0);
    });
});

// ---- startup ----

async function startDesktopApp() {
  configureDesktopEnvironment();
  const startupStartedAt = Date.now();
  startupTiming.startedAt = startupStartedAt;
  logStartupPhase('start', startupStartedAt);
  var phaseStartedAt = Date.now();
  migrateUserDataFromAppData();
  logStartupPhase('partition-migration', phaseStartedAt);
  configureMenu();
  configureLocalMediaProtocol();
  registerUpdateIpc({
    ipcMain,
    app,
    shell,
    getDataDir: () => pathState.dataDir,
    getLogFile: () => pathState.logFile,
    getLogDir: () => pathState.logDir,
    getTerminalLogFile: () => pathState.terminalLogFile,
    getUpdateState: () => updateRuntime.value,
    githubRepoUrl: GITHUB_REPO_URL,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    getShutdownApplication: () => lifecycleState.shutdown,
    getMainWindow: () => windowState.main,
    normalizeGiftDisplayTrace,
    writeLog,
  });
  registerMusicIpc({
    ipcMain,
    dialog,
    getMainWindow: () => windowState.main,
    getDesktopBaseUrl: () => windowState.baseUrl,
    getDesktopRuntime: () => lifecycleState.runtime,
    getAppDataPath: () => app.getPath('appData'),
    getLocalMediaAccess: () => mediaState.localAccess,
    getMusicAuthState,
    loginMusicAccount,
    logoutMusicAccount,
    clearMusicBrowserCache,
    getMusicProviderRegistry,
    hasExactOrigin,
    isPathAllowedForLocalMedia,
    acknowledgePlaybackFlush: playbackFlush.acknowledgePlaybackFlush,
    writePlaybackSnapshot: (payload, clientId) => {
      if (
        !lifecycleState.runtime ||
        typeof lifecycleState.runtime.persistPlaybackSnapshot !== 'function'
      ) {
        return { ok: false, error: 'Playback store not available' };
      }
      return lifecycleState.runtime.persistPlaybackSnapshot(payload, clientId);
    },
  });
  registerBilibiliIpc({
    ipcMain,
    getAuthState: getBilibiliAuthState,
    getProfile: getBilibiliAccountProfile,
    login: async () => {
      const result = await loginBilibiliAccount();
      cloudSyncController?.markDirty('bilibili');
      return result;
    },
    logout: async () => {
      const result = await logoutBilibiliAccount();
      cloudSyncController?.markDirty('bilibili');
      return result;
    },
  });
  configureMusicMediaRequestHeaders(session.defaultSession, mediaState);
  configureBilibiliMediaRequestHeaders(session.defaultSession);
  configureAutoUpdater();
  phaseStartedAt = Date.now();
  await restoreMusicCookieSnapshots();
  logStartupPhase('music-cookie-restore', phaseStartedAt);
  phaseStartedAt = Date.now();
  await restoreBilibiliCookieSnapshot();
  logStartupPhase('bilibili-cookie-restore', phaseStartedAt);

  var serverOptions = {
    host: process.env.HOST || '127.0.0.1',
    startPort: 3000,
    musicAuth: {
      getAuthState: getMusicAuthState,
      getCookieHeader: getMusicCookieHeader,
    },
    bilibiliAuth: {
      getAuthState: getBilibiliAuthState,
      getCookieHeader: getBilibiliCookieHeader,
      getUid: getBilibiliUid,
    },
    giftSync: {
      rebuild: () => remoteGiftController?.start() ?? false,
    },
    remoteGiftCatalog: {
      // The callback is evaluated after the license manager is created. It
      // deliberately exposes no token or remote client to the renderer.
      fetch: (request) =>
        licenseManager?.getState() === LicenseState.AUTHORIZED
          ? licenseManager.getGiftCatalog(request)
          : null,
      imageBaseUrl: () =>
        licenseManager?.getRemoteBaseUrl?.() || remoteGiftCatalogBootstrapBase,
    },
  };
  lifecycleState.runtime = createDesktopRuntime(serverRuntimeModule, {
    dataDir: pathState.dataDir,
    safeStorage,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : '',
    licenseGate: {
      isAuthorized: () =>
        licenseManager?.getState() === LicenseState.AUTHORIZED,
    },
    onPhase: (phase, durationMs, extra) =>
      writeLog('lifecycle', {
        event: 'PHASE',
        phase,
        durationMs,
        ...extra,
      }),
  });
  lifecycleState.shutdown = lifecycleState.runtime.stop.bind(
    lifecycleState.runtime,
  );

  // Register pre-shutdown hook: flush renderer playback state via IPC before closing server/DB
  lifecycleState.runtime.setPreShutdownHook(requestPlaybackFlush);

  phaseStartedAt = Date.now();
  var serverInfo = await lifecycleState.runtime.start(serverOptions);
  logStartupPhase('runtime-ready', phaseStartedAt);

  licenseManager = createLicenseManager({
    dataDir: pathState.dataDir,
    safeStorage,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : '',
  });
  registerLicenseIpc({
    ipcMain,
    licenseManager,
    giftCatalog: {
      getState: () =>
        lifecycleState.runtime.getGiftCatalogInitializationState(),
      initialize: () =>
        lifecycleState.runtime.initializeGiftCatalog({
          force: true,
          reason: 'license-retry',
        }),
      onStateChanged: (listener) =>
        lifecycleState.runtime.onGiftCatalogInitializationStateChanged(
          listener,
        ),
    },
    getMainWindow: () => windowState.main,
    getDesktopBaseUrl: () => serverInfo.baseUrl,
    hasExactOrigin,
  });
  await licenseManager.bootstrap();
  writeLog('license-state', {
    event: 'bootstrap',
    ...licenseManager.getSnapshot(),
  });
  cloudSyncController = createCloudSyncController({
    licenseManager,
    runtime: lifecycleState.runtime,
    bilibiliAuth: {
      getAuthState: getBilibiliAuthState,
      getCookieHeader: getBilibiliCookieHeader,
      replaceCookieHeader: replaceBilibiliCookieHeader,
      logout: logoutBilibiliAccount,
    },
  });
  remoteGiftController = createRemoteGiftController({
    licenseManager,
    runtime: lifecycleState.runtime,
  });
  licenseResumeController = createLicenseResumeHandler({
    powerMonitor,
    getLicenseManager: () => licenseManager,
    afterResume: async () => {
      await cloudSyncController?.syncNow();
      await remoteGiftController?.resume();
    },
    writeLog,
  });
  licenseResumeController.register();

  registerLocalFontPermissionHandler({
    desktopSession: session.defaultSession,
    dialog,
    desktopBaseUrl: serverInfo.baseUrl,
    getMainWindow: () => windowState.main,
    hasExactOrigin,
  });
  phaseStartedAt = Date.now();
  let mainRoute =
    licenseManager.getState() === LicenseState.AUTHORIZED &&
    lifecycleState.runtime.isGiftCatalogInitialized()
      ? 'admin'
      : 'license';
  createMainWindow(
    serverInfo.baseUrl,
    mainRoute === 'admin',
  );
  let mainNavigationGeneration = 0;
  const navigateMain = (route) => {
    if (
      mainRoute === route ||
      !windowState.main ||
      windowState.main.isDestroyed()
    )
      return;
    mainRoute = route;
    const navigationGeneration = ++mainNavigationGeneration;
    const pathname = route === 'admin' ? '/admin?desktop=1' : '/license';
    windowState.main
      .loadURL(windowState.baseUrl + pathname)
      .catch((error) => {
        if (
          navigationGeneration === mainNavigationGeneration &&
          mainRoute === route
        )
          mainRoute = '';
        writeLog('license-navigation', error);
      });
  };
  const refreshGiftCatalogForAuthorizedSession = (request) => {
    const initialization = lifecycleState.runtime.initializeGiftCatalog(request);
    initialization?.catch?.((error) =>
      writeLog('gift-catalog-initialization', error),
    );
    return initialization;
  };
  lifecycleState.runtime.onGiftCatalogInitializationStateChanged((snapshot) => {
    if (
      snapshot?.status === 'ready' &&
      licenseManager?.getState() === LicenseState.AUTHORIZED &&
      lifecycleState.runtime.isGiftCatalogInitialized()
    ) {
      navigateMain('admin');
    }
  });
  licenseManager.onStateChanged((snapshot) => {
    writeLog('license-state', {
      event: 'changed',
      state: snapshot.state,
      error: snapshot.error || null,
    });
    if (snapshot.state === LicenseState.AUTHORIZED) {
      const resumePromise = Promise.all([
        remoteGiftController?.start(),
        cloudSyncController
          ?.whenIdle()
          .then(() => lifecycleState.runtime.resumeAuthorizedWork?.()),
      ]);
      if (resumePromise?.catch)
        resumePromise.catch((error) => writeLog('license-resume', error));
      if (lifecycleState.runtime.isGiftCatalogInitialized()) {
        navigateMain('admin');
        refreshGiftCatalogForAuthorizedSession({
          force: true,
          reason: 'authorized-session',
        });
      } else {
        navigateMain('license');
        refreshGiftCatalogForAuthorizedSession({
          force: true,
          reason: 'first-authorization',
        });
      }
    } else {
      remoteGiftController?.stop();
    }
    if (
      snapshot.state !== LicenseState.AUTHORIZED &&
      snapshot.state !== LicenseState.CHECKING &&
      snapshot.state !== LicenseState.AUTHORIZING
    ) {
      lifecycleState.runtime.pauseAuthorizedWork?.();
      navigateMain('license');
    }
  });
  if (licenseManager.getState() === LicenseState.AUTHORIZED) {
    const resumePromise = Promise.all([
      remoteGiftController.start(),
      cloudSyncController
        .start()
        .catch((error) => writeLog('cloud-sync', error))
        .then(() => lifecycleState.runtime.resumeAuthorizedWork?.()),
    ]);
    if (resumePromise?.catch)
      resumePromise.catch((error) => writeLog('license-resume', error));
    refreshGiftCatalogForAuthorizedSession({
      force: true,
      reason: lifecycleState.runtime.isGiftCatalogInitialized()
        ? 'authorized-startup'
        : 'first-authorized-startup',
    });
  }
  logStartupPhase('window-create', phaseStartedAt);
  writeLog('lifecycle', { event: 'READY', baseUrl: serverInfo.baseUrl });

  if (!app.isPackaged) {
    updateRuntime.value = {
      ...updateRuntime.value,
      status: 'dev-disabled',
      message: '开发模式不检查 GitHub 更新；打包安装后自动启用。',
      canDownload: false,
      canInstall: false,
    };
    sendUpdateState();
  }
}

function configureDesktopEnvironment() {
  pathState.dataDir = app.getPath('userData');
  pathState.logDir = path.join(path.dirname(pathState.dataDir), 'logs');
  pathState.logFile = path.join(pathState.logDir, 'desktop.log');
  pathState.terminalLogFile = path.join(pathState.logDir, 'terminal.log');
  fs.mkdirSync(pathState.dataDir, { recursive: true });
  fs.mkdirSync(pathState.logDir, { recursive: true });
  loggingState.runId = crypto.randomUUID();
  loggingState.sequence = 0;
  installTerminalLog(pathState.terminalLogFile, {
    runId: loggingState.runId,
    pid: process.pid,
    processType: process.type || 'browser',
    nextSequence: nextLogSequence,
  });
  writeLog('lifecycle', {
    event: 'START',
    dataDir: pathState.dataDir,
    logDir: pathState.logDir,
    isPackaged: app.isPackaged,
  });
  mediaState.localAccess = createLocalMediaAccess(pathState.dataDir);
  process.env.SONG_PLUGIN_DATA_DIR = pathState.dataDir;
  process.env.ELECTRON_DESKTOP = '1';
  if (!process.env.HOST) process.env.HOST = '127.0.0.1';
}

// 将旧版本残留在 %APPDATA% 下的 Chromium 分区数据迁移到新的 userData 目录，
// 确保已安装用户在升级后不会丢失登录状态。
function migrateUserDataFromAppData() {
  const oldUserData = path.join(app.getPath('appData'), app.getName());
  const newUserData = app.getPath('userData');
  if (oldUserData === newUserData) return;

  const oldPartitions = path.join(oldUserData, 'Partitions');
  const newPartitions = path.join(newUserData, 'Partitions');

  if (fs.existsSync(oldPartitions) && !fs.existsSync(newPartitions)) {
    try {
      fs.cpSync(oldPartitions, newPartitions, { recursive: true });
      writeLog(
        'migration',
        '已将旧 Chromium 分区数据从 ' +
          oldPartitions +
          ' 迁移至 ' +
          newPartitions,
      );
    } catch (e) {
      writeLog('migration-error', e);
    }
  }
}

function configureMenu() {
  Menu.setApplicationMenu(null);
}

function isPathAllowedForLocalMedia(filePath) {
  return Boolean(
    mediaState.localAccess && mediaState.localAccess.isAllowed(filePath),
  );
}

function configureLocalMediaProtocol() {
  registerLocalMediaProtocol(protocol, isPathAllowedForLocalMedia);
}

function createMainWindow(baseUrl, authorized = false) {
  windowState.baseUrl = baseUrl;
  var opts = {
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'LIRA',
    backgroundColor: '#f7f3ef',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  var iconPath = path.join(ROOT_DIR, 'build', 'icon.png');
  if (fs.existsSync(iconPath)) opts.icon = iconPath;

  windowState.main = new BrowserWindow(opts);
  writeLog('window', { event: 'create', window: 'main' });
  windowState.main.loadURL(
    baseUrl + (authorized ? '/admin?desktop=1' : '/license'),
  );

  windowState.main.once('ready-to-show', function () {
    writeLog('window', { event: 'ready', window: 'main' });
    logStartupPhase('ready-to-show', startupTiming.startedAt || Date.now());
    windowState.main.show();
    sendUpdateState();
    if (app.isPackaged && readAutoUpdateSetting()) {
      setTimeout(function () {
        checkForUpdates().catch(function (e) {
          setUpdateError(e);
        });
      }, 1000);
    }
  });

  windowState.main.webContents.setWindowOpenHandler(function (detail) {
    if (isAllowedExternal(detail.url) || isAllowedLocalUrl(detail.url)) {
      shell.openExternal(detail.url);
    }
    return { action: 'deny' };
  });

  windowState.main.webContents.on('will-navigate', function (event, url) {
    var parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      parsed = null;
    }
    var base = new URL(baseUrl);
    if (
      parsed &&
      parsed.protocol === base.protocol &&
      parsed.hostname === base.hostname &&
      parsed.port === base.port
    )
      return;
    event.preventDefault();
    if (isAllowedExternal(url) || isAllowedLocalUrl(url)) {
      shell.openExternal(url);
    }
  });

  windowState.main.on('closed', function () {
    writeLog('window', { event: 'closed', window: 'main' });
    windowState.main = null;
  });

  windowState.main.on('maximize', function () {
    if (windowState.main && !windowState.main.isDestroyed()) {
      windowState.main.webContents.send('desktop:window-maximized', true);
    }
  });

  windowState.main.on('unmaximize', function () {
    if (windowState.main && !windowState.main.isDestroyed()) {
      windowState.main.webContents.send('desktop:window-maximized', false);
    }
  });
}

function logStartupPhase(phase, startedAt, extra = {}) {
  if (!pathState.logFile) return;
  writeLog('lifecycle', {
    event: 'PHASE',
    phase,
    durationMs: Math.max(0, Date.now() - Number(startedAt || Date.now())),
    ...extra,
  });
}

async function requestPlaybackFlush() {
  var result = await playbackFlush.requestPlaybackFlush(windowState.main);
  writeLog('playback-flush', result);
  return result;
}

function normalizeGiftDisplayTrace(gift) {
  var value = gift && typeof gift === 'object' ? gift : {};
  return {
    eventId: Number(value.eventId) || 0,
    giftId: String(value.giftId || ''),
    giftName: String(value.giftName || '').slice(0, 200),
    uid: String(value.uid || ''),
    userName: String(value.userName || '').slice(0, 200),
    num: Math.max(1, Number(value.num) || 1),
    totalPrice: Number(value.totalPrice) || 0,
    toastKey: String(value.toastKey || '').slice(0, 200),
  };
}
