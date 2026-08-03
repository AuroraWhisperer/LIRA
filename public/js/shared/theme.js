// 编写人：Aurora
// 主题加载和应用逻辑
'use strict';

let themeConfig = null;
const cachedDefaultTheme = {};
const cachedClassicPresets = {};
const cachedSongBoardPresets = {};
const cachedClassicLabels = {};
const cachedClassicSwatches = {};
const cachedSongBoardLabels = {};
const cachedSongBoardSwatches = {};

// 从 JSON 文件加载主题配置
export async function loadThemeConfig() {
  if (themeConfig) return themeConfig;

  try {
    const response = await fetch('/data/theme-presets.json');
    if (!response.ok) {
      throw new Error(`Failed to load theme config: ${response.status}`);
    }
    themeConfig = await response.json();
    Object.assign(cachedDefaultTheme, themeConfig.default || {});
    Object.assign(cachedClassicPresets, themeConfig.presets?.classic || {});
    Object.assign(cachedSongBoardPresets, themeConfig.presets?.songBoard || {});
    Object.assign(cachedClassicLabels, themeConfig.presets?.classicLabels || {});
    Object.assign(cachedClassicSwatches, themeConfig.presets?.classicSwatches || {});
    Object.assign(cachedSongBoardLabels, themeConfig.presets?.songBoardLabels || {});
    Object.assign(cachedSongBoardSwatches, themeConfig.presets?.songBoardSwatches || {});
    return themeConfig;
  } catch (error) {
    console.error('Error loading theme configuration:', error);
    return null;
  }
}

// 获取默认主题
export function getDefaultTheme() {
  return cachedDefaultTheme;
}

// 获取经典主题预设
export function getClassicPreset(presetName) {
  return themeConfig?.presets?.classic?.[presetName] || null;
}

// 获取歌单主题预设
export function getSongBoardPreset(presetName) {
  return themeConfig?.presets?.songBoard?.[presetName] || null;
}

// 获取所有经典主题预设
export function getAllClassicPresets() {
  return cachedClassicPresets;
}

// 获取所有歌单主题预设
export function getAllSongBoardPresets() {
  return cachedSongBoardPresets;
}

// 获取经典主题标签
export function getClassicLabels() {
  return cachedClassicLabels;
}

// 获取经典主题色板
export function getClassicSwatches() {
  return cachedClassicSwatches;
}

// 获取歌单主题标签
export function getSongBoardLabels() {
  return cachedSongBoardLabels;
}

// 获取歌单主题色板
export function getSongBoardSwatches() {
  return cachedSongBoardSwatches;
}

// 聚合导出
export const theme = {
  loadThemeConfig,
  getDefaultTheme,
  getClassicPreset,
  getSongBoardPreset,
  getAllClassicPresets,
  getAllSongBoardPresets,
  getClassicLabels,
  getClassicSwatches,
  getSongBoardLabels,
  getSongBoardSwatches,
  // 保持向后兼容的属性访问器
  get defaultThemeLook() {
    return getDefaultTheme();
  },
  get classicThemePresets() {
    return getAllClassicPresets();
  },
  get classicPresetLabels() {
    return getClassicLabels();
  },
  get classicPresetSwatches() {
    return getClassicSwatches();
  },
  get songBoardThemePresets() {
    return getAllSongBoardPresets();
  },
  get songBoardPresetLabels() {
    return getSongBoardLabels();
  },
  get songBoardPresetSwatches() {
    return getSongBoardSwatches();
  }
};

// 【过渡期兼容层】- 保持window.AdminApp.theme可用
// 阶段5时删除
if (typeof window !== 'undefined') {
  window.AdminApp = window.AdminApp || {};
  const existingTheme = window.AdminApp.theme || {};
  Object.defineProperties(existingTheme, Object.getOwnPropertyDescriptors(theme));
  window.AdminApp.theme = existingTheme;
}
