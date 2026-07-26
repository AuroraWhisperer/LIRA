// 编写人：Aurora
// 当前项目版本：1.1.1
'use strict';

let appState = null;
let songs = [];
let categories = [];
let activeToastKeys = new Set();
let desktopUpdateNoticeKey = '';
let songReloadTimer = null;
let shuttingDown = false;
let metricsRunning = false;

const multilingualFontFallback = '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';

const defaultThemeLook = {
  themePrimary: '#ff6f91',
  themeAccent: '#21b6a8',
  themeText: '#ffffff',
  themeBackground: '#181823',
  queueSongFontSize: '20',
  queueTitleFontSize: '15',
  themeOpacity: '0.35',
  themeRadius: '12',
  overlayLowPowerMode: 'false',
  backdropBlur: '0',
  glowIntensity: '0',
  enableGradient: 'false',
  gradientEnd: '#181823',
  overlayFontFamily: 'Microsoft YaHei',
  overlayFontWeight: '800',
  overlaySongColor: '',
  overlayRequesterColor: '',
  overlayTitle: '',
  overlayShowIndex: 'true',
  overlayIndexThreshold: '0',
  overlayIndexColor: '#fbbf24',
  queueFixedSixRows: 'true',
  queueScrollMode: 'bounce',
  queueScrollSpeed: '80'
};

const classicThemePresets = {
  // === 极简（纯透背景） ===
  pure: {
    themePrimary: '#555555', themeAccent: '#888888',
    themeText: '#1a1a1a', themeBackground: '#ffffff',
    themeOpacity: '0.00', themeRadius: '0',
    backdropBlur: '0', glowIntensity: '0',
    enableGradient: 'false', gradientEnd: '#ffffff',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    overlayFontWeight: '600',
    overlaySongColor: '#1a1a1a',
    overlayRequesterColor: '#666666',
    queueScrollSpeed: '80'
  },
  // === 浅色系（明亮白透毛玻璃） ===
  cream: {
    themePrimary: '#f59e0b', themeAccent: '#d97706',
    themeText: '#3d2a14', themeBackground: '#f5ede4',
    themeOpacity: '0.45', themeRadius: '14',
    backdropBlur: '24', glowIntensity: '2',
    enableGradient: 'true', gradientEnd: '#e8d5c0',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'KaiTi, STKaiti, serif',
    overlayFontWeight: '700',
    overlaySongColor: '#5c3d1a',
    overlayRequesterColor: '#8b6914',
    queueScrollSpeed: '80'
  },
  sky: {
    themePrimary: '#3b82f6', themeAccent: '#f59e0b',
    themeText: '#1a2e3d', themeBackground: '#e8f2f8',
    themeOpacity: '0.42', themeRadius: '12',
    backdropBlur: '22', glowIntensity: '2',
    enableGradient: 'true', gradientEnd: '#d8e8f4',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    overlayFontWeight: '700',
    overlaySongColor: '#1e40af',
    overlayRequesterColor: '#64748b',
    queueScrollSpeed: '80'
  },
  peach: {
    themePrimary: '#ec4899', themeAccent: '#8b5cf6',
    themeText: '#3d1a2a', themeBackground: '#fce7f0',
    themeOpacity: '0.45', themeRadius: '16',
    backdropBlur: '24', glowIntensity: '3',
    enableGradient: 'true', gradientEnd: '#f0d8e4',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'system-ui, -apple-system, sans-serif',
    overlayFontWeight: '800',
    overlaySongColor: '#be185d',
    overlayRequesterColor: '#9d174d',
    queueScrollSpeed: '80'
  },
  mint: {
    themePrimary: '#10b981', themeAccent: '#f59e0b',
    themeText: '#1a2d20', themeBackground: '#e6f2ea',
    themeOpacity: '0.42', themeRadius: '14',
    backdropBlur: '22', glowIntensity: '2',
    enableGradient: 'true', gradientEnd: '#d4e8da',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    overlayFontWeight: '700',
    overlaySongColor: '#065f46',
    overlayRequesterColor: '#64748b',
    queueScrollSpeed: '80'
  },
  // === 深色系（暗色氛围毛玻璃） ===
  sakura: {
    themePrimary: '#ff7eb3', themeAccent: '#7ec8e3',
    themeText: '#fff5f7', themeBackground: '#1a1424',
    themeOpacity: '0.28', themeRadius: '16',
    backdropBlur: '22', glowIntensity: '4',
    enableGradient: 'true', gradientEnd: '#2d1a2e',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'system-ui, -apple-system, sans-serif',
    overlayFontWeight: '800',
    overlaySongColor: '#fda4af',
    overlayRequesterColor: '#c0a4b8',
    queueScrollSpeed: '80'
  },
  starry: {
    themePrimary: '#c4b5fd', themeAccent: '#67e8f9',
    themeText: '#f5f3ff', themeBackground: '#0f0a1e',
    themeOpacity: '0.26', themeRadius: '14',
    backdropBlur: '24', glowIntensity: '6',
    enableGradient: 'true', gradientEnd: '#1e1050',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    overlayFontWeight: '700',
    overlaySongColor: '#ddd6fe',
    overlayRequesterColor: '#a5b4fc',
    queueScrollSpeed: '80'
  },
  ocean: {
    themePrimary: '#60a5fa', themeAccent: '#fbbf24',
    themeText: '#f0f9ff', themeBackground: '#0c1929',
    themeOpacity: '0.30', themeRadius: '12',
    backdropBlur: '20', glowIntensity: '4',
    enableGradient: 'true', gradientEnd: '#061a34',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'Microsoft YaHei, SimHei, sans-serif',
    overlayFontWeight: '800',
    overlaySongColor: '#93c5fd',
    overlayRequesterColor: '#7b9cc4',
    queueScrollSpeed: '80'
  },
  sunset: {
    themePrimary: '#fb923c', themeAccent: '#f472b6',
    themeText: '#fffbf0', themeBackground: '#2a1508',
    themeOpacity: '0.30', themeRadius: '14',
    backdropBlur: '18', glowIntensity: '6',
    enableGradient: 'true', gradientEnd: '#3d1f0a',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'SimHei, Microsoft YaHei, sans-serif',
    overlayFontWeight: '800',
    overlaySongColor: '#fdba74',
    overlayRequesterColor: '#d6a074',
    queueScrollSpeed: '80'
  },
  cyber: {
    themePrimary: '#22d3ee', themeAccent: '#e879f9',
    themeText: '#f0f9ff', themeBackground: '#0a0a14',
    themeOpacity: '0.32', themeRadius: '6',
    backdropBlur: '14', glowIntensity: '14',
    enableGradient: 'true', gradientEnd: '#140a28',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    overlayFontWeight: '800',
    overlaySongColor: '#67e8f9',
    overlayRequesterColor: '#d8b4fe',
    queueScrollSpeed: '80'
  },
  gold: {
    themePrimary: '#fbbf24', themeAccent: '#f59e0b',
    themeText: '#fefce8', themeBackground: '#0c0a08',
    themeOpacity: '0.32', themeRadius: '10',
    backdropBlur: '22', glowIntensity: '6',
    enableGradient: 'true', gradientEnd: '#1c1608',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'KaiTi, STKaiti, serif',
    overlayFontWeight: '700',
    overlaySongColor: '#fde68a',
    overlayRequesterColor: '#a3a18a',
    queueScrollSpeed: '80'
  },
  lavender: {
    themePrimary: '#c084fc', themeAccent: '#f9a8d4',
    themeText: '#faf5ff', themeBackground: '#170f1f',
    themeOpacity: '0.28', themeRadius: '16',
    backdropBlur: '24', glowIntensity: '6',
    enableGradient: 'true', gradientEnd: '#2d1050',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'system-ui, -apple-system, sans-serif',
    overlayFontWeight: '800',
    overlaySongColor: '#e9d5ff',
    overlayRequesterColor: '#c4b5fd',
    queueScrollSpeed: '80'
  },
  // === 新增3种预设（v1.1.2） ===
  emerald: {
    themePrimary: '#34d399', themeAccent: '#fbbf24',
    themeText: '#f0fdf4', themeBackground: '#0a1a10',
    themeOpacity: '0.30', themeRadius: '12',
    backdropBlur: '20', glowIntensity: '5',
    enableGradient: 'true', gradientEnd: '#061208',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    overlayFontWeight: '700',
    overlaySongColor: '#6ee7b7',
    overlayRequesterColor: '#86a894',
    queueScrollSpeed: '80'
  },
  rose: {
    themePrimary: '#f472b6', themeAccent: '#c084fc',
    themeText: '#fff1f5', themeBackground: '#1a0e14',
    themeOpacity: '0.30', themeRadius: '14',
    backdropBlur: '22', glowIntensity: '5',
    enableGradient: 'true', gradientEnd: '#2d1020',
    queueSongFontSize: '20', queueTitleFontSize: '15',
    overlayFontFamily: 'system-ui, -apple-system, sans-serif',
    overlayFontWeight: '800',
    overlaySongColor: '#f9a8d4',
    overlayRequesterColor: '#c4a0b0',
    queueScrollSpeed: '80'
  },
};

const classicPresetLabels = {
  pure: '🪟 纯透极简',
  cream: '🥛 奶油杏白', sky: '☁️ 晴空浅蓝', peach: '🍑 蜜桃奶白',
  mint: '🌿 薄荷浅绿',
  sakura: '🌸 樱粉甜梦', starry: '✨ 星夜幻紫', ocean: '🌊 深海湛蓝',
  sunset: '🌅 暖橘落日', cyber: '⚡ 赛博霓虹',
  gold: '🥇 暗夜黑金', lavender: '💜 薰衣草雾',
  emerald: '🌲 翡翠深林', rose: '🌹 丝绒玫瑰'
};

const classicPresetSwatches = {
  pure: ['#ffffff', '#555555', '#888888', '#1a1a1a'],
  cream: ['#f5ede4', '#f59e0b', '#d97706', '#3d2a14'],
  sky: ['#e8f2f8', '#3b82f6', '#f59e0b', '#1a2e3d'],
  peach: ['#fce7f0', '#ec4899', '#8b5cf6', '#3d1a2a'],
  mint: ['#e6f2ea', '#10b981', '#f59e0b', '#1a2d20'],
  sakura: ['#1a1424', '#ff7eb3', '#7ec8e3', '#fff5f7'],
  starry: ['#0f0a1e', '#c4b5fd', '#67e8f9', '#f5f3ff'],
  ocean: ['#0c1929', '#60a5fa', '#fbbf24', '#f0f9ff'],
  sunset: ['#2a1508', '#fb923c', '#f472b6', '#fffbf0'],
  cyber: ['#0a0a14', '#22d3ee', '#e879f9', '#f0f9ff'],
  gold: ['#0c0a08', '#fbbf24', '#f59e0b', '#fefce8'],
  lavender: ['#170f1f', '#c084fc', '#f9a8d4', '#faf5ff'],
  emerald: ['#0a1a10', '#34d399', '#fbbf24', '#f0fdf4'],
  rose: ['#1a0e14', '#f472b6', '#c084fc', '#fff1f5']
};

const songBoardThemePresets = {
  pure: {
    songBoardThemePrimary: '#555555', songBoardThemeAccent: '#888888',
    songBoardThemeText: '#1a1a1a', songBoardThemeBackground: '#ffffff',
    songBoardThemeOpacity: '0.00', songBoardThemeRadius: '0',
    songBoardBackdropBlur: '0', songBoardGlowIntensity: '0',
    songBoardEnableGradient: 'false', songBoardGradientEnd: '#ffffff',
    songBoardFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    songBoardFontWeight: '600', songBoardSongColor: '#1a1a1a',
    songBoardTitle: '可点歌单',
    songBoardSongFontSize: '16', songBoardTitleFontSize: '15',
    scrollSeconds: '80'
  },
  sunset: {
    songBoardThemePrimary: '#fb923c', songBoardThemeAccent: '#f472b6',
    songBoardThemeText: '#fffbf0', songBoardThemeBackground: '#2a1508',
    songBoardThemeOpacity: '0.30', songBoardThemeRadius: '14',
    songBoardBackdropBlur: '18', songBoardGlowIntensity: '6',
    songBoardEnableGradient: 'true', songBoardGradientEnd: '#3d1f0a',
    songBoardFontFamily: 'SimHei, Microsoft YaHei, sans-serif',
    songBoardFontWeight: '800', songBoardSongColor: '#fdba74',
    songBoardTitle: '可点歌单',
    songBoardSongFontSize: '17', songBoardTitleFontSize: '15',
    scrollSeconds: '80'
  },
  starry: {
    songBoardThemePrimary: '#c4b5fd', songBoardThemeAccent: '#67e8f9',
    songBoardThemeText: '#f5f3ff', songBoardThemeBackground: '#0f0a1e',
    songBoardThemeOpacity: '0.26', songBoardThemeRadius: '14',
    songBoardBackdropBlur: '24', songBoardGlowIntensity: '6',
    songBoardEnableGradient: 'true', songBoardGradientEnd: '#1e1050',
    songBoardFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    songBoardFontWeight: '700', songBoardSongColor: '#ddd6fe',
    songBoardTitle: '可点歌单',
    songBoardSongFontSize: '16', songBoardTitleFontSize: '15',
    scrollSeconds: '80'
  },
  ocean: {
    songBoardThemePrimary: '#60a5fa', songBoardThemeAccent: '#fbbf24',
    songBoardThemeText: '#f0f9ff', songBoardThemeBackground: '#0c1929',
    songBoardThemeOpacity: '0.30', songBoardThemeRadius: '12',
    songBoardBackdropBlur: '20', songBoardGlowIntensity: '4',
    songBoardEnableGradient: 'true', songBoardGradientEnd: '#061a34',
    songBoardFontFamily: 'Microsoft YaHei, SimHei, sans-serif',
    songBoardFontWeight: '800', songBoardSongColor: '#93c5fd',
    songBoardTitle: '可点歌单',
    songBoardSongFontSize: '16', songBoardTitleFontSize: '15',
    scrollSeconds: '80'
  },
  sky: {
    songBoardThemePrimary: '#3b82f6', songBoardThemeAccent: '#f59e0b',
    songBoardThemeText: '#1a2e3d', songBoardThemeBackground: '#e8f2f8',
    songBoardThemeOpacity: '0.42', songBoardThemeRadius: '12',
    songBoardBackdropBlur: '22', songBoardGlowIntensity: '2',
    songBoardEnableGradient: 'true', songBoardGradientEnd: '#d8e8f4',
    songBoardFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    songBoardFontWeight: '700', songBoardSongColor: '#1e40af',
    songBoardTitle: '可点歌单',
    songBoardSongFontSize: '16', songBoardTitleFontSize: '15',
    scrollSeconds: '80'
  },
  mint: {
    songBoardThemePrimary: '#10b981', songBoardThemeAccent: '#f59e0b',
    songBoardThemeText: '#1a2d20', songBoardThemeBackground: '#e6f2ea',
    songBoardThemeOpacity: '0.42', songBoardThemeRadius: '14',
    songBoardBackdropBlur: '22', songBoardGlowIntensity: '2',
    songBoardEnableGradient: 'true', songBoardGradientEnd: '#d4e8da',
    songBoardFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    songBoardFontWeight: '700', songBoardSongColor: '#065f46',
    songBoardTitle: '可点歌单',
    songBoardSongFontSize: '16', songBoardTitleFontSize: '15',
    scrollSeconds: '80'
  },
  peach: {
    songBoardThemePrimary: '#ec4899', songBoardThemeAccent: '#8b5cf6',
    songBoardThemeText: '#3d1a2a', songBoardThemeBackground: '#fce7f0',
    songBoardThemeOpacity: '0.45', songBoardThemeRadius: '16',
    songBoardBackdropBlur: '24', songBoardGlowIntensity: '3',
    songBoardEnableGradient: 'true', songBoardGradientEnd: '#f0d8e4',
    songBoardFontFamily: 'system-ui, -apple-system, sans-serif',
    songBoardFontWeight: '800', songBoardSongColor: '#be185d',
    songBoardTitle: '可点歌单',
    songBoardSongFontSize: '16', songBoardTitleFontSize: '15',
    scrollSeconds: '80'
  },
  emerald: {
    songBoardThemePrimary: '#34d399', songBoardThemeAccent: '#fbbf24',
    songBoardThemeText: '#f0fdf4', songBoardThemeBackground: '#0a1a10',
    songBoardThemeOpacity: '0.30', songBoardThemeRadius: '12',
    songBoardBackdropBlur: '20', songBoardGlowIntensity: '5',
    songBoardEnableGradient: 'true', songBoardGradientEnd: '#061208',
    songBoardFontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    songBoardFontWeight: '700', songBoardSongColor: '#6ee7b7',
    songBoardTitle: '可点歌单',
    songBoardSongFontSize: '16', songBoardTitleFontSize: '15',
    scrollSeconds: '80'
  },
  rose: {
    songBoardThemePrimary: '#f472b6', songBoardThemeAccent: '#c084fc',
    songBoardThemeText: '#fff1f5', songBoardThemeBackground: '#1a0e14',
    songBoardThemeOpacity: '0.30', songBoardThemeRadius: '14',
    songBoardBackdropBlur: '22', songBoardGlowIntensity: '5',
    songBoardEnableGradient: 'true', songBoardGradientEnd: '#2d1020',
    songBoardFontFamily: 'system-ui, -apple-system, sans-serif',
    songBoardFontWeight: '800', songBoardSongColor: '#f9a8d4',
    songBoardTitle: '可点歌单',
    songBoardSongFontSize: '16', songBoardTitleFontSize: '15',
    scrollSeconds: '80'
  },
};

const songBoardPresetLabels = {
  pure: '🪟 纯透极简',
  sunset: '🌅 暖橘落日', starry: '✨ 星夜幻紫', ocean: '🌊 深海湛蓝',
  sky: '☁️ 晴空浅蓝', mint: '🌿 薄荷浅绿', peach: '🍑 蜜桃奶白',
  emerald: '🌲 翡翠深林', rose: '🌹 丝绒玫瑰'
};

const songBoardPresetSwatches = {
  pure: ['#ffffff', '#555555', '#888888', '#1a1a1a'],
  sunset: ['#2a1508', '#fb923c', '#f472b6', '#fffbf0'],
  starry: ['#0f0a1e', '#c4b5fd', '#67e8f9', '#f5f3ff'],
  ocean: ['#0c1929', '#60a5fa', '#fbbf24', '#f0f9ff'],
  sky: ['#e8f2f8', '#3b82f6', '#f59e0b', '#1a2e3d'],
  mint: ['#e6f2ea', '#10b981', '#f59e0b', '#1a2d20'],
  peach: ['#fce7f0', '#ec4899', '#8b5cf6', '#3d1a2a'],
  emerald: ['#0a1a10', '#34d399', '#fbbf24', '#f0fdf4'],
  rose: ['#1a0e14', '#f472b6', '#c084fc', '#fff1f5']
};

let songLanguages = new Set();
let songArtists = new Set();

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initDesktopShell();
  initForms();
  initOverlayUrls();
  initPerformanceMonitor();
  connectSocket();
  reloadAll();
  renderSongBoardPresetCards();
});

function initTabs() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.tab-page').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      document.getElementById(button.dataset.tab).classList.add('active');
    });
  });
}

function initForms() {
  document.getElementById('manualForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/queue/add', {
      songName: value('manualSong'),
      artist: value('manualArtist'),
      requesterName: value('manualRequester') || '主播',
      source: 'admin'
    });
    setValue('manualSong', '');
    setValue('manualArtist', '');
    toast('已添加到队列');
    await reloadState();
  });

  document.getElementById('nextBtn').addEventListener('click', () => queueAction('next'));
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (confirm('确认清空当前点歌和全部等待队列？')) {
      await queueAction('clear');
    }
  });

  document.getElementById('songForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/songs/save', {
      id: value('songId') || undefined,
      name: value('songName'),
      categoryName: value('songCategory') || '默认',
      artist: value('songArtist'),
      tags: value('songTags'),
      isEnabled: value('songIsEnabled') === 'true',
      language: value('songLanguage'),
      sourcePlatform: value('songSourcePlatform'),
      originalGroup: value('songOriginalGroup'),
      note: value('songNote')
    });
    resetSongForm();
    toast('歌曲已保存');
    await reloadAll();
  });

  document.getElementById('resetSongForm').addEventListener('click', resetSongForm);
  document.getElementById('songSearch').addEventListener('input', debounce(reloadSongs, 180));
  document.getElementById('categoryFilter').addEventListener('change', reloadSongs);
  document.getElementById('languageFilter').addEventListener('change', reloadSongs);
  document.getElementById('artistFilter').addEventListener('change', reloadSongs);
  document.getElementById('enabledFilter').addEventListener('change', reloadSongs);

  document.getElementById('settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/settings', collectSettings());
    toast('设置已保存');
    await reloadState();
  });

  document.getElementById('giftSprintForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/settings', {
      enableGiftSprint: value('enableGiftSprint'),
      giftSprintTargetRmb: value('giftSprintTargetRmb')
    });
    toast('礼物冲刺设置已保存');
    await reloadState();
  });

  document.getElementById('giftSprintResetBtn').addEventListener('click', async () => {
    if (!confirm('确认重置本轮礼物冲刺已收金额？礼物流水会保留，只是不再计入本轮冲刺。')) return;
    await api('/api/gifts/sprint/reset', {});
    toast('本轮礼物冲刺已重置');
    await reloadState();
  });

  document.getElementById('themeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/settings', collectTheme());
    toast('点歌板主题已保存');
    await reloadState();
  });

  document.getElementById('displayForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/settings', collectDisplay());
    toast('展示板已保存');
    await reloadState();
  });

  document.getElementById('classicPresets').addEventListener('click', (event) => {
    const card = event.target.closest('[data-theme]');
    if (!card) return;
    if (value('overlayQueueStyle') !== 'classic') return;
    const preset = classicThemePresets[card.dataset.theme];
    if (!preset) return;
    fillForm(preset);
    syncAllRangeInputs(preset);
    toast(`已套用「${classicPresetLabels[card.dataset.theme]}」主题预设，保存后生效`);
    renderClassicPresetCards();
  });

  document.getElementById('quickBeautifyBtn').addEventListener('click', () => {
    const beautified = {
      backdropBlur: '20',
      glowIntensity: '4',
      overlayLowPowerMode: 'false',
      enableGradient: 'true',
      gradientEnd: value('gradientEnd') || '#2a1a2e',
      themeOpacity: '0.30',
      themeRadius: '14'
    };
    fillForm(beautified);
    syncAllRangeInputs(beautified);
    toast('✨ 一键美化已应用！保存后生效');
  });

  document.querySelectorAll('[data-overlay-style]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextStyle = button.dataset.overlayStyle;
      setOverlayStyle(nextStyle);
      const response = await api('/api/settings', { overlayQueueStyle: nextStyle });
      if (response.data && response.data.settings && response.data.settings.overlayQueueStyle !== nextStyle) {
        toast('请先重启程序，再切换点歌板样式');
        await reloadState();
        return;
      }
      toast('点歌板样式已切换');
      await reloadState();
    });
  });

  document.getElementById('themeOpacity').addEventListener('input', () => {
    setValue('themeOpacityNumber', value('themeOpacity'));
  });
  document.getElementById('themeOpacityNumber').addEventListener('input', () => {
    setValue('themeOpacity', value('themeOpacityNumber'));
  });
  document.getElementById('queueSongFontSize').addEventListener('input', () => {
    setValue('queueSongFontSizeNumber', value('queueSongFontSize'));
  });
  document.getElementById('queueSongFontSizeNumber').addEventListener('input', () => {
    setValue('queueSongFontSize', normalizeRangeValue(value('queueSongFontSizeNumber'), 5, 35, 20));
  });
  document.getElementById('queueTitleFontSize').addEventListener('input', () => {
    setValue('queueTitleFontSizeNumber', value('queueTitleFontSize'));
  });
  document.getElementById('queueTitleFontSizeNumber').addEventListener('input', () => {
    setValue('queueTitleFontSize', normalizeRangeValue(value('queueTitleFontSizeNumber'), 5, 20, 15));
  });
  document.getElementById('overlayRuleFontSize').addEventListener('input', () => {
    setValue('overlayRuleFontSizeNumber', value('overlayRuleFontSize'));
  });
  document.getElementById('overlayRuleFontSizeNumber').addEventListener('input', () => {
    setValue('overlayRuleFontSize', normalizeRangeValue(value('overlayRuleFontSizeNumber'), 8, 18, 10));
  });
  const autosaveTheme = debounce(async () => {
    await api('/api/settings', collectTheme());
  }, 180);
  document.getElementById('overlayFontFamily').addEventListener('change', () => {
    applyAdminQueueFontPreview();
    autosaveTheme();
  });
  document.getElementById('overlayFontWeight').addEventListener('change', () => {
    applyAdminQueueFontPreview();
    autosaveTheme();
  });
  document.getElementById('resetClassicTheme').addEventListener('click', async () => {
    const resetValues = {
      ...defaultThemeLook,
      themeOpacity: '0.35',
      themeRadius: '12',
      backdropBlur: '0'
    };
    fillForm(resetValues);
    syncAllRangeInputs(resetValues);
    await api('/api/settings', resetValues);
    toast('已恢复风格1默认设置');
    await reloadState();
  });

  document.getElementById('backdropBlur').addEventListener('input', () => {
    setValue('backdropBlurNumber', value('backdropBlur'));
  });
  document.getElementById('backdropBlurNumber').addEventListener('input', () => {
    setValue('backdropBlur', normalizeRangeValue(value('backdropBlurNumber'), 0, 30, 0));
  });
  document.getElementById('glowIntensity').addEventListener('input', () => {
    setValue('glowIntensityNumber', value('glowIntensity'));
  });
  document.getElementById('glowIntensityNumber').addEventListener('input', () => {
    setValue('glowIntensity', normalizeRangeValue(value('glowIntensityNumber'), 0, 20, 0));
  });
  document.getElementById('queueScrollSpeedRange').addEventListener('input', () => {
    setValue('queueScrollSpeed', value('queueScrollSpeedRange'));
  });
  document.getElementById('queueScrollSpeed').addEventListener('input', () => {
    setValue('queueScrollSpeedRange', normalizeQueueScrollSpeedForDisplay(value('queueScrollSpeed')));
  });
  const autosaveDisplay = debounce(async () => {
    await api('/api/settings', collectDisplay());
  }, 180);
  document.getElementById('scrollSecondsRange').addEventListener('input', () => {
    setValue('scrollSeconds', value('scrollSecondsRange'));
    autosaveDisplay();
  });
  document.getElementById('scrollSeconds').addEventListener('input', () => {
    setValue('scrollSecondsRange', String(Math.round(Number(normalizeRangeValue(value('scrollSeconds'), 1, 200, 20)))));
    autosaveDisplay();
  });

  // Song board sync toggle
  const songBoardSync = document.getElementById('songBoardSyncTheme');
  const songBoardArea = document.getElementById('songBoardThemeArea');
  songBoardSync.addEventListener('change', () => {
    songBoardArea.hidden = songBoardSync.checked;
    if (!songBoardSync.checked && appState) {
      const s = appState.settings || {};
      setValue('songBoardThemePrimary', s.songBoardThemePrimary || s.themePrimary || '#ff6f91');
      setValue('songBoardThemeAccent', s.songBoardThemeAccent || s.themeAccent || '#21b6a8');
      setValue('songBoardThemeText', s.songBoardThemeText || s.themeText || '#fff7fb');
      setValue('songBoardThemeBackground', s.songBoardThemeBackground || s.themeBackground || '#181823');
      setValue('songBoardThemeOpacity', s.songBoardThemeOpacity || s.themeOpacity || '0.35');
      setValue('songBoardThemeOpacityNumber', s.songBoardThemeOpacity || s.themeOpacity || '0.35');
      setValue('songBoardThemeRadius', s.songBoardThemeRadius || s.themeRadius || '8');
      setValue('songBoardBackdropBlur', s.songBoardBackdropBlur || s.backdropBlur || '0');
      setValue('songBoardBackdropBlurNumber', s.songBoardBackdropBlur || s.backdropBlur || '0');
      setValue('songBoardGlowIntensity', s.songBoardGlowIntensity || s.glowIntensity || '0');
      setValue('songBoardGlowIntensityNumber', s.songBoardGlowIntensity || s.glowIntensity || '0');
      setValue('songBoardEnableGradient', s.songBoardEnableGradient || s.enableGradient || 'false');
      setValue('songBoardGradientEnd', s.songBoardGradientEnd || s.gradientEnd || '#181823');
      setValue('songBoardFontFamily', s.songBoardFontFamily || s.overlayFontFamily || 'Microsoft YaHei');
      setValue('songBoardFontWeight', s.songBoardFontWeight || s.overlayFontWeight || '800');
      setValue('songBoardSongColor', s.songBoardSongColor || s.overlaySongColor || '');
      setValue('songBoardTitle', s.songBoardTitle || s.overlayTitle || '');
      setValue('songBoardSongFontSize', s.songBoardSongFontSize || '16');
      setValue('songBoardSongFontSizeNumber', s.songBoardSongFontSize || '16');
      setValue('songBoardTitleFontSize', s.songBoardTitleFontSize || '15');
      setValue('songBoardTitleFontSizeNumber', s.songBoardTitleFontSize || '15');
    }
  });

  // Song board range ↔ number dual sync
  document.getElementById('songBoardThemeOpacity').addEventListener('input', () => {
    setValue('songBoardThemeOpacityNumber', value('songBoardThemeOpacity'));
  });
  document.getElementById('songBoardThemeOpacityNumber').addEventListener('input', () => {
    setValue('songBoardThemeOpacity', normalizeRangeValue(value('songBoardThemeOpacityNumber'), 0, 1, 0.35));
  });
  document.getElementById('songBoardBackdropBlur').addEventListener('input', () => {
    setValue('songBoardBackdropBlurNumber', value('songBoardBackdropBlur'));
  });
  document.getElementById('songBoardBackdropBlurNumber').addEventListener('input', () => {
    setValue('songBoardBackdropBlur', normalizeRangeValue(value('songBoardBackdropBlurNumber'), 0, 30, 0));
  });
  document.getElementById('songBoardGlowIntensity').addEventListener('input', () => {
    setValue('songBoardGlowIntensityNumber', value('songBoardGlowIntensity'));
  });
  document.getElementById('songBoardGlowIntensityNumber').addEventListener('input', () => {
    setValue('songBoardGlowIntensity', normalizeRangeValue(value('songBoardGlowIntensityNumber'), 0, 20, 0));
  });
  document.getElementById('songBoardSongFontSize').addEventListener('input', () => {
    setValue('songBoardSongFontSizeNumber', value('songBoardSongFontSize'));
  });
  document.getElementById('songBoardSongFontSizeNumber').addEventListener('input', () => {
    setValue('songBoardSongFontSize', normalizeRangeValue(value('songBoardSongFontSizeNumber'), 10, 40, 16));
  });
  document.getElementById('songBoardTitleFontSize').addEventListener('input', () => {
    setValue('songBoardTitleFontSizeNumber', value('songBoardTitleFontSize'));
  });
  document.getElementById('songBoardTitleFontSizeNumber').addEventListener('input', () => {
    setValue('songBoardTitleFontSize', normalizeRangeValue(value('songBoardTitleFontSizeNumber'), 10, 28, 15));
  });

  // Song board presets
  document.getElementById('songBoardPresets').addEventListener('click', (event) => {
    const card = event.target.closest('[data-theme]');
    if (!card) return;
    if (songBoardSync.checked) return;
    const preset = songBoardThemePresets[card.dataset.theme];
    if (!preset) return;
    fillForm(preset);
    songBoardSyncAllRangeInputs(preset);
    renderSongBoardPresetCards();
    toast(`已套用「${songBoardPresetLabels[card.dataset.theme]}」歌单展示板预设，保存后生效`);
  });

  // Song board reset
  document.getElementById('songBoardResetTheme').addEventListener('click', async () => {
    const defaults = {
      songBoardThemePrimary: '#ff6f91', songBoardThemeAccent: '#21b6a8',
      songBoardThemeText: '#fff7fb', songBoardThemeBackground: '#181823',
      songBoardThemeOpacity: '0.35', songBoardThemeRadius: '8',
      songBoardBackdropBlur: '0', songBoardGlowIntensity: '0',
      songBoardEnableGradient: 'false', songBoardGradientEnd: '#181823',
      songBoardFontFamily: 'Microsoft YaHei', songBoardFontWeight: '800',
      songBoardSongColor: '', songBoardTitle: '',
      songBoardSongFontSize: '16', songBoardTitleFontSize: '15'
    };
    fillForm(defaults);
    songBoardSyncAllRangeInputs(defaults);
    toast('歌单展示板主题已恢复默认');
  });

  document.getElementById('importBtn').addEventListener('click', importSongs);
  document.getElementById('clearDatabaseBtn').addEventListener('click', clearDatabase);
  document.getElementById('clearSuperChatsBtn').addEventListener('click', clearSuperChats);
  document.getElementById('clearAllBtn').addEventListener('click', clearAll);
  document.getElementById('shutdownBtn').addEventListener('click', shutdownServer);

  document.getElementById('copyOverlayUrls').addEventListener('click', async () => {
    const text = `${document.getElementById('queueUrl').textContent}\n${document.getElementById('songsUrl').textContent}`;
    await navigator.clipboard.writeText(text);
    toast('overlay 地址已复制');
  });

  document.querySelectorAll('[data-copy-url]').forEach((button) => {
    button.addEventListener('click', async () => {
      const url = document.getElementById(button.dataset.copyUrl).textContent;
      await navigator.clipboard.writeText(url);
      toast('直播画面地址已复制');
    });
  });
}

function initPerformanceMonitor() {
  const toggle = document.getElementById('metricsToggle');
  const button = document.getElementById('metricsRefreshBtn');
  if (!toggle || !button) return;

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      runMetricsSample();
    }
  });
  button.addEventListener('click', runMetricsSample);
}

function initOverlayUrls() {
  document.getElementById('queueUrl').textContent = `${location.origin}/queue`;
  document.getElementById('songsUrl').textContent = `${location.origin}/songlist`;
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);
  const status = document.getElementById('wsStatus');

  ws.addEventListener('open', () => {
    status.textContent = '前端实时连接正常';
    status.className = 'pill good';
  });

  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'snapshot') {
      appState = payload.state;
      renderState();
      scheduleSongReload();
    }
  });

  ws.addEventListener('close', () => {
    if (shuttingDown) {
      status.textContent = '程序已退出';
      status.className = 'pill warn';
      return;
    }
    status.textContent = '前端连接断开，重连中';
    status.className = 'pill warn';
    setTimeout(connectSocket, 1600);
  });
}

async function reloadAll() {
  await reloadState();
  await reloadSongs();
}

async function reloadState() {
  const response = await fetch('/api/state');
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || '读取状态失败');
  appState = payload.data;
  categories = appState.categories || [];
  renderState();
}

async function reloadSongs() {
  const params = new URLSearchParams();
  if (value('songSearch')) params.set('query', value('songSearch'));
  if (value('categoryFilter')) params.set('category', value('categoryFilter'));
  if (value('languageFilter')) params.set('language', value('languageFilter'));
  if (value('artistFilter')) params.set('artist', value('artistFilter'));
  if (value('enabledFilter') === 'true') params.set('enabledOnly', 'true');

  const response = await fetch(`/api/songs?${params}`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || '读取歌库失败');
  songs = payload.data || [];
  await reloadState();
  renderSongs();
}

function scheduleSongReload() {
  clearTimeout(songReloadTimer);
  songReloadTimer = setTimeout(() => reloadSongs().catch(showError), 240);
}

function renderState() {
  if (!appState) return;
  const current = appState.queue.current;
  const waiting = appState.queue.waiting || [];
  const queueItems = [current].concat(waiting).filter(Boolean);
  const settings = appState.settings || {};
  const superChats = Array.isArray(appState.superChats) ? appState.superChats : [];
  const gifts = appState.gifts || {};
  const giftSprint = appState.giftSprint || {};

  document.getElementById('songCount').textContent = `歌库 ${appState.songCount || 0} 首`;
  const totalCount = queueItems.length;
  document.getElementById('queueSize').textContent = `${totalCount} 首`;
  renderSuperChatQueue(superChats);
  renderGiftPanel(gifts, giftSprint);

  const live = appState.liveStatus || {};
  const liveStatus = document.getElementById('liveStatus');
  liveStatus.textContent = live.message || '弹幕监听未启用';
  liveStatus.className = live.connected ? 'pill good' : 'pill warn';

  const list = document.getElementById('queueList');
  applyAdminQueueFontPreview(settings);
  if (queueItems.length === 0) {
    list.innerHTML = '<div class="empty">队列为空</div>';
  } else {
    list.innerHTML = queueItems.map((item, index) => {
      const pinButton = index === 0 && !item.is_pinned
        ? ''
        : `
              <button class="icon" title="${item.is_pinned ? '取消置顶' : '置顶'}" type="button" data-action="${item.is_pinned ? 'unpin' : 'pin'}" data-id="${item.id}">${item.is_pinned ? '↧' : '↑'}</button>`;
      return `
          <div class="queue-row">
            <div>
              <div class="song">${item.is_pinned ? '📌 ' : ''}${index + 1}. ${escapeHtml(item.song_name)}</div>
              <div class="meta">${escapeHtml(requesterLabel(item))} · ${escapeHtml(sourceLabel(item))} · ${formatTime(item.created_at)}</div>
            </div>
            <div class="queue-actions">
              ${pinButton}
              <button class="icon" title="复制歌名" type="button" data-copy="${escapeAttr(item.song_name)}">⧉</button>
              <button class="icon" title="删除" type="button" data-action="delete" data-id="${item.id}">×</button>
            </div>
          </div>
        `;
    }).join('');
  }

  fillForm(settings);
  renderCategoryFilter();

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => queueAction(button.dataset.action, button.dataset.id));
  });
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(button.dataset.copy);
      toast('歌名已复制');
    });
  });
}

function renderSuperChatQueue(items) {
  const list = document.getElementById('superChatList');
  const size = document.getElementById('superChatSize');
  if (!list || !size) return;

  size.textContent = `${items.length} 条`;
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">SC 队列为空</div>';
    return;
  }

  list.innerHTML = items.map((item, index) => `
    <div class="queue-row sc-row ${item.status === 'assisted' ? 'assisted' : ''}">
      <div>
        <div class="song">
          <span class="sc-admin-price">SC ¥${escapeHtml(formatSuperChatPrice(item.price))}</span>
          ${index + 1}. ${escapeHtml(item.message || '醒目留言')}
        </div>
        <div class="meta">${escapeHtml(item.user_name || '观众')} · ${formatTime(item.created_at)}${item.status === 'assisted' ? ' · 已辅助' : ''}</div>
      </div>
      <div class="queue-actions">
        <button class="icon" title="${item.status === 'assisted' ? '取消辅助' : '标记辅助'}" type="button" data-sc-action="${item.status === 'assisted' ? 'unassist' : 'assist'}" data-id="${item.id}">${item.status === 'assisted' ? '↺' : '✓'}</button>
        <button class="icon" title="复制 SC" type="button" data-copy="${escapeAttr(item.message || '')}">⧉</button>
        <button class="icon" title="删除 SC" type="button" data-sc-action="delete" data-id="${item.id}">×</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('[data-sc-action]').forEach((button) => {
    button.addEventListener('click', () => superChatAction(button.dataset.scAction, button.dataset.id));
  });
}

function renderGiftPanel(gifts, sprint) {
  const status = document.getElementById('giftSprintStatus');
  if (!status) return;

  status.textContent = sprint.enabled ? '检测中' : '未开启';
  status.className = sprint.enabled ? 'pill good' : 'pill warn';
  document.getElementById('giftSprintTarget').textContent = formatMoney(sprint.targetRmb);
  document.getElementById('giftSprintReceived').textContent = formatMoney(sprint.receivedRmb);
  document.getElementById('giftSprintRemaining').textContent = formatMoney(sprint.remainingRmb);
  document.getElementById('giftSprintCrystalBalls').textContent = `${Number(sprint.remainingCrystalBalls || 0)} 个`;

  renderGiftRecentList(Array.isArray(gifts.recent) ? gifts.recent : []);
}

function renderGiftRecentList(items) {
  const list = document.getElementById('giftRecentList');
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">暂无礼物记录</div>';
    return;
  }

  list.innerHTML = items.map((item) => {
    const sprintPrice = item.sprint_count_price ?? item.total_price;
    const giftValueText = item.is_blind_box && item.blind_box_price !== null && item.blind_box_price !== undefined
      ? ` · 开出 ${formatMoney(item.total_price)}`
      : '';
    return `
      <div class="queue-row gift-row">
        <div>
          <div class="song">${escapeHtml(item.gift_name || '未知礼物')} x${Number(item.num || 1)}</div>
          <div class="meta">${escapeHtml(item.user_name || '观众')} · 计入 ${formatMoney(sprintPrice)}${giftValueText} · ${formatTime(item.created_at)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function applyAdminQueueFontPreview(settings = {}) {
  const list = document.getElementById('queueList');
  if (!list) return;
  const fontFamily = settings.overlayFontFamily || value('overlayFontFamily') || 'Microsoft YaHei';
  const fontWeight = settings.overlayFontWeight || value('overlayFontWeight') || '700';
  list.style.setProperty('--admin-queue-font-family', withMultilingualFallback(fontFamily));
  list.style.setProperty('--admin-queue-font-weight', fontWeight);
}

function renderCategoryFilter() {
  const select = document.getElementById('categoryFilter');
  const selected = select.value;
  select.innerHTML = '<option value="">全部分类</option>' + categories.map((category) => (
    `<option value="${escapeAttr(category.name)}">${escapeHtml(category.name)}</option>`
  )).join('');
  select.value = selected;
}

function renderLanguageFilter() {
  const select = document.getElementById('languageFilter');
  const selected = select.value;
  const sorted = Array.from(songLanguages).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  select.innerHTML = '<option value="">全部语言</option>' + sorted.map((lang) => (
    `<option value="${escapeAttr(lang)}">${escapeHtml(lang)}</option>`
  )).join('');
  select.value = selected;
}

function renderArtistFilter() {
  const select = document.getElementById('artistFilter');
  const selected = select.value;
  const sorted = Array.from(songArtists).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  select.innerHTML = '<option value="">全部歌手</option>' + sorted.map((artist) => (
    `<option value="${escapeAttr(artist)}">${escapeHtml(artist)}</option>`
  )).join('');
  select.value = selected;
}

function renderSongs() {
  for (const song of songs) {
    if (song.language) songLanguages.add(song.language);
    if (song.artist) songArtists.add(song.artist);
  }
  renderLanguageFilter();
  renderArtistFilter();

  const table = document.getElementById('songsTable');
  if (songs.length === 0) {
    table.innerHTML = '<tr><td colspan="8">暂无歌曲</td></tr>';
    return;
  }
  table.innerHTML = songs.map((song) => `
    <tr>
      <td>${escapeHtml(song.name_initial || '#')}</td>
      <td><strong>${escapeHtml(song.name)}</strong></td>
      <td>${escapeHtml(song.artist || '')}</td>
      <td>${escapeHtml(song.category_name || '默认')}</td>
      <td>${escapeHtml(song.tags || '')}</td>
      <td>${song.is_enabled ? '可点' : '停用'}</td>
      <td>${escapeHtml(song.note || '')}</td>
      <td>
        <div class="actions">
          <button type="button" data-edit-song="${song.id}">编辑</button>
          <button type="button" data-add-song="${song.id}">入队</button>
          <button type="button" data-toggle-song="${song.id}">${song.is_enabled ? '停用' : '启用'}</button>
          <button class="danger" type="button" data-delete-song="${song.id}">删除</button>
        </div>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('[data-edit-song]').forEach((button) => {
    button.addEventListener('click', () => {
      const song = songs.find((item) => String(item.id) === button.dataset.editSong);
      if (!song) return;
      setValue('songId', song.id);
      setValue('songName', song.name);
      setValue('songArtist', song.artist || '');
      setValue('songCategory', song.category_name || '默认');
      setValue('songTags', song.tags || '');
      setValue('songIsEnabled', song.is_enabled ? 'true' : 'false');
      setValue('songLanguage', song.language || '');
      setValue('songSourcePlatform', song.source_platform || '');
      setValue('songOriginalGroup', song.original_group || '');
      setValue('songNote', song.note || '');
      toast('已加载到编辑表单');
    });
  });

  document.querySelectorAll('[data-add-song]').forEach((button) => {
    button.addEventListener('click', async () => {
      const song = songs.find((item) => String(item.id) === button.dataset.addSong);
      if (!song) return;
      await api('/api/queue/add', {
        songName: song.name,
        artist: song.artist,
        categoryName: song.category_name,
        requesterName: '主播',
        source: 'admin'
      });
      toast('已从歌库入队');
      await reloadState();
    });
  });

  document.querySelectorAll('[data-toggle-song]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api('/api/songs/toggle', { id: button.dataset.toggleSong });
      toast('歌曲状态已更新');
      await reloadAll();
    });
  });

  document.querySelectorAll('[data-delete-song]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('确认删除这首歌？')) return;
      await api('/api/songs/delete', { id: button.dataset.deleteSong });
      toast('歌曲已删除');
      await reloadAll();
    });
  });
}

async function queueAction(action, id) {
  console.log('[queueAction]', action, id);
  const result = await api('/api/queue/action', { action, id });
  console.log('[queueAction] result:', result);
  await reloadState();
}

async function superChatAction(action, id) {
  await api('/api/superchats/action', { action, id });
  await reloadState();
}

function collectSettings() {
  return {
    roomId: value('roomId'),
    enableBilibili: value('enableBilibili'),
    paused: value('paused'),
    queueLimit: value('queueLimit'),
    userCooldownSeconds: value('userCooldownSeconds'),
    onlyFromLibrary: value('onlyFromLibrary'),
    allowDuplicate: value('allowDuplicate')
  };
}

function collectTheme() {
  return {
    overlayQueueStyle: value('overlayQueueStyle'),
    overlayPin1: value('overlayPin1'),
    overlayPin2: value('overlayPin2'),
    overlayPin3: value('overlayPin3'),
    overlayRule1: value('overlayRule1'),
    overlayRule2: value('overlayRule2'),
    overlayRule3: value('overlayRule3'),
    overlayRule4: value('overlayRule4'),
    overlayRule5: value('overlayRule5'),
    overlayRule6: value('overlayRule6'),
    overlayRuleColor1: value('overlayRuleColor1'),
    overlayRuleColor2: value('overlayRuleColor2'),
    overlayRuleColor3: value('overlayRuleColor3'),
    overlayRuleColor4: value('overlayRuleColor4'),
    overlayRuleColor5: value('overlayRuleColor5'),
    overlayRuleColor6: value('overlayRuleColor6'),
    overlayRuleFontSize: value('overlayRuleFontSize'),
    themePrimary: value('themePrimary'),
    themeAccent: value('themeAccent'),
    themeText: value('themeText'),
    themeBackground: value('themeBackground'),
    themeOpacity: value('themeOpacity'),
    themeRadius: value('themeRadius'),
    queueSongFontSize: value('queueSongFontSize'),
    queueTitleFontSize: value('queueTitleFontSize'),
    backdropBlur: value('backdropBlur'),
    glowIntensity: value('glowIntensity'),
    overlayLowPowerMode: value('overlayLowPowerMode'),
    enableGradient: value('enableGradient'),
    gradientEnd: value('gradientEnd'),
    overlayFontFamily: value('overlayFontFamily'),
    overlayFontWeight: value('overlayFontWeight'),
    overlaySongColor: value('overlaySongColor'),
    overlayRequesterColor: value('overlayRequesterColor'),
    overlayTitle: value('overlayTitle'),
    overlayShowIndex: value('overlayShowIndex'),
    overlayIndexThreshold: value('overlayIndexThreshold'),
    overlayIndexColor: value('overlayIndexColor'),
    queueFixedSixRows: value('queueFixedSixRows'),
    queueScrollMode: value('queueScrollMode'),
    queueScrollSpeed: normalizeQueueScrollSpeedForDisplay(value('queueScrollSpeed'))
  };
}

function collectDisplay() {
  const sync = document.getElementById('songBoardSyncTheme').checked;
  const body = {
    scrollSeconds: value('scrollSeconds'),
    songBoardSyncTheme: sync ? 'true' : 'false',
    songBoardSortMode: value('songBoardSortMode')
  };
  if (!sync) {
    Object.assign(body, {
      songBoardThemePrimary: value('songBoardThemePrimary'),
      songBoardThemeAccent: value('songBoardThemeAccent'),
      songBoardThemeText: value('songBoardThemeText'),
      songBoardThemeBackground: value('songBoardThemeBackground'),
      songBoardThemeOpacity: value('songBoardThemeOpacity'),
      songBoardThemeRadius: value('songBoardThemeRadius'),
      songBoardBackdropBlur: value('songBoardBackdropBlur'),
      songBoardGlowIntensity: value('songBoardGlowIntensity'),
      songBoardEnableGradient: value('songBoardEnableGradient'),
      songBoardGradientEnd: value('songBoardGradientEnd'),
      songBoardFontFamily: value('songBoardFontFamily'),
      songBoardFontWeight: value('songBoardFontWeight'),
      songBoardSongColor: value('songBoardSongColor'),
      songBoardTitle: value('songBoardTitle'),
      songBoardSongFontSize: value('songBoardSongFontSize'),
      songBoardTitleFontSize: value('songBoardTitleFontSize')
    });
  }
  return body;
}

async function importSongs() {
  let text = value('importText');
  const file = document.getElementById('importFile').files[0];
  if (file) {
    if (/\.xlsx$/i.test(file.name)) {
      const response = await api('/api/songs/import-xlsx', {
        fileName: file.name,
        base64: await readFileAsBase64(file)
      });
      renderImportResult(response.data);
      toast('Excel 导入完成');
      await reloadAll();
      return;
    }
    text = await readTextFile(file);
  }
  if (!text.trim()) {
    toast('没有可导入内容');
    return;
  }

  const rows = parseTable(text);
  const response = await api('/api/songs/import', { rows });
  renderImportResult(response.data);
  toast('导入完成');
  await reloadAll();
}

function renderImportResult(result) {
  document.getElementById('importResult').textContent =
    `总行数 ${result.total}，成功 ${result.inserted}，重复 ${result.duplicate}，失败 ${result.failed}，新增分类 ${result.createdCategories}`;
}

async function runMetricsSample() {
  if (metricsRunning) return;
  metricsRunning = true;
  setMetricsBusy(true);

  try {
    const response = await fetch('/api/system/metrics?windowMs=5000');
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '性能检测失败');
    renderMetrics(payload.data);
    toast('性能检测完成');
  } catch (error) {
    showError(error);
    renderMetricsError(error);
  } finally {
    metricsRunning = false;
    setMetricsBusy(false);
  }
}

function initDesktopShell() {
  const desktop = window.songAssistantDesktop;
  if (!desktop) return;

  document.body.classList.add('desktop-shell');
  document.querySelectorAll('.desktop-only').forEach((node) => {
    node.hidden = false;
  });

  const checkButton = document.getElementById('desktopCheckUpdateBtn');
  const downloadButton = document.getElementById('desktopDownloadUpdateBtn');
  const installButton = document.getElementById('desktopInstallUpdateBtn');
  const dataButton = document.getElementById('desktopOpenDataBtn');
  const logButton = document.getElementById('desktopOpenLogBtn');
  const githubButton = document.getElementById('desktopOpenGithubBtn');

  if (checkButton) {
    checkButton.addEventListener('click', () => {
      renderDesktopUpdateState({
        status: 'checking',
        message: '正在连接 GitHub 检查新版本...',
        canDownload: false,
        canInstall: false,
        progress: null
      });
      runDesktopAction(() => desktop.checkForUpdates());
    });
  }
  if (downloadButton) {
    downloadButton.addEventListener('click', () => runDesktopAction(() => desktop.downloadUpdate()));
  }
  if (installButton) {
    installButton.addEventListener('click', () => {
      if (!confirm('确认重启并更新到新版本？')) return;
      runDesktopAction(() => desktop.installUpdate());
    });
  }
  if (dataButton) {
    dataButton.addEventListener('click', () => runDesktopAction(() => desktop.openDataDir(), false));
  }
  if (logButton) {
    logButton.addEventListener('click', () => runDesktopAction(() => desktop.openLogDir(), false));
  }
  if (githubButton) {
    githubButton.addEventListener('click', () => runDesktopAction(() => desktop.openGithub(), false));
  }

  desktop.onShowUpdatePage(showDesktopUpdatePage);
  desktop.onUpdateState(handleDesktopUpdateState);
  desktop.getInfo()
    .then((info) => {
      const versionNode = document.getElementById('desktopVersionPill');
      if (versionNode) versionNode.textContent = `版本 ${info.version || '--'}`;
      handleDesktopUpdateState(info.updateState);
    })
    .catch(showError);
}

function showDesktopUpdatePage() {
  const button = document.getElementById('desktopUpdateTab');
  const page = document.getElementById('desktopUpdatePage');
  if (!button || !page) return;

  document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.tab-page').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  page.classList.add('active');
}

function handleDesktopUpdateState(state) {
  renderDesktopUpdateState(state);
  maybeShowDesktopUpdateNotice(state);
}

function maybeShowDesktopUpdateNotice(state) {
  if (!state || (state.status !== 'available' && state.status !== 'downloaded')) return;

  const updateVersion = state.updateVersion || state.version || '';
  const noticeKey = updateVersion || state.status;
  if (desktopUpdateNoticeKey === noticeKey) return;

  desktopUpdateNoticeKey = noticeKey;
  showDesktopUpdateNotice(updateVersion, state.status);
}

function showDesktopUpdateNotice(updateVersion, status) {
  const versionText = updateVersion ? ` v${updateVersion}` : '';
  const title = status === 'downloaded'
    ? `更新${versionText}已下载`
    : `发现新版本${versionText}`;
  const body = status === 'downloaded'
    ? '点击前往桌面版更新页面，重启后完成安装。'
    : '点击前往桌面版更新页面处理更新。';

  showStackedToast({
    key: `desktop-update:${updateVersion || status}`,
    title,
    message: body,
    className: 'desktop-update-toast',
    duration: 3000,
    onClick: showDesktopUpdatePage
  });
}

function showDesktopNoUpdateNotice(message) {
  showStackedToast({
    key: 'desktop-update:not-available',
    title: '已经是最新版本',
    message: message || '当前版本不需要更新。',
    className: 'desktop-update-toast desktop-update-toast-good',
    duration: 4200,
    onClick: showDesktopUpdatePage
  });
}

async function runDesktopAction(action, shouldRender = true) {
  try {
    const state = await action();
    if (shouldRender) {
      renderDesktopUpdateState(state);
      if (state && state.status === 'not-available') showDesktopNoUpdateNotice(desktopUpdateStatusText(state));
    }
  } catch (error) {
    if (shouldRender) {
      renderDesktopUpdateState({
        status: 'error',
        message: desktopActionErrorMessage(error),
        canDownload: false,
        canInstall: false,
        progress: null
      });
    } else {
      toast(desktopActionErrorMessage(error));
    }
  }
}

function renderDesktopUpdateState(state) {
  if (!state) return;

  const statusNode = document.getElementById('desktopUpdateStatus');
  const hintNode = document.getElementById('desktopUpdateHint');
  const progressBar = document.getElementById('desktopUpdateProgressBar');
  const checkButton = document.getElementById('desktopCheckUpdateBtn');
  const downloadButton = document.getElementById('desktopDownloadUpdateBtn');
  const installButton = document.getElementById('desktopInstallUpdateBtn');
  const percent = state.progress && Number.isFinite(Number(state.progress.percent))
    ? Math.max(0, Math.min(100, Number(state.progress.percent)))
    : 0;

  if (statusNode) {
    statusNode.textContent = desktopUpdateStatusText(state);
    statusNode.dataset.status = state.status || 'idle';
  }
  if (hintNode) {
    hintNode.textContent = desktopUpdateHintText(state);
  }
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
  if (checkButton) {
    checkButton.disabled = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';
    checkButton.textContent = state.status === 'checking' ? '检查中...' : '检查更新';
  }
  if (downloadButton) {
    downloadButton.disabled = !state.canDownload;
    downloadButton.textContent = state.status === 'downloading' ? '下载中...' : '下载更新';
  }
  if (installButton) {
    installButton.disabled = !state.canInstall;
  }
}

function desktopUpdateHintText(state) {
  if (state.status === 'available') return '新版本来自 GitHub Releases。若 blockmap 可用，会优先下载变化的部分。';
  if (state.status === 'downloaded') return '更新已经就绪，建议在直播结束后重启更新。';
  if (state.status === 'dev-disabled') return '当前是开发模式；打包安装后的 exe 会自动检查 GitHub 更新。';
  if (state.status === 'not-available') return '发布新版本时，需要把安装包、blockmap 和 latest.yml 上传到 GitHub Releases。';
  if (state.status === 'error') return '详细错误已写入本机日志；界面只显示可操作的简短状态。';
  return '桌面版会保留本地数据目录，更新 exe 不会清空歌库。';
}

function desktopUpdateStatusText(state) {
  const fallback = '等待检查更新';
  const message = String((state && state.message) || fallback).replace(/\s+/g, ' ').trim();
  if (message.length <= 120) return message;
  return `${message.slice(0, 120)}...`;
}

function setMetricsBusy(isBusy) {
  const toggle = document.getElementById('metricsToggle');
  const toggleText = document.getElementById('metricsToggleText');
  const button = document.getElementById('metricsRefreshBtn');
  const status = document.getElementById('metricsStatus');

  toggle.checked = isBusy;
  toggle.disabled = isBusy;
  button.disabled = isBusy;
  toggleText.textContent = isBusy ? '检测中' : '开始检测';
  button.textContent = isBusy ? '正在检测' : '检测 5 秒';
  if (isBusy) {
    status.textContent = '正在采样最近 5 秒';
  }
}

function renderMetrics(metrics) {
  const system = metrics.system || {};
  const app = metrics.process || {};
  document.getElementById('metricsStatus').textContent = '最近 5 秒检测完成';
  setMetric('metricSystemCpu', system.cpuPercent, '5 秒平均值');
  setMetric(
    'metricSystemGpu',
    system.gpuAvailable ? system.gpuPercent : null,
    system.gpuAvailable ? '5 秒平均值' : (system.gpuMessage || '不可用')
  );
  setMetric(
    'metricSystemMemory',
    system.memoryPercent,
    `${formatBytes(system.memoryUsedBytes)} / ${formatBytes(system.memoryTotalBytes)}`
  );
  setMetric('metricAppCpu', app.cpuPercent, `服务 PID ${app.pid}`);
  setMetric(
    'metricAppGpu',
    app.gpuAvailable ? app.gpuPercent : null,
    app.gpuAvailable ? `服务 PID ${app.pid}` : (app.gpuMessage || '不可用')
  );
  setMetric(
    'metricAppMemory',
    app.memoryPercent,
    `占用 ${formatBytes(app.memoryRssBytes)}，堆内存 ${formatBytes(app.memoryHeapUsedBytes)}`
  );

  document.getElementById('metricsSampleWindow').textContent = `采样窗口：${Math.round((metrics.windowMs || 0) / 1000)} 秒`;
  document.getElementById('metricsSampleTime').textContent = `检测时间：${formatDateTime(metrics.sampledAt)}`;
  document.getElementById('metricsProcessPid').textContent = `本次服务进程：${app.pid || '--'}，已运行 ${formatDuration(app.uptimeSeconds)}，直播期间保持开启`;
}

function renderMetricsError(error) {
  document.getElementById('metricsStatus').textContent = error.message || '检测失败';
}

function setMetric(id, percent, detail) {
  const valueNode = document.getElementById(id);
  const barNode = document.getElementById(`${id}Bar`);
  const detailNode = document.getElementById(`${id}Detail`);
  const value = Number(percent);
  const available = Number.isFinite(value);

  valueNode.textContent = available ? `${value.toFixed(1)}%` : '不可用';
  barNode.style.width = available ? `${Math.max(0, Math.min(100, value))}%` : '0%';
  detailNode.textContent = detail || '等待检测';
  valueNode.closest('.metric-card').className = `metric-card ${metricLevel(value)}`;
}

function metricLevel(value) {
  if (!Number.isFinite(value)) return 'muted';
  if (value >= 85) return 'danger-level';
  if (value >= 70) return 'warn-level';
  return 'good-level';
}

async function clearDatabase() {
  if (!confirm('确认清空歌库？只会删除歌曲和分类，直播间号、主题颜色和其他设置会保留。')) {
    return;
  }
  await api('/api/database/clear', { confirm: true });
  songs = [];
  toast('歌库已清空');
  await reloadAll();
}

async function clearSuperChats() {
  if (!confirm('确认清空所有 SC（醒目留言）记录？此操作不可撤销。')) {
    return;
  }
  const response = await api('/api/database/clear-superchats', { confirm: true });
  toast(`SC 记录已清空（共 ${response.data.deletedCount} 条）`);
  await reloadState();
}

async function clearAll() {
  if (!confirm('⚠️ 确认清空全部数据？\n\n这将删除：歌库、分类、点歌队列、点歌记录、SC 记录\n保留：直播间号、主题颜色、所有设置\n\n此操作不可撤销！')) {
    return;
  }
  const response = await api('/api/database/clear-all', { confirm: true });
  const d = response.data.deletedCounts;
  toast(`全部数据已清空 — 歌曲 ${d.songs} · 队列 ${d.queue} · 记录 ${d.requests} · SC ${d.sc}（共 ${response.data.totalDeleted} 条），设置已保留`);
  songs = [];
  await reloadAll();
}

async function shutdownServer() {
  if (!confirm('确认退出点歌助手？退出后会关闭本地服务并释放端口。')) {
    return;
  }
  shuttingDown = true;
  await api('/api/system/shutdown', { confirm: true });
  toast('正在退出程序');
  document.getElementById('shutdownBtn').disabled = true;
  document.getElementById('shutdownBtn').textContent = '正在退出';
  document.getElementById('wsStatus').textContent = '正在退出';
  setTimeout(() => {
    document.body.innerHTML = `
      <main class="app-shell">
        <section class="panel">
          <div class="panel-body stack">
            <h1>点歌助手已退出</h1>
            <p>本地服务已关闭，端口已释放。再次使用时双击项目里的 <code>一键启动.bat</code>。</p>
          </div>
        </section>
      </main>
    `;
  }, 700);
}

function parseTable(text) {
  const clean = text.replace(/^\uFEFF/, '').trim();
  const delimiter = clean.includes('\t') ? '\t' : ',';
  const rows = parseDelimited(clean, delimiter);
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim());
  const aliases = {
    name: ['歌曲名字', '歌曲名称', '歌名', '曲名', 'name', 'songName'],
    artist: ['歌手', '演唱者', '原唱', 'artist', 'singer'],
    categoryName: ['歌曲分类', '类别', '分类', '分组', 'category', 'categoryName'],
    note: ['备注', '说明', 'note'],
    tags: ['标签', '歌曲标签', 'tags', 'tag'],
    isEnabled: ['是否可点', '可点', '是否启用', '启用', 'isEnabled', 'enabled'],
    language: ['语言', '语种', 'language'],
    sourcePlatform: ['来源平台', '平台', '来源', 'sourcePlatform', 'source'],
    originalGroup: ['原始分组', '原分组', '原分类', 'originalGroup']
  };
  const hasHeader = Object.values(aliases).flat().some((name) => header.includes(name));
  const bodyRows = hasHeader ? rows.slice(1) : rows;

  const indexes = {
    name: hasHeader ? findHeader(header, aliases.name) : 0,
    artist: hasHeader ? findHeader(header, aliases.artist) : 1,
    categoryName: hasHeader ? findHeader(header, aliases.categoryName) : 2,
    note: hasHeader ? findHeader(header, aliases.note) : 3,
    tags: hasHeader ? findHeader(header, aliases.tags) : 4,
    isEnabled: hasHeader ? findHeader(header, aliases.isEnabled) : 5,
    language: hasHeader ? findHeader(header, aliases.language) : 6,
    sourcePlatform: hasHeader ? findHeader(header, aliases.sourcePlatform) : 7,
    originalGroup: hasHeader ? findHeader(header, aliases.originalGroup) : 8
  };

  return bodyRows.map((row) => ({
    name: readCell(row, indexes.name),
    artist: readCell(row, indexes.artist),
    categoryName: readCell(row, indexes.categoryName) || '默认',
    note: readCell(row, indexes.note),
    tags: readCell(row, indexes.tags),
    isEnabled: parseEnabledCell(readCell(row, indexes.isEnabled)),
    language: readCell(row, indexes.language),
    sourcePlatform: readCell(row, indexes.sourcePlatform),
    originalGroup: readCell(row, indexes.originalGroup)
  })).filter((row) => row.name.trim());
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuote) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuote = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuote = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((item) => item.some(Boolean));
}

function findHeader(header, names) {
  const index = header.findIndex((cell) => names.includes(cell));
  return index >= 0 ? index : -1;
}

function readCell(row, index) {
  return index >= 0 ? (row[index] || '').trim() : '';
}

function parseEnabledCell(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  if (['是', '可点', '启用', 'true', 'yes', 'y', '1'].includes(text)) return true;
  if (['否', '不可点', '停用', 'false', 'no', 'n', '0'].includes(text)) return false;
  return true;
}

async function readTextFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!utf8Text.includes('\uFFFD')) return utf8Text;
  try {
    return new TextDecoder('gb18030', { fatal: false }).decode(bytes);
  } catch (_) {
    return utf8Text;
  }
}

async function readFileAsBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function api(url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '请求失败');
    return payload;
  } catch (error) {
    showError(error);
    throw error;
  }
}

function showError(error) {
  toast(error.message || String(error));
}

function desktopActionErrorMessage(error) {
  const text = String((error && error.message) || error || '');
  if (/\b404\b/.test(text) && /releases\.atom|latest\.yml|github/i.test(text)) {
    return '当前 GitHub Releases 里还没有可用更新包。';
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout/i.test(text)) {
    return '暂时无法连接 GitHub 更新服务，请稍后再试。';
  }
  return '操作失败，详细原因已写入日志。';
}

function resetSongForm() {
  setValue('songId', '');
  setValue('songName', '');
  setValue('songArtist', '');
  setValue('songCategory', '默认');
  setValue('songTags', '');
  setValue('songIsEnabled', 'true');
  setValue('songLanguage', '');
  setValue('songSourcePlatform', '');
  setValue('songOriginalGroup', '');
  setValue('songNote', '');
}

function fillForm(values) {
  for (const [key, inputValue] of Object.entries(values || {})) {
    const element = document.getElementById(key);
    if (element) element.value = inputValue;
  }
  setOverlayStyle(value('overlayQueueStyle') || 'classic');

  // Song board sync toggle
  const syncCheckbox = document.getElementById('songBoardSyncTheme');
  const syncArea = document.getElementById('songBoardThemeArea');
  if (syncCheckbox && syncArea) {
    const synced = (values && values.songBoardSyncTheme) !== 'false';
    syncCheckbox.checked = synced;
    syncArea.hidden = synced;
    if (synced) {
      // Copy main theme values into song board fields for seamless toggle-off
      setValue('songBoardThemePrimary', (values && values.themePrimary) || '#ff6f91');
      setValue('songBoardThemeAccent', (values && values.themeAccent) || '#21b6a8');
      setValue('songBoardThemeText', (values && values.themeText) || '#fff7fb');
      setValue('songBoardThemeBackground', (values && values.themeBackground) || '#181823');
      setValue('songBoardThemeOpacity', (values && values.themeOpacity) || '0.35');
      setValue('songBoardThemeRadius', (values && values.themeRadius) || '8');
      setValue('songBoardBackdropBlur', (values && values.backdropBlur) || '0');
      setValue('songBoardGlowIntensity', (values && values.glowIntensity) || '0');
      setValue('songBoardEnableGradient', (values && values.enableGradient) || 'false');
      setValue('songBoardGradientEnd', (values && values.gradientEnd) || '#181823');
      setValue('songBoardFontFamily', (values && values.overlayFontFamily) || 'Microsoft YaHei');
      setValue('songBoardFontWeight', (values && values.overlayFontWeight) || '800');
      setValue('songBoardSongColor', (values && values.overlaySongColor) || '');
      setValue('songBoardTitle', (values && values.overlayTitle) || '');
    }
  }

  const songFontSize = normalizeFontSize(
    values && values.queueSongFontSize,
    scaleToFontSize(values && values.themeFontScale, 20),
    35
  );
  const titleFontSize = normalizeFontSize(
    values && values.queueTitleFontSize,
    scaleToFontSize(values && values.themeFontScale, 15),
    20
  );
  setValue('queueSongFontSize', songFontSize);
  if (document.getElementById('queueSongFontSizeNumber')) {
    setValue('queueSongFontSizeNumber', songFontSize);
  }
  setValue('queueTitleFontSize', titleFontSize);
  if (document.getElementById('queueTitleFontSizeNumber')) {
    setValue('queueTitleFontSizeNumber', titleFontSize);
  }
  const ruleFontSize = normalizeFontSize(values && values.overlayRuleFontSize, 10, 18);
  if (document.getElementById('overlayRuleFontSize')) {
    setValue('overlayRuleFontSize', ruleFontSize);
  }
  if (document.getElementById('overlayRuleFontSizeNumber')) {
    setValue('overlayRuleFontSizeNumber', ruleFontSize);
  }
  if (document.getElementById('themeOpacityNumber')) {
    setValue('themeOpacityNumber', value('themeOpacity'));
  }
  if (document.getElementById('backdropBlurNumber')) {
    setValue('backdropBlurNumber', value('backdropBlur'));
  }
  if (document.getElementById('glowIntensityNumber')) {
    setValue('glowIntensityNumber', value('glowIntensity'));
  }
  if (document.getElementById('scrollSecondsRange')) {
    setValue('scrollSecondsRange', value('scrollSeconds'));
  }
  if (document.getElementById('queueScrollSpeedRange')) {
    const queueScrollSpeed = normalizeQueueScrollSpeedForDisplay(values && values.queueScrollSpeed);
    setValue('queueScrollSpeed', queueScrollSpeed);
    setValue('queueScrollSpeedRange', queueScrollSpeed);
  }
}

function normalizeRangeValue(input, min, max, fallback) {
  const valueNumber = Number(input);
  const fallbackNumber = Number(fallback);
  const safeValue = Number.isFinite(valueNumber) ? valueNumber : fallbackNumber;
  const clamped = Math.max(min, Math.min(max, safeValue));
  return String(Math.round(clamped * 100) / 100);
}

function normalizeQueueScrollSpeedForDisplay(input) {
  const valueNumber = Number(input);
  if (!Number.isFinite(valueNumber)) return '80';
  if (valueNumber > 100) {
    const actualSpeed = Math.max(50, Math.min(200, valueNumber));
    return String(Math.round(1 + ((actualSpeed - 50) / 150) * 99));
  }
  return String(Math.max(1, Math.min(100, Math.round(valueNumber))));
}

function normalizeFontSize(input, fallback, max = 20) {
  return normalizeRangeValue(input, 5, max, fallback);
}

function scaleToFontSize(scale, baseSize) {
  const normalizedScale = Number(normalizeRangeValue(scale, 0.25, 2, 1));
  return Math.round(normalizedScale * baseSize);
}

function setOverlayStyle(style) {
  const nextStyle = (style === 'identity' || style === 'festival') ? 'identity' : 'classic';
  setValue('overlayQueueStyle', nextStyle);
  document.querySelectorAll('[data-overlay-style]').forEach((button) => {
    button.classList.toggle('active', button.dataset.overlayStyle === nextStyle);
  });
  const classicArea = document.getElementById('classicThemeArea');
  const identityArea = document.getElementById('identityThemeArea');
  if (nextStyle === 'identity') {
    if (classicArea) classicArea.hidden = true;
    if (identityArea) identityArea.hidden = false;
  } else {
    if (classicArea) classicArea.hidden = false;
    if (identityArea) identityArea.hidden = true;
    renderClassicPresetCards();
  }
}

function renderClassicPresetCards() {
  const container = document.getElementById('classicPresets');
  if (!container) return;
  container.innerHTML = Object.entries(classicThemePresets).map(([key, preset]) => {
    const swatches = classicPresetSwatches[key] || ['#181823', '#ccc', '#ccc', '#fff'];
    const label = classicPresetLabels[key] || key;
    return `
      <div class="preset-card" data-theme="${key}">
        <div class="swatch-preview">
          <span style="background:${swatches[0]}"></span>
          <span style="background:${swatches[1]}"></span>
          <span style="background:${swatches[2]}"></span>
          <span style="background:${swatches[3]}"></span>
        </div>
        <strong>${label}</strong>
      </div>
    `;
  }).join('');
}

function renderSongBoardPresetCards() {
  const container = document.getElementById('songBoardPresets');
  if (!container) return;
  container.innerHTML = Object.entries(songBoardThemePresets).map(([key, preset]) => {
    const swatches = songBoardPresetSwatches[key] || ['#181823', '#ccc', '#ccc', '#fff'];
    const label = songBoardPresetLabels[key] || key;
    return `
      <div class="preset-card" data-theme="${key}">
        <div class="swatch-preview">
          <span style="background:${swatches[0]}"></span>
          <span style="background:${swatches[1]}"></span>
          <span style="background:${swatches[2]}"></span>
          <span style="background:${swatches[3]}"></span>
        </div>
        <strong>${label}</strong>
      </div>
    `;
  }).join('');
}

function songBoardSyncAllRangeInputs(values) {
  const v = values || {};
  setValue('songBoardThemeOpacityNumber', v.songBoardThemeOpacity || value('songBoardThemeOpacity'));
  setValue('songBoardBackdropBlurNumber', v.songBoardBackdropBlur || value('songBoardBackdropBlur'));
  setValue('songBoardGlowIntensityNumber', v.songBoardGlowIntensity || value('songBoardGlowIntensity'));
  setValue('songBoardSongFontSizeNumber', v.songBoardSongFontSize || value('songBoardSongFontSize'));
  setValue('songBoardTitleFontSizeNumber', v.songBoardTitleFontSize || value('songBoardTitleFontSize'));
}

function syncAllRangeInputs(values) {
  const v = values || {};
  setValue('backdropBlurNumber', v.backdropBlur || value('backdropBlur'));
  setValue('glowIntensityNumber', v.glowIntensity || value('glowIntensity'));
  setValue('themeOpacityNumber', v.themeOpacity || value('themeOpacity'));
  setValue('queueSongFontSizeNumber', v.queueSongFontSize || value('queueSongFontSize'));
  setValue('queueTitleFontSizeNumber', v.queueTitleFontSize || value('queueTitleFontSize'));
  setValue('overlayRuleFontSizeNumber', v.overlayRuleFontSize || value('overlayRuleFontSize'));
  const queueScrollSpeed = normalizeQueueScrollSpeedForDisplay(v.queueScrollSpeed || value('queueScrollSpeed'));
  setValue('queueScrollSpeed', queueScrollSpeed);
  setValue('queueScrollSpeedRange', queueScrollSpeed);
  setValue('scrollSecondsRange', v.scrollSeconds || value('scrollSeconds'));
}

function value(id) {
  return document.getElementById(id).value.trim();
}

function setValue(id, nextValue) {
  const element = document.getElementById(id);
  if (element) element.value = nextValue ?? '';
}

function withMultilingualFallback(fontFamily) {
  const selected = String(fontFamily || '').trim();
  if (!selected) return multilingualFontFallback;
  return `${selected}, ${multilingualFontFallback}`;
}

function requesterLabel(item) {
  const name = String((item && item.requester_name) || '').trim();
  if (name) return name;
  const uid = String((item && item.requester_uid) || '').trim();
  return uid ? `观众 ${uid}` : '观众';
}

function sourceLabel(itemOrSource) {
  const item = typeof itemOrSource === 'object' && itemOrSource ? itemOrSource : null;
  const source = item ? item.source : itemOrSource;
  if (source === 'random' || String(source || '').startsWith('random:')) {
    const scope = String(source || '').startsWith('random:')
      ? String(source).slice('random:'.length).trim()
      : randomScopeLabel(item && item.request_message);
    return scope ? `随机点歌 · ${scope}` : '随机点歌';
  }
  return {
    admin: '手动',
    danmaku: '弹幕',
    superchat: '醒目留言',
    history: '历史补偿',
  }[source] || source || '未知';
}

function randomScopeLabel(message) {
  const text = String(message || '').trim().replace(/\s+/g, ' ');
  if (!text.startsWith('随机')) return '';
  if (text.startsWith('随机点歌')) {
    return stripRandomScopePrefix(text.slice('随机点歌'.length));
  }
  if (text.startsWith('随机 ')) {
    return stripRandomScopePrefix(text.slice('随机 '.length));
  }
  const scope = stripRandomScopePrefix(text.slice('随机'.length));
  return scope === '点歌' ? '' : scope;
}

function stripRandomScopePrefix(value) {
  let text = String(value || '').trim();
  while (text && '+＋:：-—'.includes(text[0])) {
    text = text.slice(1).trim();
  }
  return text;
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}

function formatDateTime(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '--';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = Math.floor(total % 60);
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  if (minutes > 0) return `${minutes}分钟${rest}秒`;
  return `${rest}秒`;
}

function formatSuperChatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '¥0.00';
  return `¥${number.toFixed(2)}`;
}

function toast(message) {
  showStackedToast({
    key: `toast:${message}`,
    message,
    duration: 2600
  });
}

function showStackedToast(options) {
  const container = document.getElementById('toast');
  if (!container) return;

  const key = options.key || `toast:${options.title || ''}:${options.message || ''}`;
  if (activeToastKeys.has(key)) return;
  activeToastKeys.add(key);

  const node = document.createElement('div');
  node.className = `toast${options.className ? ` ${options.className}` : ''}`;
  if (options.title) {
    node.innerHTML = `<strong>${escapeHtml(options.title)}</strong><span>${escapeHtml(options.message || '')}</span>`;
  } else {
    node.textContent = options.message || '';
  }

  if (typeof options.onClick === 'function') {
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.addEventListener('click', options.onClick);
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      options.onClick();
    });
  }

  container.prepend(node);
  void node.offsetWidth;
  node.classList.add('show');

  const duration = Number.isFinite(Number(options.duration)) ? Number(options.duration) : 2600;
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => {
      activeToastKeys.delete(key);
      node.remove();
    }, 180);
  }, duration);
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
