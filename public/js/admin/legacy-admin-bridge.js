'use strict';

export function getLegacyAdminModules() {
  return window.AdminApp || {};
}

export function publishNavigation(navigation) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.navigation = navigation;
}

export function publishQueue(queue) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.queue = queue;
}

export function publishGiftModule(name, module) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts[name] = module;
}

export function publishGiftPanel(panel) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  Object.assign(window.AdminApp.gifts, panel);
}

export function publishSongs(songs) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.songs = songs;
}

export function publishMetrics(metrics) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.metrics = metrics;
}

export function publishTodo(todo) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.todo = todo;
}

export function publishGiftEffects(giftEffects) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.giftEffects = giftEffects;
}

export function publishState(stateService) {
  if (typeof window === 'undefined') return;
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.state = {
    connectSocket: () => stateService.connectSocket(),
    reloadAll: () => stateService.reloadAll(),
    reloadState: () => stateService.reloadState(),
    reloadSongs: () => stateService.reloadSongs(),
    scheduleSongReload: () => stateService.scheduleSongReload(),
    getAppState: () => stateService.getAppState(),
    getSongs: () => stateService.getSongs(),
    getCategories: () => stateService.getCategories(),
    getSongLanguages: () => stateService.getSongLanguages(),
    getSongArtists: () => stateService.getSongArtists(),
    setShuttingDown: (value) => stateService.setShuttingDown(value),
  };
}

export function publishAiAssistantSettings(settings) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.aiAssistantSettings = settings;
}

export function publishDanmakuTool(danmakuTool) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.danmakuTool = {
    init: (options = {}) =>
      danmakuTool.init({
        ...options,
        reconnectBilibili: options.reconnectBilibili ?? (() => window.AdminApp.settings?.reconnectBilibili?.()),
      }),
    refresh: danmakuTool.refresh,
  };
}

export function publishOther(other) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.other = {
    ...other,
    initOtherPage: (options = {}) =>
      other.initOtherPage({
        danmakuTool: window.AdminApp.danmakuTool,
        aiAssistantSettings: window.AdminApp.aiAssistantSettings,
        onNavigate: (page) => window.AdminApp.navigation?.setMainPage(page),
        ...options,
      }),
  };
}

export function publishDesktopLyricPreview(preview) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.desktopLyricPreview = preview;
}

export function publishDesktopLyric(desktopLyric) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.desktopLyric = desktopLyric;
}

export function publishImports(imports) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.imports = imports;
}

export function publishSettings(settings) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.settings = settings;
}

export function publishDisplay(display) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.display = display;
}

export function publishForms(formsService) {
  if (typeof window === 'undefined') return;
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.forms = {
    bindRangePair: (...args) => formsService.bindRangePair(...args),
    initTabs: () => formsService.initTabs(),
    initWorkspaceControls: (options = {}) =>
      formsService.initWorkspaceControls({
        getCloseQueuePopup: () => window.AdminApp.playback?.closeQueuePopup,
        ...options,
      }),
    refreshParameterRanges: (root) => formsService.refreshParameterRanges(root),
    fillForm: (values) => formsService.fillForm(values),
    normalizeQueueScrollSpeedForDisplay: (input) => formsService.normalizeQueueScrollSpeedForDisplay(input),
    normalizeSongScrollSpeedForDisplay: (input) => formsService.normalizeSongScrollSpeedForDisplay(input),
    normalizeFontSize: (...args) => formsService.normalizeFontSize(...args),
    scaleToFontSize: (...args) => formsService.scaleToFontSize(...args),
    reconnectErrorMessage: (error) => formsService.reconnectErrorMessage(error),
  };

  // 全局函数（为了兼容现有代码）
  window.openFullscreenPlayer = () => formsService.openFullscreenPlayer();
  window.closeFullscreenPlayer = () => formsService.closeFullscreenPlayer();
}

export function publishTheme(theme) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.theme = window.AdminApp.theme || {};
  Object.assign(window.AdminApp.theme, theme);
}
