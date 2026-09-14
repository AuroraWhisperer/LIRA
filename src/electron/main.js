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
const { createDynamicLotteryAuth } = require('./dynamic-lottery-auth');
const {
  registerDynamicLotteryAuthIpc,
} = require('./ipc/dynamic-lottery-auth-ipc');
const { createCloudSyncController } = require('./cloud-sync-controller');
const { createRemoteGiftController } = require('./remote-gift-controller');
const {
  createDesktopReadinessController,
} = require('./desktop-readiness-controller');
const { createDesktopLogger } = require('./desktop-logger');
const { createDesktopRuntime } = require('./desktop-runtime');
const {
  createDesktopUpdateController,
} = require('./desktop-update-controller');
const { createDesktopState } = require('./desktop-state');
const {
  migrateLegacyUserData,
  resolveDesktopUserDataPaths,
} = require('./desktop-user-data');
const {
  migrateBrowserData,
  migrateCacheData,
} = require('../storage/data-directory-migration');
const { registerLocalFontPermissionHandler } = require('./desktop-permissions');
const {
  createLocalMediaAccess,
  hasExactOrigin,
} = require('./local-media-access');
const { registerLocalMediaProtocol } = require('./local-media-protocol');
const { configureMediaRequestHeaders } = require('./media-request-headers');
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
var readinessController = null;
var dynamicLotteryAuth = null;
var disposeLotteryAuthIpc = null;
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

const desktopUserDataPaths = resolveDesktopUserDataPaths({
  isPackaged: app.isPackaged,
  appDataPath: app.getPath('appData'),
  exePath: app.getPath('exe'),
  rootDir: ROOT_DIR,
});
const userDataMigrationState = { migration: null, error: null };
var gotInstanceLock = false;
try {
  if (
    desktopUserDataPaths.recoveryDataDir &&
    fs.existsSync(desktopUserDataPaths.recoveryDataDir)
  ) {
    throw new Error(
      '上次安装的数据尚未恢复，请重新运行安装包。数据保留在：' +
        desktopUserDataPaths.recoveryDataDir,
    );
  }
  userDataMigrationState.migration = migrateLegacyUserData({
    sourceDir: desktopUserDataPaths.legacyDataDir,
    targetDir: desktopUserDataPaths.dataDir,
  });
  fs.mkdirSync(desktopUserDataPaths.dataDir, { recursive: true });
  // Keep the lock identity shared with old releases before relocating the profile.
  app.setPath('userData', desktopUserDataPaths.dataDir);
  gotInstanceLock = app.requestSingleInstanceLock();
  if (gotInstanceLock) {
    migrateBrowserData({ dataDir: desktopUserDataPaths.dataDir });
    migrateCacheData({ dataDir: desktopUserDataPaths.dataDir });
    fs.mkdirSync(desktopUserDataPaths.browserDir, { recursive: true });
    app.setPath('userData', desktopUserDataPaths.browserDir);
    app.setPath('sessionData', desktopUserDataPaths.browserDir);
    app.setPath('logs', desktopUserDataPaths.logDir);
    app.setPath(
      'crashDumps',
      path.join(desktopUserDataPaths.browserDir, 'Crashpad'),
    );
  }
} catch (error) {
  userDataMigrationState.error = error;
}
if (userDataMigrationState.error) {
  // Stop before Chromium creates an empty profile that would conflict with recovery.
  dialog.showErrorBox(
    '启动失败',
    '无法准备安装目录中的用户数据。LIRA 已停止启动：' +
      (userDataMigrationState.error.message ||
        String(userDataMigrationState.error)),
  );
  app.exit(1);
} else if (!gotInstanceLock) {
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
  if (!lifecycleState.shutdownPromise && !lifecycleState.shutdown) return;
  event.preventDefault();
  requestDesktopShutdown();
});

function requestDesktopShutdown({ restart = false } = {}) {
  if (lifecycleState.shutdownPromise) return lifecycleState.shutdownPromise;
  // The first request owns the final action and the deadline, including reentry.
  const { promise, resolve } = Promise.withResolvers();
  lifecycleState.shutdownPromise = promise;
  let finished = false;
  writeLog('lifecycle', { event: 'QUIT_BEGIN' });
  const forceQuitTimer = setTimeout(function () {
    finish('QUIT_TIMEOUT');
  }, 5000);

  function logError(error) {
    writeLog('shutdown-error', error);
    console.warn('Shutdown failed:', error.message);
  }

  function finish(event) {
    if (finished) return;
    finished = true;
    clearTimeout(forceQuitTimer);
    writeLog('lifecycle', { event });
    try {
      licenseManager?.dispose();
    } catch (error) {
      logError(error);
    }
    licenseManager = null;
    try {
      app.releaseSingleInstanceLock();
      if (restart) app.relaunch();
    } catch (error) {
      logError(error);
    } finally {
      app.exit(0);
      resolve();
    }
  }

  void (async function () {
    try {
      readinessController?.dispose();
      readinessController = null;
      licenseResumeController?.unregister();
      disposeLotteryAuthIpc?.();
      dynamicLotteryAuth?.dispose();
      const controllersToDrain = [
        remoteGiftController,
        cloudSyncController,
      ].filter(Boolean);
      for (const controller of controllersToDrain) controller.dispose();
      remoteGiftController = null;
      cloudSyncController = null;
      await Promise.all([
        dynamicLotteryAuth?.whenIdle(),
        ...controllersToDrain.map((controller) => controller.whenIdle()),
      ]);
      if (finished) return;
      await lifecycleState.shutdown?.({ exitProcess: false });
    } catch (error) {
      if (!finished) logError(error);
    } finally {
      finish('QUIT_DONE');
    }
  })();
  return promise;
}

// ---- startup ----

async function startDesktopApp() {
  configureDesktopEnvironment();
  writeLog('user-data-migration', userDataMigrationState.migration);
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
    requestRestart: () => requestDesktopShutdown({ restart: true }),
    getMainWindow: () => windowState.main,
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
      if (result?.state?.loggedIn) cloudSyncController?.markDirty('bilibili');
      return result;
    },
    logout: async () => {
      const result = await logoutBilibiliAccount();
      cloudSyncController?.markDirty('bilibili');
      return result;
    },
  });
  configureMediaRequestHeaders(session.defaultSession, mediaState);
  configureAutoUpdater();
  phaseStartedAt = Date.now();
  await restoreMusicCookieSnapshots();
  if (lifecycleState.shutdownPromise) return;
  logStartupPhase('music-cookie-restore', phaseStartedAt);
  phaseStartedAt = Date.now();
  await restoreBilibiliCookieSnapshot();
  if (lifecycleState.shutdownPromise) return;
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
      clearRemote: () => {
        if (!licenseManager?.clearGiftHistoryInternal) {
          throw new Error('LICENSE_NOT_AUTHORIZED');
        }
        return licenseManager.clearGiftHistoryInternal();
      },
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
    dynamicLotteryAuth: {
      getIdentity: () => dynamicLotteryAuth?.getIdentity(),
      getContext: () => dynamicLotteryAuth?.getContext(),
    },
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
  if (lifecycleState.shutdownPromise) return;
  logStartupPhase('runtime-ready', phaseStartedAt);

  licenseManager = createLicenseManager({
    dataDir: pathState.dataDir,
    safeStorage,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : '',
  });
  dynamicLotteryAuth = createDynamicLotteryAuth({
    session,
    safeStorage,
    dataDir: pathState.dataDir,
    licenseManager,
    BrowserWindow,
    shell,
    getMainWindow: () => windowState.main,
    writeLog,
  });
  disposeLotteryAuthIpc = registerDynamicLotteryAuthIpc({
    ipcMain,
    auth: dynamicLotteryAuth,
    getMainWindow: () => windowState.main,
    getDesktopBaseUrl: () => serverInfo.baseUrl,
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
  if (lifecycleState.shutdownPromise) return;
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
  readinessController = createDesktopReadinessController({
    licenseManager,
    runtime: lifecycleState.runtime,
    remoteGiftController,
    cloudSyncController,
    getMainWindow: () => windowState.main,
    baseUrl: serverInfo.baseUrl,
    writeLog,
  });
  createMainWindow(
    serverInfo.baseUrl,
    readinessController.initialRoute === 'admin',
  );
  readinessController.start();
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
  pathState.dataDir = desktopUserDataPaths.dataDir;
  pathState.logDir = desktopUserDataPaths.logDir;
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
