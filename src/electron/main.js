'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  app,
  autoUpdater,
  BrowserWindow,
  desktopCapturer,
  screen,
  dialog,
  ipcMain,
  Menu,
  Notification,
  net,
  nativeImage,
  protocol,
  safeStorage,
  session,
  shell,
  powerMonitor,
} = require('electron');
const { createDesktopAuthController } = require('./desktop-auth-controller');
const { createDoubaoSession } = require('./doubao-session');
const { createDynamicLotteryAuth } = require('./dynamic-lottery-auth');
const { registerDynamicLotteryAuthIpc } = require('./ipc/dynamic-lottery-auth-ipc');
const { createCloudSyncController } = require('./cloud-sync-controller');
const { createFanProfileController, fanScopeFor } = require('./fan-profile-controller');
const { registerFanProfileIpc } = require('./ipc/fan-profile-ipc');
const { fetchGuardRoster } = require('../bilibili/guard-roster');
const { BilibiliApiClient } = require('../bilibili/danmaku/api-client');
const { createDailyBotController } = require('./daily-bot-controller');
const { createPlannerReminderController } = require('./planner-reminder-controller');
const { registerPlannerReminderIpc } = require('./ipc/planner-reminder-ipc');
const { createDesktopNotifications, configureNotificationIdentity } = require('./desktop-notifications');
const { registerDesktopNotificationsIpc } = require('./ipc/desktop-notifications-ipc');
const { registerDailyBotIpc } = require('./ipc/daily-bot-ipc');
const { createRemoteGiftController } = require('./remote-gift-controller');
const { createSceneCloudController, getSceneOwner, getComponentPreviewOwner } = require('./scene-cloud-controller');
const { createDesktopReadinessController } = require('./desktop-readiness-controller');
const { createDesktopLogger } = require('./desktop-logger');
const { installDesktopDiagnostics } = require('./desktop-diagnostics');
const { installLogMaintenance } = require('./log-maintenance');
const { createDesktopRuntime } = require('./desktop-runtime');
const { createDesktopUpdateController } = require('./desktop-update-controller');
const { createDesktopLifecycle } = require('./desktop-lifecycle');
const { createDesktopMainWindow } = require('./desktop-main-window');
const { createClientAppearance } = require('./client-appearance');
const { registerClientAppearanceIpc } = require('./ipc/client-appearance-ipc');
const { registerScreenColorPicker } = require('./screen-color-picker');
const { createAudioAssistant } = require('./audio-assistant');
const { createAudioComponentManager } = require('./audio-component-manager');
const { registerAudioAssistantIpc } = require('./ipc/audio-assistant-ipc');
const { createPlaybackOutput } = require('./playback-output');
const { registerPlaybackOutputIpc } = require('./ipc/playback-output-ipc');
const { migrateLegacyUserData, migrateLegacyPartitions, resolveDesktopUserDataPaths } = require('./desktop-user-data');
const { migrateBrowserData, migrateCacheData } = require('../storage/data-directory-migration');
const { registerLocalFontPermissionHandler } = require('./desktop-permissions');
const { createLocalMediaAccess, hasExactOrigin } = require('./local-media-access');
const { registerLocalMediaProtocol } = require('./local-media-protocol');
const { configureMediaRequestHeaders } = require('./media-request-headers');
const { configureAudioMediaCors } = require('./audio-media-cors');
const { createDesktopRequestAuth } = require('./desktop-request-auth');
const updateMgr = require('./update-manager');
const playbackFlush = require('./playback-flush');
const { installTerminalLog } = require('./terminal-log');
const { registerDesktopShellIpc } = require('./ipc/desktop-shell-ipc');
const { createDesktopResourceIntegrity } = require('./desktop-resource-integrity');
const { registerMusicIpc } = require('./ipc/music-ipc');
const { registerBilibiliIpc } = require('./ipc/bilibili-ipc');
const { createGuardExpiryAuth } = require('./guard-expiry-auth');
const { registerGuardExpiryIpc } = require('./ipc/guard-expiry-ipc');
const { registerLicenseIpc } = require('./ipc/license-ipc');
const { registerGiftInteractionIpc } = require('./ipc/gift-interaction-ipc');
const { registerGiftExportIpc } = require('./ipc/gift-export-ipc');
const { createGiftExportController } = require('./gift-export-controller');
const { createWeeklyScheduleExportController } = require('./weekly-schedule-export-controller');
const { registerWeeklyScheduleIpc } = require('./ipc/weekly-schedule-ipc');
const { createLicenseManager, LicenseState } = require('./license/license-manager');
const { resolveConfiguredBaseUrl } = require('./license/remote-license-client');
const { createLicenseResumeHandler } = require('./license/license-resume');
const serverRuntimeModule = require('../server');
const { createComponentWebPicker } = require('./component-web-picker');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const GITHUB_REPO_URL = 'https://github.com/AuroraWhisperer/LIRA';
let paths = { dataDir: '', logDir: '', logFile: '', terminalLogFile: '' };
let runtime = null;
let requestAuth = null;
let localMediaAccess = null;
let disposeMediaHeaders = null;
const startupTiming = { startedAt: 0 };
const { writeLog, nextSequence: nextLogSequence, startRun: startLogRun } = createDesktopLogger({
  getLogFile: () => paths.logFile,
});
const desktopAuth = createDesktopAuthController({
  BrowserWindow,
  shell,
  getMainWindow: () => desktopWindow.getWindow(),
  getDataDir: () => paths.dataDir,
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
  getBilibiliSessionRevision,
  getBilibiliRequestIdentity,
  getBilibiliIdentityRevision,
  restoreBilibiliCookieSnapshot,
  replaceBilibiliCookieHeader,
  loginBilibiliAccount,
  logoutBilibiliAccount,
} = desktopAuth;
const resourceIntegrity = createDesktopResourceIntegrity({
  app,
  getMainWindow: () => desktopWindow.getWindow(),
  getDesktopBaseUrl: () => desktopWindow.getBaseUrl(),
  writeLog,
});
const desktopUpdate = createDesktopUpdateController({
  app,
  updateManager: updateMgr,
  beforeInstall: () => resourceIntegrity.stop('UPDATE_INSTALLING'),
  getAutoUpdateSetting: () => runtime?.getSetting?.('enableAutoUpdate'),
  getMainWindow: () => desktopWindow.getWindow(),
  writeLog,
});
const {
  configureAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  sendUpdateState,
} = desktopUpdate;
var licenseManager = null;
var licenseResumeController = null;
var cloudSyncController = null;
var remoteGiftController = null;
var sceneCloudController = null;
var readinessController = null;
var clientAppearance = null;
var doubaoSession = null;
var disposeClientAppearanceIpc = null;
var disposeScreenColorPicker = null;
var audioAssistant = null;
var audioComponent = null;
var playbackOutput = null;
var disposePlaybackOutputIpc = null;
var disposeAudioAssistantIpc = null;
var dynamicLotteryAuth = null;
var disposeLotteryAuthIpc = null;
var guardExpiryAuth = null;
var disposeGuardExpiryIpc = null;
var disposeGiftInteractionIpc = null;
var disposeGiftExportIpc = null;
var disposeWeeklyScheduleIpc = null;
var fanProfileController = null;
var disposeFanProfileIpc = null;
var disposeDailyBotIpc = null;
var plannerReminderController = null;
var desktopNotifications = null;
var disposeDesktopNotificationsIpc = null;
var disposeDiagnostics = null;
var disposeLogMaintenance = null;
var disposePlannerReminderIpc = null;
const remoteGiftCatalogBootstrapBase = resolveConfiguredBaseUrl();

const desktopWindow = createDesktopMainWindow({
  BrowserWindow,
  preloadPath: path.join(__dirname, 'preload.js'),
  iconPath: path.join(ROOT_DIR, 'build', 'icon.png'),
  getThemeId: () => clientAppearance.getThemeId(),
  bindRequestAuth: window => requestAuth.bindWindow(window, shell),
  onCloseRequest: () => desktopLifecycle.requestClose(),
  onReady: () => {
    runtime?.startBackgroundMaintenance?.();
    logStartupPhase('ready-to-show', startupTiming.startedAt || Date.now());
    sendUpdateState();
    desktopUpdate.scheduleStartupCheck();
  },
  writeLog,
});
const desktopLifecycle = createDesktopLifecycle({
  app,
  hasRuntime: () => runtime !== null,
  stopResourceIntegrity: () => resourceIntegrity.stop(),
  drainBeforeRuntimeStop,
  stopRuntime: () => runtime?.stop({ exitProcess: false }),
  disposeRequestAuth: () => {
    try {
      disposeMediaHeaders?.();
    } finally {
      requestAuth?.dispose();
    }
  },
  disposeLicense: () => {
    try { licenseManager?.dispose(); }
    finally { licenseManager = null; }
  },
  disposeDiagnostics: () => {
    disposeDiagnostics?.();
    disposeLogMaintenance?.();
  },
  writeLog,
});

// ---- app lifecycle ----

// Register local-media:// protocol for local audio file playback
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
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
  if (desktopUserDataPaths.recoveryDataDir && fs.existsSync(desktopUserDataPaths.recoveryDataDir)) {
    throw new Error('上次安装的数据尚未恢复，请重新运行安装包。数据保留在：' + desktopUserDataPaths.recoveryDataDir);
  }
  userDataMigrationState.migration = migrateLegacyUserData({
    app,
    sourceDir: desktopUserDataPaths.legacyDataDir,
    targetDir: desktopUserDataPaths.dataDir,
  });
  fs.mkdirSync(desktopUserDataPaths.dataDir, { recursive: true });
  // The legacy source lock is released; installed releases share this root lock.
  app.setPath('userData', desktopUserDataPaths.dataDir);
  gotInstanceLock = app.requestSingleInstanceLock();
  if (gotInstanceLock) {
    migrateBrowserData({ dataDir: desktopUserDataPaths.dataDir });
    migrateCacheData({ dataDir: desktopUserDataPaths.dataDir });
    fs.mkdirSync(desktopUserDataPaths.browserDir, { recursive: true });
    app.setPath('userData', desktopUserDataPaths.browserDir);
    app.setPath('sessionData', desktopUserDataPaths.browserDir);
    app.setPath('logs', desktopUserDataPaths.logDir);
    app.setPath('crashDumps', path.join(desktopUserDataPaths.browserDir, 'Crashpad'));
  }
} catch (error) {
  userDataMigrationState.error = error;
}
if (userDataMigrationState.error) {
  // Stop before Chromium creates an empty profile that would conflict with recovery.
  dialog.showErrorBox(
    '启动失败',
    '无法准备安装目录中的用户数据。LIRA 已停止启动：' +
      (userDataMigrationState.error.message || String(userDataMigrationState.error)),
  );
  app.exit(1);
} else if (!gotInstanceLock) {
  app.quit();
} else {
  // Native playback consumes Web Audio PCM even when Chromium hears only silence.
  if (process.platform === 'win32') app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app
    .whenReady()
    .then(startDesktopApp)
    .catch(function (error) {
      writeLog('startup-error', error);
      try {
        dialog.showErrorBox('启动失败', error.message || String(error));
      } catch (reportError) {
        writeLog('startup-error', reportError);
      } finally {
        void desktopLifecycle.requestShutdown({ exitCode: 1 });
      }
    });
}

app.setName('LIRA');

app.on('second-instance', desktopWindow.focus);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// electron-updater emits this after starting the installer and before app.quit().
autoUpdater.on('before-quit-for-update', function () {
  void desktopLifecycle.requestShutdown();
});

app.on('before-quit', desktopLifecycle.beforeQuit);

async function drainBeforeRuntimeStop() {
  const integrityStopped = resourceIntegrity.stop();
  desktopUpdate.dispose();
  readinessController?.dispose();
  readinessController = null;
  licenseResumeController?.unregister();
  disposeLotteryAuthIpc?.();
  disposeGuardExpiryIpc?.();
  guardExpiryAuth?.dispose();
  disposeGiftInteractionIpc?.();
  disposeGiftExportIpc?.();
  disposeWeeklyScheduleIpc?.();
  disposeFanProfileIpc?.();
  disposeDailyBotIpc?.();
  disposePlannerReminderIpc?.();
  disposeDesktopNotificationsIpc?.();
  disposeClientAppearanceIpc?.();
  disposeScreenColorPicker?.();
  disposeAudioAssistantIpc?.();
  disposePlaybackOutputIpc?.();
  plannerReminderController?.dispose();
  desktopNotifications?.dispose();
  dynamicLotteryAuth?.dispose();
  const controllersToDrain = [sceneCloudController, remoteGiftController, cloudSyncController, fanProfileController, desktopAuth, doubaoSession].filter(
    Boolean,
  );
  for (const controller of controllersToDrain) controller.dispose();
  remoteGiftController = null;
  sceneCloudController = null;
  cloudSyncController = null;
  fanProfileController = null;
  await Promise.all([
    integrityStopped,
    audioAssistant?.dispose(),
    playbackOutput?.dispose(),
    audioComponent?.close(),
    clientAppearance?.whenIdle(),
    desktopNotifications?.whenIdle(),
    dynamicLotteryAuth?.whenIdle(),
    guardExpiryAuth?.whenIdle(),
    ...controllersToDrain.map((controller) => controller.whenIdle()),
  ]);
}

// ---- startup ----

async function startDesktopApp() {
  configureDesktopEnvironment();
  audioComponent = createAudioComponentManager({
    dataDir: paths.dataDir,
    bundledDirectory: path.join(app.isPackaged ? process.resourcesPath : path.join(ROOT_DIR, 'build'), 'audio-assistant'),
    canDownload: () => licenseManager?.getState() === LicenseState.AUTHORIZED,
    onState: state => {
      const window = desktopWindow.getWindow();
      if (window && !window.isDestroyed()) window.webContents.send('audio-component:state', state);
    },
  });
  playbackOutput = createPlaybackOutput({
    getExecutable: audioComponent.getExecutable,
    dataDir: paths.dataDir,
    onFault: (fault) => {
      const window = desktopWindow.getWindow();
      if (window && !window.isDestroyed()) window.webContents.send('playback-output:fault', fault);
    },
  });
  disposePlaybackOutputIpc = registerPlaybackOutputIpc({ ipcMain, output: playbackOutput, component: audioComponent,
    getMainWindow: () => desktopWindow.getWindow(), getDesktopBaseUrl: () => desktopWindow.getBaseUrl() });
  audioAssistant = createAudioAssistant({
    getExecutable: audioComponent.getExecutable,
    dataDir: paths.dataDir,
    getProcessIds: () => [process.pid, playbackOutput?.getProcessId(), ...app.getAppMetrics().map((item) => item.pid)],
    getPlaybackProcessId: () => playbackOutput?.getCaptureProcessId(),
    onState: (state) => {
      const window = desktopWindow.getWindow();
      if (window && !window.isDestroyed()) window.webContents.send('audio-assistant:state', state);
    },
  });
  disposeAudioAssistantIpc = registerAudioAssistantIpc({ ipcMain, assistant: audioAssistant, component: audioComponent,
    getMainWindow: () => desktopWindow.getWindow(), getDesktopBaseUrl: () => desktopWindow.getBaseUrl(),
    isPathAllowedForLocalMedia, shell });
  clientAppearance = createClientAppearance({ dataDir: paths.dataDir, writeLog });
  disposeClientAppearanceIpc = registerClientAppearanceIpc({ ipcMain, appearance: clientAppearance,
    getMainWindow: () => desktopWindow.getWindow(), getDesktopBaseUrl: () => desktopWindow.getBaseUrl() });
  disposeScreenColorPicker = registerScreenColorPicker({ ipcMain, BrowserWindow, desktopCapturer, screen,
    getMainWindow: () => desktopWindow.getWindow(), getDesktopBaseUrl: () => desktopWindow.getBaseUrl() });
  if (process.platform === 'win32') configureNotificationIdentity({ app, shell, writeLog });
  writeLog('user-data-migration', userDataMigrationState.migration);
  const startupStartedAt = Date.now();
  startupTiming.startedAt = startupStartedAt;
  logStartupPhase('start', startupStartedAt);
  var phaseStartedAt = Date.now();
  migrateLegacyPartitions({ app, writeLog });
  logStartupPhase('partition-migration', phaseStartedAt);
  configureMenu();
  configureLocalMediaProtocol();
  desktopNotifications = createDesktopNotifications({
    dataDir: paths.dataDir,
    Notification,
    getMainWindow: () => desktopWindow.getWindow(),
    icon: path.join(ROOT_DIR, 'build', 'icon.png'),
    writeLog,
    onPlannerRemindersChanged: (enabled) => plannerReminderController?.setEnabled(enabled),
  });
  disposeDesktopNotificationsIpc = registerDesktopNotificationsIpc({
    ipcMain, notifications: desktopNotifications,
    getMainWindow: () => desktopWindow.getWindow(), getDesktopBaseUrl: () => desktopWindow.getBaseUrl(),
  });
  plannerReminderController = createPlannerReminderController({
    Notification,
    powerMonitor,
    getMainWindow: () => desktopWindow.getWindow(),
    icon: path.join(ROOT_DIR, 'build', 'icon.png'),
    writeLog,
    enabled: desktopNotifications.getState().settings.plannerRemindersEnabled,
  });
  disposePlannerReminderIpc = registerPlannerReminderIpc({
    ipcMain,
    controller: plannerReminderController,
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => desktopWindow.getBaseUrl(),
  });
  registerDesktopShellIpc({
    ipcMain,
    app,
    shell,
    getDataDir: () => paths.dataDir,
    getLogFile: () => paths.logFile,
    getLogDir: () => paths.logDir,
    getTerminalLogFile: () => paths.terminalLogFile,
    getUpdateState: desktopUpdate.getState,
    resourceIntegrity,
    githubRepoUrl: GITHUB_REPO_URL,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    requestRestart: () => desktopLifecycle.requestShutdown({ restart: true }),
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => desktopWindow.getBaseUrl(),
    writeLog,
  });
  registerMusicIpc({
    ipcMain,
    dialog,
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => desktopWindow.getBaseUrl(),
    getDesktopRuntime: () => runtime,
    getAppDataPath: () => app.getPath('appData'),
    getLocalMediaAccess: () => localMediaAccess,
    getMusicAuthState,
    loginMusicAccount,
    logoutMusicAccount,
    clearMusicBrowserCache,
    getMusicProviderRegistry,
    isPathAllowedForLocalMedia,
    acknowledgePlaybackFlush: playbackFlush.acknowledgePlaybackFlush,
    writePlaybackSnapshot: (payload, clientId) => {
      if (!runtime || typeof runtime.persistPlaybackSnapshot !== 'function') {
        return { ok: false, error: 'Playback store not available' };
      }
      return runtime.persistPlaybackSnapshot(payload, clientId);
    },
  });
  registerBilibiliIpc({
    ipcMain,
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => desktopWindow.getBaseUrl(),
    getAuthState: getBilibiliAuthState,
    getProfile: getBilibiliAccountProfile,
    login: () => cloudSyncController.loginBilibili(),
    logout: () => cloudSyncController.logoutBilibili(),
  });
  requestAuth = createDesktopRequestAuth({
    desktopSession: session.defaultSession,
    getMainWindow: () => desktopWindow.getWindow(),
    getBaseUrl: () => desktopWindow.getBaseUrl(),
    getToken: () => runtime?.getApiToken?.() || '',
  });
  disposeMediaHeaders = configureMediaRequestHeaders(session.defaultSession, requestAuth);
  configureAudioMediaCors(session.defaultSession, { getMainWindow: () => desktopWindow.getWindow(), getDesktopBaseUrl: () => desktopWindow.getBaseUrl() });
  configureAutoUpdater();
  phaseStartedAt = Date.now();
  await restoreMusicCookieSnapshots();
  if (desktopLifecycle.isShuttingDown()) return;
  logStartupPhase('music-cookie-restore', phaseStartedAt);
  phaseStartedAt = Date.now();
  await restoreBilibiliCookieSnapshot();
  if (desktopLifecycle.isShuttingDown()) return;
  logStartupPhase('bilibili-cookie-restore', phaseStartedAt);

  var serverOptions = {
    onGiftFlushed: (item) => {
      if (licenseManager?.isAuthorized()) desktopNotifications.notifyGift(item);
    },
    fontFetch: (url, options) => net.fetch(url, options),
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
      getSessionRevision: getBilibiliSessionRevision,
      getRequestIdentity: getBilibiliRequestIdentity,
      getIdentityRevision: getBilibiliIdentityRevision,
    },
    giftSync: {
      cardProfiles: (request) => {
        if (!licenseManager?.isAuthorized()) throw new Error('LICENSE_NOT_AUTHORIZED');
        return licenseManager.getGiftCardProfilesInternal(request);
      },
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
        licenseManager?.getState() === LicenseState.AUTHORIZED ? licenseManager.getGiftCatalog(request) : null,
      imageBaseUrl: () => licenseManager?.getRemoteBaseUrl?.() || remoteGiftCatalogBootstrapBase,
    },
  };
  doubaoSession = createDoubaoSession({ BrowserWindow, session, safeStorage, dataDir: paths.dataDir, getParent: () => desktopWindow.getWindow() });
  await doubaoSession.initialize();
  if (desktopLifecycle.isShuttingDown()) return;
  runtime = createDesktopRuntime(serverRuntimeModule, {
    dataDir: paths.dataDir,
    nativeMusicCapture: true,
    pickComponentWebFile: createComponentWebPicker({ dialog, getWindow: () => desktopWindow.getWindow() }),
    getClientTheme: clientAppearance.getThemeId,
    safeStorage,
    doubaoSession,
    openAiLoginBrowser: (url) => shell.openExternal(url),
    appVersion: app.getVersion(),
    dynamicLotteryAuth: {
      getIdentity: () => dynamicLotteryAuth?.getIdentity(),
      getContext: () => dynamicLotteryAuth?.getContext(),
    },
    isPackaged: app.isPackaged,
    appPath: app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : '',
    licenseGate: {
      isAuthorized: () => licenseManager?.isAuthorized() === true,
    },
    getFanScope: () => fanScopeFor(licenseManager),
    getSceneOwner: () => getSceneOwner(licenseManager),
    loadDanmakuAppearance: () => licenseManager.getOverlaySettings(),
    getPreviewOwner: () => getComponentPreviewOwner(licenseManager),
    onPhase: (phase, durationMs, extra) =>
      writeLog('lifecycle', {
        event: 'PHASE',
        phase,
        durationMs,
        ...extra,
      }),
  });

  // Register pre-shutdown hook: flush renderer playback state via IPC before closing server/DB
  runtime.setPreShutdownHook(requestPlaybackFlush);

  phaseStartedAt = Date.now();
  var serverInfo = await runtime.start({ ...serverOptions, deferMaintenance: true });
  if (desktopLifecycle.isShuttingDown()) return;
  logStartupPhase('runtime-ready', phaseStartedAt);

  licenseManager = createLicenseManager({
    dataDir: paths.dataDir,
    safeStorage,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : '',
  });
  dynamicLotteryAuth = createDynamicLotteryAuth({
    session,
    safeStorage,
    dataDir: paths.dataDir,
    licenseManager,
    BrowserWindow,
    shell,
    getMainWindow: () => desktopWindow.getWindow(),
    writeLog,
  });
  guardExpiryAuth = createGuardExpiryAuth({
    session, licenseManager, BrowserWindow, shell,
    getMainWindow: () => desktopWindow.getWindow(),
    loginConfig: require('./bilibili-auth').BILIBILI_LOGIN_CONFIG,
  });
  disposeGuardExpiryIpc = registerGuardExpiryIpc({
    ipcMain, auth: guardExpiryAuth,
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => serverInfo.baseUrl,
  });
  disposeLotteryAuthIpc = registerDynamicLotteryAuthIpc({
    ipcMain,
    auth: dynamicLotteryAuth,
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => serverInfo.baseUrl,
  });
  registerLicenseIpc({
    ipcMain,
    licenseManager,
    getCloudSyncController: () => cloudSyncController,
    onOverlaySettings: (update) => runtime.receiveSceneCloudSettings(update),
    onFixedReplySettings: (settings, revision) => runtime.applyCloudFixedReplySettingsSnapshot(settings, revision),
    giftCatalog: {
      getState: () => runtime.getGiftCatalogInitializationState(),
      initialize: () =>
        runtime.initializeGiftCatalog({
          force: true,
          reason: 'license-retry',
        }),
      onStateChanged: (listener) => runtime.onGiftCatalogInitializationStateChanged(listener),
    },
    fontLibrary: {
      getState: () => runtime.getFontLibraryState(),
      initialize: () => runtime.initializeFontLibrary({ force: true }),
      onStateChanged: listener => runtime.onFontLibraryStateChanged(listener),
    },
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => serverInfo.baseUrl,
  });
  await licenseManager.bootstrap();
  if (desktopLifecycle.isShuttingDown()) return;
  writeLog('license-state', {
    event: 'bootstrap',
    ...licenseManager.getSnapshot(),
  });
  cloudSyncController = createCloudSyncController({
    licenseManager,
    runtime,
    bilibiliAuth: {
      getAuthState: getBilibiliAuthState,
      getCookieHeader: getBilibiliCookieHeader,
      getSessionRevision: desktopAuth.getBilibiliSessionRevision,
      replaceCookieHeader: replaceBilibiliCookieHeader,
      login: loginBilibiliAccount,
      logout: logoutBilibiliAccount,
    },
  });
  disposeGiftInteractionIpc = registerGiftInteractionIpc({
    ipcMain,
    controller: cloudSyncController,
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => serverInfo.baseUrl,
  });
  disposeGiftExportIpc = registerGiftExportIpc({
    ipcMain,
    controller: createGiftExportController({
      app,
      BrowserWindow,
      dialog,
      shell,
      runtime,
      getBaseUrl: () => serverInfo.baseUrl,
      getMainWindow: () => desktopWindow.getWindow(),
    }),
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => serverInfo.baseUrl,
  });
  disposeWeeklyScheduleIpc = registerWeeklyScheduleIpc({
    ipcMain,
    controller: createWeeklyScheduleExportController({
      app, BrowserWindow, dialog, nativeImage, session,
      getBaseUrl: () => serverInfo.baseUrl,
      getSessionToken: () => runtime.getApiToken(),
      getMainWindow: () => desktopWindow.getWindow(),
    }),
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => serverInfo.baseUrl,
  });
  remoteGiftController = createRemoteGiftController({
    licenseManager,
    runtime,
  });
  sceneCloudController = createSceneCloudController({
    licenseManager,
    writeLog,
    subscribeDemand: (listener) => runtime.subscribeSceneCloudDemand(listener),
    publish: (update) => runtime.receiveSceneCloud(update),
    publishSettings: (update) => runtime.receiveSceneCloudSettings(update),
  });
  sceneCloudController.start();
  fanProfileController = createFanProfileController({
    licenseManager,
    getService: () => runtime.getFanProfiles(),
    getRoomId: () => runtime.getSetting('roomId'),
    fetchGuardRoster,
    fetchUserProfile: async (uid, { signal }) => {
      signal.throwIfAborted();
      const cookieHeader = await getBilibiliCookieHeader();
      return new BilibiliApiClient('', { cookieHeader }).fetchUserProfile(uid, { signal });
    },
    isWindowOpen: () => Boolean(desktopWindow.getWindow() && !desktopWindow.getWindow().isDestroyed()),
  });
  disposeFanProfileIpc = registerFanProfileIpc({
    ipcMain,
    controller: fanProfileController,
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => serverInfo.baseUrl,
  });
  void fanProfileController.start();
  disposeDailyBotIpc = registerDailyBotIpc({
    ipcMain,
    controller: createDailyBotController({
      licenseManager,
      getLegacyReader: () => runtime.getDailyBotLegacy(),
      sourceLabel: path.join(paths.dataDir, 'checkin-data.db'),
    }),
    getMainWindow: () => desktopWindow.getWindow(),
    getDesktopBaseUrl: () => serverInfo.baseUrl,
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
    getMainWindow: () => desktopWindow.getWindow(),
    hasExactOrigin,
  });
  phaseStartedAt = Date.now();
  readinessController = createDesktopReadinessController({
    licenseManager,
    audioComponent,
    runtime,
    remoteGiftController,
    cloudSyncController,
    getMainWindow: () => desktopWindow.getWindow(),
    baseUrl: serverInfo.baseUrl,
    writeLog,
  });
  desktopWindow.create(serverInfo.baseUrl, readinessController.initialRoute === 'admin');
  readinessController.start();
  logStartupPhase('window-create', phaseStartedAt);
  writeLog('lifecycle', { event: 'READY', baseUrl: serverInfo.baseUrl });

  if (!app.isPackaged) desktopUpdate.setDevelopmentMode();
}

function configureDesktopEnvironment() {
  paths = Object.freeze({
    dataDir: desktopUserDataPaths.dataDir,
    logDir: desktopUserDataPaths.logDir,
    logFile: path.join(desktopUserDataPaths.logDir, 'desktop.log'),
    terminalLogFile: path.join(desktopUserDataPaths.logDir, 'terminal.log'),
  });
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.logDir, { recursive: true });
  const runId = crypto.randomUUID();
  startLogRun(runId);
  disposeLogMaintenance = installLogMaintenance(paths.logDir);
  installTerminalLog(paths.terminalLogFile, {
    runId,
    pid: process.pid,
    processType: process.type || 'browser',
    nextSequence: nextLogSequence,
  });
  disposeDiagnostics = installDesktopDiagnostics({ app, writeLog, getBaseUrl: () => desktopWindow.getBaseUrl() });
  writeLog('lifecycle', {
    event: 'START',
    dataDir: paths.dataDir,
    logDir: paths.logDir,
    isPackaged: app.isPackaged,
  });
  localMediaAccess = createLocalMediaAccess(paths.dataDir);
  process.env.SONG_PLUGIN_DATA_DIR = paths.dataDir;
  process.env.ELECTRON_DESKTOP = '1';
  if (!process.env.HOST) process.env.HOST = '127.0.0.1';
}

function configureMenu() {
  Menu.setApplicationMenu(null);
}

function isPathAllowedForLocalMedia(filePath) {
  return Boolean(localMediaAccess && localMediaAccess.isAllowed(filePath));
}

function configureLocalMediaProtocol() {
  registerLocalMediaProtocol(protocol, isPathAllowedForLocalMedia, () => desktopWindow.getBaseUrl());
}

function logStartupPhase(phase, startedAt, extra = {}) {
  if (!paths.logFile) return;
  writeLog('lifecycle', {
    event: 'PHASE',
    phase,
    durationMs: Math.max(0, Date.now() - Number(startedAt || Date.now())),
    ...extra,
  });
}

async function requestPlaybackFlush() {
  var result = await playbackFlush.requestPlaybackFlush(desktopWindow.getWindow());
  writeLog('playback-flush', result);
  return result;
}
