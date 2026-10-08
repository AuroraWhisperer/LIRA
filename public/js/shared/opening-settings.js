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
