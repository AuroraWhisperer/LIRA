'use strict';

export function getLegacyAdminModules() {
  return window.AdminApp || {};
}

export function publishNavigation(navigation) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.navigation = navigation;
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

export function publishSettings(settings) {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.settings = settings;
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
