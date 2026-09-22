'use strict';

// Documentation fixture: real Electron/preload/local runtime, synthetic remote replies.
// Never launches src/electron/main.js or opens the user's desktop data/profile.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createServerRuntime } = require('../../src/server');
const { createDesktopRequestAuth } = require('../../src/electron/desktop-request-auth');
const { configureMediaRequestHeaders } = require('../../src/electron/media-request-headers');
const { createGiftExportController } = require('../../src/electron/gift-export-controller');
const { registerGiftExportIpc } = require('../../src/electron/ipc/gift-export-ipc');
const { createFanProfileController } = require('../../src/electron/fan-profile-controller');
const { registerFanProfileIpc } = require('../../src/electron/ipc/fan-profile-ipc');
const { readGiftDisplaySettings } = require('../../src/bilibili/gift/display-settings');
const { buildGiftCards } = require('../../public/js/shared/gift-card-model.js');
const { seedQueueViaApi } = require('./capture.cjs');
const { OUT_ROOT, DATA_DIR } = require('./manifest.js');

const profileDir = fs.mkdtempSync(path.join(OUT_ROOT, 'electron-'));
app.setPath('userData', profileDir);
app.setPath('sessionData', profileDir);
app.on('window-all-closed', () => {});
let mainWindow;
let runtime;
let disposeExport;
let requestAuth;
let fanController;
let stopping = false;
const fixture = {
  license: { state: 'needs_activation' },
  catalog: { status: 'ready' },
  update: { status: 'idle' },
  profile: { state: 'authorized', streamer: {
    accountName: 'demo', displayName: '示例主播', songPageUrl: 'https://demo.example.test',
  } },
};
const overlayUrl = 'https://demo.example.test/overlay/EXAMPLE000000000';
const defaults = {
  'desktop:get-info': () => ({ version: '5.0.3', isPackaged: true, autoUpdate: false, updateState: fixture.update }),
  'bilibili:get-auth-state': () => ({ loggedIn: false }),
  'bilibili:get-profile': () => null,
  'dynamic-lottery-auth:get-state': () => ({ ok: true, state: { loggedIn: false, uid: '', warning: '' } }),
  'music:get-auth-state': () => ({ loggedIn: fixture.musicAuth === true }),
  'music:provider-health': () => ({ ok: true }),
  'music:get-recent-local-files': () => [],
  'music:resolve-local-media-urls': () => ({}),
  'license:get-state': () => fixture.license,
  'license:get-gift-catalog-state': () => fixture.catalog,
  'license:get-profile': () => fixture.profile,
  'license:get-overlay-settings': () => ({ ok: true, overlayUrl, style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {} }),
  'license:get-overlay-filters': () => ({ ok: true, blockedUsers: [{ uid: '100004', name: '观众D' }], blockedKeywords: ['示例屏蔽词'] }),
  'license:get-overlay-viewers': () => ({ ok: false, error: 'BILIBILI_LOGIN_REQUIRED' }),
  'license:get-gift-interaction-state': () => ({ status: 'confirmed', values: { giftAutoThanksEnabled: true, giftStatsQueryEnabled: true } }),
  'license:get-welcome-settings-v2': () => ({ ok: true, schemaVersion: 2, enabled: false,
    messages: ['欢迎 {username} 来到直播间'], greetingEnabled: false, attentionEnabled: false, rareNamePinyinEnabled: false,
    greetingMessages: ['{username}，今天想听什么歌？'], attentionWelcomeMessages: ['欢迎老朋友 {username}'],
    attentionGreetingMessages: ['{username}，谢谢一直支持'], welcomeDelaySeconds: 5, welcomeMinHonorLevel: 10,
    greetingDelaySeconds: 10, greetingMinHonorLevel: 10, attentionMinHonorLevel: 31 }),
  'license:get-welcome-settings': () => ({ ok: true, enabled: false, messages: [] }),
  'license:get-pk-report-settings': () => ({ ok: true, enabled: false }),
  'license:get-cloud-songs': () => ({ songs: Array.from({ length: 7 }, (_, index) => ({ id: index + 1 })) }),
  'license:sync-songs': (songs) => ({ ok: true, count: songs.length }),
  'license:get-song-page-background': () => ({ ok: true, background: fixture.background || null }),
  'daily-bots:invoke': ({ action }) => action === 'open' ? ({ ok: true, contextId: 'documentation-only', data: {
    checkin: { enabled: false, revision: 1, reason: 'disabled' }, fortune: { enabled: false, revision: 1, reason: 'disabled' },
    takeover: { state: 'ready' }, observedAt: new Date().toISOString(),
  } }) : ({ ok: false, error: 'SCREENSHOT_FIXTURE_ONLY' }),
  'fan-profiles:invoke': () => ({ ok: false, error: 'LICENSE_NOT_AUTHORIZED' }),
};

app.whenReady().then(async () => {
  runtime = createServerRuntime({ dataDir: DATA_DIR, dynamicLotteryAuth: {
    getIdentity: () => ({ streamerId: 'demo', authorizationEpoch: 1 }),
    getContext: () => { throw new Error('Screenshot fixture has no Bilibili account'); },
  } });
  const { baseUrl } = await runtime.start({ host: '127.0.0.1', startPort: 0 });
  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'seed-meta.json'), 'utf8'));
  runtime.setActiveGiftSource({ sourceId: meta.giftSourceId, syncState: 'LIVE', partial: false,
    syncedThroughCursor: 1000, syncedAt: new Date().toISOString(), latestCursor: 1000,
    dirty: false, epochValidated: true });
  await seedQueueViaApi(baseUrl, runtime.getApiToken());

  // Fail before navigation if a route is unavailable; never infer this from a port.
  const statuses = {};
  for (const route of ['/license', '/admin']) {
    const response = await fetch(baseUrl + route, { headers: { Authorization: `Bearer ${runtime.getApiToken()}` } });
    statuses[route] = response.status;
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    await response.arrayBuffer();
  }
  const preload = path.resolve(__dirname, '../../src/electron/preload.js');
  for (const match of fs.readFileSync(preload, 'utf8').matchAll(/ipcRenderer\.invoke\('([^']+)'/g)) {
    const channel = match[1];
    if (channel.startsWith('gift-export:') || channel === 'fan-profiles:invoke') continue;
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame ||
          new URL(event.senderFrame.url).origin !== baseUrl) return { ok: false, error: 'IPC_SOURCE_INVALID' };
      return defaults[channel]?.(...args) ?? { ok: false, error: 'SCREENSHOT_FIXTURE_ONLY' };
    });
  }
  requestAuth = createDesktopRequestAuth({ desktopSession: session.defaultSession,
    getMainWindow: () => mainWindow, getBaseUrl: () => baseUrl, getToken: () => runtime.getApiToken() });
  configureMediaRequestHeaders(session.defaultSession, {}, requestAuth);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.host !== new URL(baseUrl).host });
  });
  // Only the export snapshot is a fixture: the current runtime calls a missing
  // getGlobalSnapshot method. This image demonstrates the UI, not a passed export.
  const exportRuntime = { ...runtime, async prepareGiftExport(selection) {
    const response = await fetch(baseUrl + '/api/gifts/selection', { method: 'POST',
      headers: { Authorization: `Bearer ${runtime.getApiToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(selection) });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return { ...result.data, items: buildGiftCards(result.data.items),
      selectedCount: result.data.items.length, config: readGiftDisplaySettings({}), catalog: [] };
  } };
  const exportController = createGiftExportController({ app: { getPath: () => path.join(OUT_ROOT, 'exports') },
    BrowserWindow, dialog: {}, shell: {}, runtime: exportRuntime, getBaseUrl: () => baseUrl, getMainWindow: () => mainWindow });
  disposeExport = registerGiftExportIpc({ ipcMain, controller: exportController,
    getMainWindow: () => mainWindow, getDesktopBaseUrl: () => baseUrl });
  fanController = createFanProfileController({ getService: () => runtime.getFanProfiles(),
    licenseManager: { isAuthorized: () => true, getCloudSyncIdentity: () => ({ streamerId: 'demo', accountName: 'demo' }),
      getRemoteBaseUrl: () => 'https://api.example.test', getAuthorizationEpoch: () => 1,
      onStateChanged: () => () => {} } });
  registerFanProfileIpc({ ipcMain, controller: fanController, getMainWindow: () => mainWindow, getDesktopBaseUrl: () => baseUrl });
  const fanService = runtime.getFanProfiles();
  const fanScope = JSON.stringify(['https://api.example.test', 'demo']);
  if (!fanService.execute(fanScope, 'list').profiles.length) {
    fanService.execute(fanScope, 'configure', { autoCreate: false, autoUpdate: false, autoSyncGuardRoster: false });
    for (const alias of ['观众A', '观众B', '观众C']) {
      fanService.execute(fanScope, 'create', { alias, summary: '截图用示例档案', favorite: alias === '观众A', notes: '喜欢听华语流行与古风歌曲。' });
    }
  }
  global.usageShots = {
    baseUrl, statuses, fixture, runtime,
    async open(kind, width = 1440, height = 900) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      mainWindow = new BrowserWindow({ width, height, useContentSize: true, frame: false, show: false,
        webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true,
          backgroundThrottling: false, offscreen: true } });
      requestAuth.bindWindow(mainWindow, { openExternal() {} });
      // Suppress the automatic tour except when a shot explicitly opens it.
      await mainWindow.loadURL(baseUrl + '/license');
      await mainWindow.webContents.executeJavaScript("localStorage.clear(); localStorage.setItem('liraTourCompleted', '1')");
      if (kind === 'admin') await mainWindow.loadURL(baseUrl + '/admin?desktop=1');
      return mainWindow.id;
    },
  };
}).catch((error) => { console.error(error); app.exit(1); });

app.on('before-quit', (event) => {
  if (stopping) return;
  event.preventDefault();
  stopping = true;
  disposeExport?.();
  fanController?.dispose();
  requestAuth?.dispose();
  Promise.resolve(runtime?.stop()).finally(() => app.exit(0));
});
