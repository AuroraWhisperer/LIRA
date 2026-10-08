import { OPENING_APPEARANCE_FIELDS } from './opening-appearance.js';

export const OPENING_STYLE_SETTING_KEYS = Object.freeze({
  classic: Object.freeze({ title: 'openingTitle', subtitle: 'openingSubtitle', name: 'openingName', footer: 'openingFooter',
    quality: 'openingQuality', trackMotion: 'openingTrackMotion', showNotes: 'openingShowNotes', showEq: 'openingShowEq', volume: 'openingAudioVolume' }),
  'pixel-cassette': Object.freeze({ quality: 'openingPixelQuality', showNotes: 'openingPixelShowNotes',
    showEq: 'openingPixelShowEq', volume: 'openingPixelAudioVolume' }),
});

export function openingStyleSettingsPatch(style, patch) {
  const keys = Object.hasOwn(OPENING_STYLE_SETTING_KEYS, style) && OPENING_STYLE_SETTING_KEYS[style];
  if (!keys || !patch || typeof patch !== 'object' || Array.isArray(patch)
    || Object.keys(patch).some(key => !Object.hasOwn(keys, key))) throw new Error('不支持的开播样式或参数。');
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [keys[key], value]));
}

// 开播配置默认值的唯一来源：客户端表单回填与浏览器源渲染共用，
// 文案/画质等字段直接取外观定义，避免两处字面量各自漂移。
export const OPENING_DEFAULTS = Object.freeze({
  enabled: false,
  style: 'classic',
  ...Object.fromEntries(Object.entries(OPENING_APPEARANCE_FIELDS).map(([key, field]) => [key, field.default])),
  audio: 'browser',
  volume: 0.35,
  audioUrl: '',
  audioName: '',
  characterUrl: '',
  pixelCharacterUrl: '',
  debug: false,
});
