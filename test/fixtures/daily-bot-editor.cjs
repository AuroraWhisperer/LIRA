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
  app.disableHardwareAcceleration();
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
  const { WELCOME_TIME_PERIODS } = require('../../public/js/shared/welcome-time-periods.js');
  const { DEFAULT_GIFT_THANKS_TEMPLATES, createGiftThanksReplies } = require('../../public/js/shared/gift-thanks-templates.js');
  const root = path.resolve(__dirname, '../..');
  const directory = path.resolve(process.argv[2]);
  const layoutMode = process.argv[3] === 'layout';
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
    likeThanksEnabled: false, likeThanksMessages: ['谢谢 {username} 的点赞！'],
    shareThanksEnabled: false, shareThanksMessages: ['谢谢 {username} 的分享！'],
    followThanksEnabled: false, followThanksMessages: ['谢谢 {username} 的关注！'],
    scheduledDanmaku: { mode: 'fixed', intervalSeconds: 300, minSeconds: 300, maxSeconds: 600, selection: 'sequential', messages: [] },
  };
  if (layoutMode) {
    fixedReplies.customExactReplies = Array.from({ length: 30 }, (_, index) => ({ trigger: `指令${index + 1}`, reply: `测试回复 ${index + 1}` }));
    fixedReplies.scheduledDanmaku.messages = Array.from({ length: 199 }, (_, index) => `定时测试文案 ${index + 1}`);
    for (const kind of ['like', 'share', 'follow']) fixedReplies[`${kind}ThanksMessages`] = Array.from({ length: 30 }, (_, index) => `谢谢 {username} 的支持 ${index + 1}`);
  }
  global.dailyLibraryTest = { requests: [], libraries, failNext: false, fixedReplies };
  const viewerNames = { enabled: true,
    items: Array.from({ length: 21 }, (_, index) => ({ uid: String(100 + index), name: `观众${index + 1}` })) };
  global.dailyLibraryTest.viewerNames = viewerNames;
  global.dailyLibraryTest.switchNamesAccount = () => {
    snapshot.streamer.accountName = 'other-names-test';
    viewerNames.items = [{ uid: '900', name: '另一账号' }];
    listeners.forEach(listener => listener(structuredClone(snapshot)));
  };
  const welcomeSettings = {
    schemaVersion: 2, enabled: true, welcomeDelaySeconds: 0, welcomeMinHonorLevel: 0,
    greetingEnabled: false, greetingDelaySeconds: 10, greetingMinHonorLevel: 0,
    attentionEnabled: false, attentionMinHonorLevel: 31, rareNamePinyinEnabled: false,
    returningEnabled: false, returningMessages: ['最近过得怎么样呀？', '很高兴又见到你～'],
    timeWelcomeEnabled: false,
    welcomeOwnMedalOnly: false,
    timeWelcomeMessages: Object.fromEntries(WELCOME_TIME_PERIODS.map(({ id, label }) =>
      [id, Array.from({ length: 12 }, (_, index) => `${label}好 {username}，测试文案 ${index + 1}`)])),
    messages: ['欢迎 {username} 来到直播间～'], greetingMessages: ['{username}，你好呀～'],
    attentionWelcomeMessages: ['欢迎 {username}～'], attentionGreetingMessages: ['{username}，来听歌吧～'],
    userWelcomeMessages: [],
    welcomeWhitelist: [], welcomeBlacklist: [],
  };
  global.dailyLibraryTest.welcomeSettings = welcomeSettings;
  if (layoutMode) {
    welcomeSettings.messages = Array.from({ length: 30 }, (_, index) => `欢迎 {username}，测试文案 ${index + 1}`);
    welcomeSettings.userWelcomeMessages = Array.from({ length: 30 }, (_, index) => ({ uid: String(100 + index), message: `欢迎观众 ${index + 1}` }));
    welcomeSettings.welcomeWhitelist = Array.from({ length: 30 }, (_, index) => String(1000 + index));
    welcomeSettings.welcomeBlacklist = Array.from({ length: 30 }, (_, index) => String(2000 + index));
  }
  const pkSettings = { ok: true, enabled: true, reportEnabled: true, visitorWelcomeEnabled: true,
    visitorWelcomeDelaySeconds: 5, visitorWelcomeMessages: Array.from({ length: 30 }, (_, index) => `欢迎 {username} 来串门 ${index + 1}`) };
  const giftState = { ok: true, status: 'confirmed', templates: { ...DEFAULT_GIFT_THANKS_TEMPLATES },
    values: { giftAutoThanksEnabled: true, giftStatsQueryEnabled: false } };
  if (process.argv[3] === 'gift-thanks' || layoutMode) giftState.replies = createGiftThanksReplies();
  if (layoutMode) for (const value of Object.values(giftState.replies)) {
    value.messages = Array.from({ length: 6 }, (_, index) => ({ text: `谢谢{称呼}送来的{礼物}，支持收到啦！文案 ${index + 1}` }));
  }
  const giftListeners = new Set();
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
      const next = structuredClone(patch);
      if (next.timeWelcomeMessages)
        next.timeWelcomeMessages = { ...welcomeSettings.timeWelcomeMessages, ...next.timeWelcomeMessages };
      Object.assign(welcomeSettings, next);
      if (!welcomeSettings.enabled)
        Object.assign(welcomeSettings, { greetingEnabled: false, attentionEnabled: false, returningEnabled: false });
      return structuredClone(welcomeSettings);
    },
    async getFixedReplySettings() { return structuredClone(fixedReplies); },
    async getPkReportSettings() { return structuredClone(pkSettings); },
    async updatePkReportSettings(patch) { Object.assign(pkSettings, patch); return structuredClone(pkSettings); },
    async getViewerNameSettings() { return { enabled: viewerNames.enabled }; },
    async updateViewerNameSettings({ enabled }) {
      if (global.dailyLibraryTest.failNext) {
        global.dailyLibraryTest.failNext = false;
        throw Object.assign(new Error('UNAVAILABLE'), { code: 'UNAVAILABLE' });
      }
      viewerNames.enabled = enabled;
      return { enabled };
    },
    async listViewerNames({ page }) {
      global.dailyLibraryTest.requests.push({ operation: 'viewer-names-read', input: { page } });
      page = Math.min(page, Math.max(1, Math.ceil(viewerNames.items.length / 20)));
      const result = { items: structuredClone(viewerNames.items.slice((page - 1) * 20, page * 20)),
        total: viewerNames.items.length, page, pageSize: 20 };
      if (global.dailyLibraryTest.holdNamesRead) {
        global.dailyLibraryTest.holdNamesRead = false;
        return new Promise(resolve => { global.dailyLibraryTest.releaseNamesRead = () => resolve(result); });
      }
      return result;
    },
    async updateViewerName({ uid, name }) {
      if (global.dailyLibraryTest.failNext) {
        global.dailyLibraryTest.failNext = false;
        throw Object.assign(new Error('UNAVAILABLE'), { code: 'UNAVAILABLE' });
      }
      viewerNames.items.find(item => item.uid === uid).name = name;
      return { uid, name };
    },
    async deleteViewerName(uid) { viewerNames.items = viewerNames.items.filter(item => item.uid !== uid); return { ok: true }; },
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
        if (process.argv[3] === 'ai-personas') {
          res.end(`import { createPersonaControls } from './ai-assistant-personas.js';
            import './contextual-help.js';
            const panel = document.getElementById('xiaomiAiSection');
            document.body.replaceChildren(panel);
            document.body.style.cssText = 'display:block;overflow:auto;padding:24px';
            document.getElementById('xiaomiAiModelProvider').value = 'custom';
            const config = { personaId: 'general', modelProvider: 'custom', personas: [
              { id: 'general', name: '通用人格', builtin: true, description: '已保存的说明', prompt: '已保存的角色指南内容，长度足够用于实际表单校验。' },
              { id: 'test-persona', name: '测试预设', description: '自建角色', prompt: '这是自建角色的已保存指南，长度足够用于实际表单校验。' }
            ] };
            const controls = createPersonaControls({ flushPendingSave: async () => true,
              acceptConfig: (value) => { window.aiPersonaTest.config = value; controls.render(value); } });
            window.aiPersonaTest = { config, controls };
            controls.render(config);`);
          return;
        }
        res.end(`import { initDanmakuDailyBots } from './danmaku-daily-bots.js';
          import { initFixedReplyEditor } from './danmaku-fixed-replies.js';
          import { initDanmakuTabs } from './danmaku-tabs.js';
          import { initDanmakuCloudReplies } from './danmaku-cloud-replies.js';
          import { initDanmakuWelcome } from './danmaku-welcome.js';
          import { initDanmakuViewerNames } from './danmaku-viewer-names.js';
          import { initDanmakuPkReport } from './danmaku-pk-report.js';
          import { createCustomReplyEditor } from './danmaku-libraries.js';
          import { initDanmakuQueryReplies } from './danmaku-query-replies.js';
          import { initGiftInteractionControls } from './gifts/interaction-controls.js';
          import './contextual-help.js';
          const panel = document.getElementById('otherDanmakuFeature');
          panel.hidden = false;
          panel.classList.add('active');
          document.body.replaceChildren(panel);
          document.body.style.cssText = 'display:block;overflow:auto;padding:24px';
          initDanmakuTabs();
          ${process.argv[3] === 'gift-thanks' ? '' : 'initDanmakuDailyBots(); initDanmakuCloudReplies(); initDanmakuQueryReplies(); initDanmakuWelcome();'}
          ${process.argv[3] === 'viewer-names' || layoutMode ? 'initDanmakuViewerNames();' : ''}
          ${layoutMode ? `initDanmakuPkReport();
            const keyword = createCustomReplyEditor({ document, saveSetting: async () => {}, toast: () => {} });
            keyword.load(JSON.stringify(Array.from({ length: 30 }, (_, index) => ({ keyword: '关键词' + index, reply: '测试回复 ' + index, enabled: true }))));` : ''}
          const { initDanmakuGiftThanks } = await import('/js/admin/danmaku-gift-thanks.js');
          const thanks = initDanmakuGiftThanks();
          initGiftInteractionControls({ surface: 'danmaku', onState: thanks.updateState }); initFixedReplyEditor();`);
        return;
      }
      servePageOrAsset(path.join(root, 'public'), req, res, url, token);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  if ((await fetch(`${origin}/admin`)).status !== 401) throw new Error('Admin must require desktop authorization.');
  const window = new BrowserWindow({ width: 1440, height: 1000, show: false,
    webPreferences: { preload: path.join(root, 'src/electron/preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      offscreen: true, backgroundThrottling: false } });
  const auth = createDesktopRequestAuth({ desktopSession: session.defaultSession,
    getMainWindow: () => window, getBaseUrl: () => origin, getToken: () => token });
  configureMediaRequestHeaders(session.defaultSession, auth);
  auth.bindWindow(window, { openExternal() {} });
  registerLicenseIpc({ ipcMain, licenseManager: manager, getMainWindow: () => window,
    getDesktopBaseUrl: () => origin, hasExactOrigin: (url, expected) => new URL(url).origin === expected });
  const dispose = registerDailyBotIpc({ ipcMain, getMainWindow: () => window, getDesktopBaseUrl: () => origin,
    controller: createDailyBotController({ licenseManager: manager }) });
  const disposeGift = registerGiftInteractionIpc({ ipcMain, getMainWindow: () => window, getDesktopBaseUrl: () => origin,
    controller: {
      refreshGiftInteractionState: async () => structuredClone(giftState),
      getGiftInteractionState: () => structuredClone(giftState),
      onGiftInteractionStateChanged: listener => { giftListeners.add(listener); return () => giftListeners.delete(listener); },
      async setGiftInteraction({ key, enabled }) {
        global.dailyLibraryTest.requests.push({ operation: 'gift-interaction', key, enabled });
        giftState.values[key] = enabled;
        giftListeners.forEach(listener => listener(structuredClone(giftState)));
        return structuredClone(giftState);
      },
      async setGiftThanksTemplates(templates) {
        global.dailyLibraryTest.requests.push({ operation: 'gift-thanks-templates', templates });
        if (global.dailyLibraryTest.failNext) {
          global.dailyLibraryTest.failNext = false;
          return { ...structuredClone(giftState), ok: false, status: 'unconfirmed', error: 'CLOUD_SYNC_FAILED' };
        }
        giftState.templates = structuredClone(templates);
        giftListeners.forEach(listener => listener(structuredClone(giftState)));
        return structuredClone(giftState);
      },
      async setGiftThanksReplies(replies) {
        global.dailyLibraryTest.requests.push({ operation: 'gift-thanks-replies', replies: structuredClone(replies) });
        giftState.replies = structuredClone(replies);
        giftListeners.forEach(listener => listener(structuredClone(giftState)));
        return structuredClone(giftState);
      },
    } });
  app.once('before-quit', () => { dispose(); disposeGift(); auth.dispose(); server.closeAllConnections(); server.close(); });
  app.on('window-all-closed', () => app.quit());
  await window.loadURL(`${origin}/admin`);
}
