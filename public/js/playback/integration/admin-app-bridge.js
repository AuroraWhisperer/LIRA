// 编写人：Aurora
// AdminApp 集成桥接模块
'use strict';

export function createAdminAppBridge(controller) {
  function initPlaybackAssistant(options = {}) {
    if (!controller) {
      throw new Error('Playback controller not initialized');
    }
    controller.init(options);
  }

  // 挂载到 window.AdminApp.playback
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.playback = {
    initPlaybackAssistant
  };

  // 触发模块加载完成事件
  if (typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('playback-module-loaded'));
  }

  return {
    initPlaybackAssistant
  };
}

export function createContextManager(initialOptions = {}) {
  const U = window.AdminApp.utils;

  let context = {
    getSongs: initialOptions.getSongs || (() => []),
    reloadSongs: initialOptions.reloadSongs || (async () => {}),
    toast: initialOptions.toast || U.toast,
    showError: initialOptions.showError || U.showError,
    api: initialOptions.api || U.api,
    readJsonResponse: initialOptions.readJsonResponse || U.readJsonResponse,
    escapeHtml: U.escapeHtml,
    escapeAttr: U.escapeAttr,
    value: U.value,
    formatBytes: U.formatBytes,
    formatCompactNumber: U.formatCompactNumber
  };

  function updateContext(options = {}) {
    if (typeof options.getSongs === 'function') context.getSongs = options.getSongs;
    if (typeof options.reloadSongs === 'function') context.reloadSongs = options.reloadSongs;
    if (typeof options.toast === 'function') context.toast = options.toast;
    if (typeof options.showError === 'function') context.showError = options.showError;
    if (typeof options.api === 'function') context.api = options.api;
    if (typeof options.readJsonResponse === 'function') context.readJsonResponse = options.readJsonResponse;
  }

  function getContext() {
    return context;
  }

  return {
    updateContext,
    getContext
  };
}
