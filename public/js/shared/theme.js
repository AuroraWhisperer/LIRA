// 编写人：Aurora
// 主题加载和应用逻辑
'use strict';

let themeConfig = null;

// 从 JSON 文件加载主题配置
export async function loadThemeConfig() {
  if (themeConfig) return themeConfig;

  try {
    const response = await fetch('/data/theme-presets.json');
    if (!response.ok) {
      throw new Error(`Failed to load theme config: ${response.status}`);
    }
    themeConfig = await response.json();
    return themeConfig;
  } catch (error) {
    console.error('Error loading theme configuration:', error);
    return null;
  }
}

// 获取默认主题
export function getDefaultTheme() {
  return themeConfig?.default || {};
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
  return themeConfig?.presets?.classic || {};
}

// 获取所有歌单主题预设
export function getAllSongBoardPresets() {
  return themeConfig?.presets?.songBoard || {};
}

// 获取经典主题标签
export function getClassicLabels() {
  return themeConfig?.presets?.classicLabels || {};
}

// 获取经典主题色板
export function getClassicSwatches() {
  return themeConfig?.presets?.classicSwatches || {};
}

// 获取歌单主题标签
export function getSongBoardLabels() {
  return themeConfig?.presets?.songBoardLabels || {};
}

// 获取歌单主题色板
export function getSongBoardSwatches() {
  return themeConfig?.presets?.songBoardSwatches || {};
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
