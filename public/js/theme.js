// 编写人：Aurora
// 主题预设数据。挂载到 window.AdminApp.theme
'use strict';

(function () {
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

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.theme = {
    defaultThemeLook,
    classicThemePresets,
    classicPresetLabels,
    classicPresetSwatches,
    songBoardThemePresets,
    songBoardPresetLabels,
    songBoardPresetSwatches
  };
})();
