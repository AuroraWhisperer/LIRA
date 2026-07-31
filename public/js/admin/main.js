// 编写人：Aurora
// 当前项目版本：1.3.4
// 主入口和导航
'use strict';

// 导入主题预设常量（已在 theme.js 中定义）
const {
  defaultThemeLook,
  classicThemePresets,
  classicPresetLabels,
  classicPresetSwatches,
  songBoardThemePresets,
  songBoardPresetLabels,
  songBoardPresetSwatches
} = window.AdminApp.theme;

// ── Navigation ───────────────────────────────────────────────────────────────

function initMainPages() {
  const buttons = document.querySelectorAll('.main-page-tab');
  if (!buttons.length) return;

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      setMainPage(button.dataset.mainPage || 'songAssistantPage');
    });
  });

  setMainPage(location.hash === '#playback' ? 'playbackAssistantPage' : 'songAssistantPage');
}

function setMainPage(pageId) {
  const nextPageId = pageId === 'playbackAssistantPage' ? 'playbackAssistantPage' : 'songAssistantPage';
  document.querySelectorAll('.main-page').forEach((page) => {
    page.classList.toggle('active', page.id === nextPageId);
  });
  document.querySelectorAll('.main-page-tab').forEach((button) => {
    const isActive = button.dataset.mainPage === nextPageId;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  document.body.dataset.mainPage = nextPageId === 'playbackAssistantPage' ? 'playback' : 'songs';
  if (location.hash !== (nextPageId === 'playbackAssistantPage' ? '#playback' : '')) {
    history.replaceState(null, '', nextPageId === 'playbackAssistantPage' ? '#playback' : location.pathname + location.search);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // 导航和工作区
  initMainPages();
  if (window.AdminApp.forms) {
    window.AdminApp.forms.initWorkspaceControls();
    window.AdminApp.forms.initTabs();
  }

  // 播放助手
  if (window.AdminApp.playback && window.AdminApp.playback.initPlaybackAssistant) {
    const { toast, showError, api, readJsonResponse } = window.AdminApp.utils;
    const getSongs = window.AdminApp.state ? window.AdminApp.state.getSongs : () => [];
    const reloadSongs = window.AdminApp.state ? window.AdminApp.state.reloadSongs : () => {};
    window.AdminApp.playback.initPlaybackAssistant({
      getSongs,
      reloadSongs,
      toast,
      showError,
      api,
      readJsonResponse
    });
  }

  // 桌面环境
  if (window.AdminApp.desktop && window.AdminApp.desktop.initDesktopShell) {
    window.AdminApp.desktop.initDesktopShell();
  }

  // 表单初始化
  if (window.AdminApp.queue) window.AdminApp.queue.initQueueForm();
  if (window.AdminApp.songs) window.AdminApp.songs.initSongForm();
  if (window.AdminApp.settings) window.AdminApp.settings.initSettingsForm();
  if (window.AdminApp.theme) window.AdminApp.theme.initThemeForm();
  if (window.AdminApp.display) {
    window.AdminApp.display.initDisplayForm();
    window.AdminApp.display.initOverlayUrls();
  }
  if (window.AdminApp.desktopLyric) window.AdminApp.desktopLyric.initDesktopLyricForm();
  if (window.AdminApp.metrics) window.AdminApp.metrics.initPerformanceMonitor();

  // 网络和数据
  if (window.AdminApp.state) {
    window.AdminApp.state.connectSocket();
    window.AdminApp.state.reloadAll();
  }

  // 渲染主题预设卡片
  if (window.AdminApp.theme && window.AdminApp.theme.renderPresetCards) {
    window.AdminApp.theme.renderPresetCards('classicPresets', classicThemePresets, classicPresetLabels, classicPresetSwatches);
    window.AdminApp.theme.renderPresetCards('songBoardPresets', songBoardThemePresets, songBoardPresetLabels, songBoardPresetSwatches);
  }
});
