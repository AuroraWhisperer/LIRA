// 编写人：Aurora
// Admin应用统一入口 - ES6模块化版本
'use strict';

import { container } from '../shared/container.js';
import { eventBus, Events } from '../shared/event-bus.js';
import { logger } from '../shared/logger.js';
import * as Utils from '../shared/utils.js';
import * as Theme from '../shared/theme.js';

// 导入服务（如果已经重构为ES6模块）
import { StateService, stateService } from './state.js';
import { FormsService, formsService } from './forms.js';

/**
 * 应用初始化
 */
async function initApp() {
  logger.debug('正在初始化...');

  // 注册服务到容器
  container
    .register('eventBus', () => eventBus)
    .register('utils', () => Utils)
    .register('theme', () => Theme)
    .register('state', () => stateService)
    .register('forms', () => formsService);

  // 初始化导航
  initMainPages();

  // 初始化表单和工作区
  formsService.initWorkspaceControls();
  formsService.initTabs();

  // 初始化播放助手（监听模块加载完成事件）
  window.addEventListener('playback-module-loaded', initPlaybackAssistant, { once: true });

  // 如果模块已经加载完成（DOMContentLoaded 晚于模块加载），立即初始化
  if (window.AdminApp.playback && window.AdminApp.playback.initPlaybackAssistant) {
    initPlaybackAssistant();
  }

  // 初始化桌面环境
  if (window.AdminApp.desktop && window.AdminApp.desktop.initDesktopShell) {
    window.AdminApp.desktop.initDesktopShell();
  }

  // 初始化各模块表单（使用兼容层调用）
  if (window.AdminApp.queue) window.AdminApp.queue.initQueueForm();
  if (window.AdminApp.songs) window.AdminApp.songs.initSongForm();
  if (window.AdminApp.settings) {
    window.AdminApp.settings.initSettingsForm();
    window.AdminApp.settings.initBilibiliAuth();
  }
  if (window.AdminApp.theme) window.AdminApp.theme.initThemeForm();
  if (window.AdminApp.display) {
    window.AdminApp.display.initDisplayForm();
    window.AdminApp.display.initOverlayUrls();
  }
  if (window.AdminApp.desktopLyric) window.AdminApp.desktopLyric.initDesktopLyricForm();
  if (window.AdminApp.metrics) window.AdminApp.metrics.initPerformanceMonitor();
  // 初始化「百宝箱」页面的通用功能导航
  if (window.AdminApp.other && window.AdminApp.other.initOtherPage) {
    window.AdminApp.other.initOtherPage();
  }
  if (window.AdminApp.gifts && window.AdminApp.gifts.initGiftHistoryDrawer) {
    window.AdminApp.gifts.initGiftHistoryDrawer();
  }

  eventBus.on(Events.STATE_LOADED, ({ state, songs }) => {
    if (window.AdminApp.queue && window.AdminApp.queue.renderState) {
      window.AdminApp.queue.renderState(state, songs);
    }
  });
  eventBus.on(Events.SONG_UPDATED, ({ songs, languages, artists, tags }) => {
    if (window.AdminApp.songs && window.AdminApp.songs.renderSongs) {
      window.AdminApp.songs.renderSongs(songs, languages, artists, tags);
    }
  });

  // 连接WebSocket和加载数据
  stateService.connectSocket();
  await stateService.reloadAll();

  // 渲染主题预设
  if (window.AdminApp.theme && window.AdminApp.theme.renderPresetCards) {
    const { classicThemePresets, classicPresetLabels, classicPresetSwatches,
            songBoardThemePresets, songBoardPresetLabels, songBoardPresetSwatches } = window.AdminApp.theme;
    window.AdminApp.theme.renderPresetCards('classicPresets', classicThemePresets, classicPresetLabels, classicPresetSwatches);
    window.AdminApp.theme.renderPresetCards('songBoardPresets', songBoardThemePresets, songBoardPresetLabels, songBoardPresetSwatches);
  }

  logger.debug('初始化完成');
}

/**
 * 初始化播放助手
 */
function initPlaybackAssistant() {
  if (window.AdminApp.playback && window.AdminApp.playback.initPlaybackAssistant) {
    window.AdminApp.playback.initPlaybackAssistant({
      getSongs: () => stateService.getSongs(),
      reloadSongs: () => stateService.reloadSongs(),
      toast: Utils.toast,
      showError: Utils.showError,
      api: Utils.api,
      readJsonResponse: Utils.readJsonResponse
    });
  }
}

/**
 * 初始化主页面导航
 */
function initMainPages() {
  const buttons = document.querySelectorAll('.main-page-tab');
  if (!buttons.length) return;

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      setMainPage(button.dataset.mainPage || 'songAssistantPage');
    });
  });

  const hash = location.hash;
  const initialPage = hash === '#playback' ? 'playbackAssistantPage'
                    : hash === '#gifts' ? 'giftAssistantPage'
                    : hash === '#other' ? 'otherAssistantPage'
                    : 'songAssistantPage';
  setMainPage(initialPage);
}

// 有效的主页面 ID 列表 — 新增页面时在此注册即可
const VALID_MAIN_PAGES = ['songAssistantPage', 'playbackAssistantPage', 'giftAssistantPage', 'otherAssistantPage'];
// 主页面 → URL hash 映射（songAssistantPage 为默认页，无需 hash）
const MAIN_PAGE_HASH_MAP = { playbackAssistantPage: '#playback', giftAssistantPage: '#gifts', otherAssistantPage: '#other' };
// 主页面 → body dataset 标识
const MAIN_PAGE_BODY_MAP = { playbackAssistantPage: 'playback', giftAssistantPage: 'gifts', songAssistantPage: 'songs', otherAssistantPage: 'other' };

/**
 * 设置主页面
 */
function setMainPage(pageId) {
  const nextPageId = VALID_MAIN_PAGES.includes(pageId) ? pageId : 'songAssistantPage';

  document.querySelectorAll('.main-page').forEach((page) => {
    page.classList.toggle('active', page.id === nextPageId);
  });

  document.querySelectorAll('.main-page-tab').forEach((button) => {
    const isActive = button.dataset.mainPage === nextPageId;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  document.body.dataset.mainPage = MAIN_PAGE_BODY_MAP[nextPageId] || 'songs';

  const targetHash = MAIN_PAGE_HASH_MAP[nextPageId] || '';
  if (location.hash !== targetHash) {
    history.replaceState(null, '', targetHash || location.pathname + location.search);
  }
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.navigation = { setMainPage };

// 模块脚本执行时文档通常已是 interactive，但同级模块可能仍未执行完；
// 等到 DOMContentLoaded 再启动，确保所有 window.AdminApp 模块均已注册。
if (document.readyState === 'complete') {
  initApp();
} else {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
}

// 【过渡期】暴露到全局，方便调试和兼容
if (typeof window !== 'undefined') {
  window.__APP_CONTAINER__ = container;
  window.__APP_EVENT_BUS__ = eventBus;
}
