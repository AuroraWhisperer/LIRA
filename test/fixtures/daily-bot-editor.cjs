'use strict';

// Isolated desktop host with production admin HTML, preload, request auth and daily-bot IPC.
if (process.versions.electron) run().catch((error) => {
  console.error(error);
  require('electron').app.exit(1);
});

async function run() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { app, BrowserWindow, session, ipcMain } = require('electron');
  const { createHttpServer } = require('../../src/server/http-server');
  const { servePageOrAsset } = require('../../src/server/page-assets');
  const { createDesktopRequestAuth } = require('../../src/electron/desktop-request-auth');
  const { configureMediaRequestHeaders } = require('../../src/electron/media-request-headers');
  const { registerLicenseIpc } = require('../../src/electron/ipc/license-ipc');
  const { registerDailyBotIpc } = require('../../src/electron/ipc/daily-bot-ipc');
  const { registerGiftInteractionIpc } = require('../../src/electron/ipc/gift-interaction-ipc');
  const { createDailyBotController } = require('../../src/electron/daily-bot-controller');
  const { digest } = require('../../src/shared/daily-bot-contract');
  const { CHECKIN_BLESSINGS, FORTUNES } = require('../../src/shared/bot-defaults');
  const root = path.resolve(__dirname, '../..');
  const directory = path.resolve(process.argv[2]);
  if (path.dirname(directory) !== path.join(root, 'tmp')) throw new Error('Expected an isolated tmp directory.');
  fs.mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  app.setPath('crashDumps', path.join(directory, 'crashes'));
  await app.whenReady();
  const token = 'synthetic-daily-library-desktop';
  const listeners = new Set();
  const snapshot = { state: 'authorized', streamer: { accountName: 'library-test' } };
  const saved = {
    executionOwner: 'server', observedAt: '2026-10-10T00:00:00Z',
    takeover: { state: 'ready', decision: 'fresh-start', revision: 1 },
    checkin: { enabled: false, revision: 0, reason: 'disabled' },
    fortune: { enabled: false, revision: 0, reason: 'disabled' },
  };
  const libraries = { checkin: structuredClone(CHECKIN_BLESSINGS), fortune: structuredClone(FORTUNES) };
  const fixedReplies = {
    ok: true, customExactReplyEnabled: false, customExactReplies: [], scheduledDanmakuEnabled: false,
    scheduledDanmaku: { mode: 'fixed', intervalSeconds: 300, minSeconds: 300, maxSeconds: 600, selection: 'sequential', messages: [] },
  };
  global.dailyLibraryTest = { requests: [], libraries, failNext: false, fixedReplies };
  const welcomeSettings = {
    schemaVersion: 2, enabled: true, welcomeDelaySeconds: 0, welcomeMinHonorLevel: 0,
    greetingEnabled: false, greetingDelaySeconds: 10, greetingMinHonorLevel: 0,
    attentionEnabled: false, attentionMinHonorLevel: 31, rareNamePinyinEnabled: false,
    returningEnabled: false, returningMessages: ['最近过得怎么样呀？', '很高兴又见到你～'],
    messages: ['欢迎 {username} 来到直播间～'], greetingMessages: ['{username}，你好呀～'],
    attentionWelcomeMessages: ['欢迎 {username}～'], attentionGreetingMessages: ['{username}，来听歌吧～'],
    userWelcomeMessages: [],
  };
  global.dailyLibraryTest.welcomeSettings = welcomeSettings;
  const giftState = { ok: true, status: 'confirmed', values: { giftAutoThanksEnabled: true, giftStatsQueryEnabled: false } };
  global.dailyLibraryTest.giftState = giftState;
  const manager = {
    getState: () => snapshot.state,
    getSnapshot: () => snapshot,
    isAuthorized: () => true,
    getCloudSyncIdentity: () => ({ streamerId: 1, accountName: snapshot.streamer.accountName }),
    getRemoteBaseUrl: () => 'https://synthetic-libraries.test',
    getAuthorizationGeneration: () => 1,
    onStateChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async getWelcomeSettingsV2() { return structuredClone(welcomeSettings); },
    async updateWelcomeSettingsV2(patch) {
      global.dailyLibraryTest.requests.push({ operation: 'welcome-update', input: structuredClone(patch) });
      if (global.dailyLibraryTest.failNext) {
        global.dailyLibraryTest.failNext = false;
        throw Object.assign(new Error('UNAVAILABLE'), { code: 'UNAVAILABLE' });
      }
      Object.assign(welcomeSettings, structuredClone(patch));
      if (!welcomeSettings.enabled)
        Object.assign(welcomeSettings, { greetingEnabled: false, attentionEnabled: false, returningEnabled: false });
      return structuredClone(welcomeSettings);
    },
    async getFixedReplySettings() { return structuredClone(fixedReplies); },
    async updateFixedReplySettings(patch) {
      global.dailyLibraryTest.requests.push({ operation: 'fixed-reply-update', input: structuredClone(patch) });
      if (global.dailyLibraryTest.failNext) {
        global.dailyLibraryTest.failNext = false;
        throw Object.assign(new Error('UNAVAILABLE'), { code: 'UNAVAILABLE' });
      }
      Object.assign(fixedReplies, structuredClone(patch));
      return structuredClone(fixedReplies);
    },
    async dailyBotRequestInternal(operation, input) {
      global.dailyLibraryTest.requests.push({ operation, input: structuredClone(input) });
      if (global.dailyLibraryTest.failNext) {
        global.dailyLibraryTest.failNext = false;
        throw Object.assign(new Error('DAILY_BOT_UNAVAILABLE'), { code: 'DAILY_BOT_UNAVAILABLE' });
      }
      if (operation === 'read') return structuredClone(saved);
      const kind = input.kind;
      if (operation === 'updateLibrary') {
        if (input.body.expectedVersion !== digest(libraries[kind]))
          throw Object.assign(new Error('DAILY_BOT_LIBRARY_CONFLICT'), { code: 'DAILY_BOT_LIBRARY_CONFLICT' });
        libraries[kind] = input.body.library;
      }
      const version = digest(libraries[kind]);
      const unchanged = operation === 'updateLibrary' || input.version === version;
      return { kind, version, unchanged, ...(!unchanged ? { library: structuredClone(libraries[kind]) } : {}) };
    },
  };
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0, dataDir: directory, getPhase: () => 'ready',
    getStartedPort: () => server.address().port, isLicenseAuthorized: () => true,
    inflightTracker: { run: (fn) => fn() }, getSettings: () => ({}),
    createApiContext: () => ({ sessionToken: token }),
    servePageOrAsset(req, res, url) {
      if (url.pathname === '/js/admin/index.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(`import { initDanmakuDailyBots } from './danmaku-daily-bots.js';
          import { initFixedReplyEditor } from './danmaku-fixed-replies.js';
          import { initDanmakuCloudReplies } from './danmaku-cloud-replies.js';
          import { initDanmakuWelcome } from './danmaku-welcome.js';
          import { initDanmakuQueryReplies } from './danmaku-query-replies.js';
          import { initGiftInteractionControls } from './gifts/interaction-controls.js';
          import './contextual-help.js';
          const panel = document.querySelector('.danmaku-fixed-reply-section');
          document.body.replaceChildren(panel);
          document.body.style.cssText = 'display:block;overflow:auto;padding:24px';
          initDanmakuDailyBots(); initDanmakuCloudReplies(); initDanmakuQueryReplies(); initDanmakuWelcome();
          initGiftInteractionControls({ surface: 'danmaku' }); initFixedReplyEditor();`);
        return;
      }
      if (url.pathname === '/js/playback.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(''); return; }
      servePageOrAsset(path.join(root, 'public'), req, res, url, token);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  if ((await fetch(`${origin}/admin`)).status !== 401) throw new Error('Admin must require desktop authorization.');
  const window = new BrowserWindow({ width: 1440, height: 1000, show: false,
    webPreferences: { preload: path.join(root, 'src/electron/preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const auth = createDesktopRequestAuth({ desktopSession: session.defaultSession,
    getMainWindow: () => window, getBaseUrl: () => origin, getToken: () => token });
  configureMediaRequestHeaders(session.defaultSession, {}, auth);
  auth.bindWindow(window, { openExternal() {} });
  registerLicenseIpc({ ipcMain, licenseManager: manager, getMainWindow: () => window,
    getDesktopBaseUrl: () => origin, hasExactOrigin: (url, expected) => new URL(url).origin === expected });
  const dispose = registerDailyBotIpc({ ipcMain, getMainWindow: () => window, getDesktopBaseUrl: () => origin,
    controller: createDailyBotController({ licenseManager: manager }) });
  const disposeGift = registerGiftInteractionIpc({ ipcMain, getMainWindow: () => window, getDesktopBaseUrl: () => origin,
    controller: {
      refreshGiftInteractionState: async () => structuredClone(giftState),
      getGiftInteractionState: () => structuredClone(giftState),
      onGiftInteractionStateChanged: () => () => {},
      async setGiftInteraction({ key, enabled }) {
        global.dailyLibraryTest.requests.push({ operation: 'gift-interaction', key, enabled });
        giftState.values[key] = enabled;
        return structuredClone(giftState);
      },
    } });
  app.once('before-quit', () => { dispose(); disposeGift(); auth.dispose(); server.closeAllConnections(); server.close(); });
  app.on('window-all-closed', () => app.quit());
  await window.loadURL(`${origin}/admin`);
}
