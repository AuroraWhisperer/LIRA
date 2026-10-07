const number = (label, value, min, max, step, group = 'basic', unit = '%') =>
  ({ label, type: 'number', default: value, min, max, step, group, unit, displayScale: unit === '%' ? 100 : 1 });
const color = (label, value, group) => ({ label, type: 'color', default: value, group });

export const BACKGROUND_GROUPS = Object.freeze({
  basic: '基础', color: '基础调色', whiteBalance: '白平衡', grading: '调色 · Lift / Gamma / Gain', legacyGrading: '旧版分区染色', glow: '辉光',
  iris: '周边模糊', vignette: '暗角', levels: '色阶', grain: '颗粒', playback: '播放',
});

export const BACKGROUND_FIELDS = Object.freeze({
  opacity: number('不透明度', 1, 0, 1, 0.01),
  blur: number('模糊', 0, 0, 30, 1, 'basic', 'px'),
  fit: { label: '填充方式', type: 'select', default: 'cover', options: { cover: '铺满裁切', contain: '完整显示', fill: '拉伸' } },
  brightness: number('亮度', 1, 0, 2, 0.01, 'color'),
  saturation: number('饱和度', 1, 0, 2, 0.01, 'color'),
  contrast: number('对比度', 1, 0, 2, 0.01, 'color'),
  overlayColor: color('遮罩颜色', '#ffffff', 'color'),
  overlayOpacity: number('遮罩强度', 0, 0, 1, 0.01, 'color'),
  colorProcessing: { label: '调色方式', type: 'select', default: 'standard', group: 'whiteBalance', options: { standard: '标准调色', legacy: '旧版调色（兼容）' } },
  temperature: number('色温（负冷正暖）', 0, -100, 100, 1, 'whiteBalance', ''),
  tint: number('色调（负绿正洋红）', 0, -100, 100, 1, 'whiteBalance', ''),
  preserveLuminance: { label: '保持亮度', type: 'checkbox', default: true, group: 'whiteBalance', mode: 'legacy' },
  liftRed: number('Lift · 红', 0, -1, 1, 0.01, 'grading', ''),
  liftGreen: number('Lift · 绿', 0, -1, 1, 0.01, 'grading', ''),
  liftBlue: number('Lift · 蓝', 0, -1, 1, 0.01, 'grading', ''),
  gammaRed: number('Gamma · 红', 1, 0.1, 3, 0.01, 'grading', ''),
  gammaGreen: number('Gamma · 绿', 1, 0.1, 3, 0.01, 'grading', ''),
  gammaBlue: number('Gamma · 蓝', 1, 0.1, 3, 0.01, 'grading', ''),
  gainRed: number('Gain · 红', 1, 0, 3, 0.01, 'grading', ''),
  gainGreen: number('Gain · 绿', 1, 0, 3, 0.01, 'grading', ''),
  gainBlue: number('Gain · 蓝', 1, 0, 3, 0.01, 'grading', ''),
  shadowColor: color('暗部颜色', '#ffffff', 'legacyGrading'),
  shadowStrength: number('暗部强度', 0, 0, 1, 0.01, 'legacyGrading'),
  midtoneColor: color('中间调颜色', '#ffffff', 'legacyGrading'),
  midtoneStrength: number('中间调强度', 0, 0, 1, 0.01, 'legacyGrading'),
  highlightColor: color('亮部颜色', '#ffffff', 'legacyGrading'),
  highlightStrength: number('亮部强度', 0, 0, 1, 0.01, 'legacyGrading'),
  glowMode: { label: '辉光形状', type: 'select', default: 'normal', group: 'glow', options: { normal: '柔光', streak: '横向光条', star: '十字星芒' } },
  glowStrength: number('辉光强度', 0, 0, 2, 0.01, 'glow'),
  glowRadius: number('辉光半径', 12, 0, 60, 1, 'glow', 'px'),
  glowThreshold: number('亮部阈值', 0.7, 0, 1, 0.01, 'glow'),
  glowSoftness: number('阈值柔和度', 0.2, 0, 1, 0.01, 'glow'),
  irisBlur: number('周边模糊', 0, 0, 30, 1, 'iris', 'px'),
  irisRange: number('清晰区域', 0.45, 0, 1, 0.01, 'iris'),
  irisSoftness: number('模糊过渡', 0.3, 0, 1, 0.01, 'iris'),
  irisCenterX: number('中心 X', 0.5, 0, 1, 0.01, 'iris'),
  irisCenterY: number('中心 Y', 0.5, 0, 1, 0.01, 'iris'),
  vignetteColor: color('暗角颜色', '#000000', 'vignette'),
  vignetteOpacity: number('暗角强度', 0, 0, 1, 0.01, 'vignette'),
  vignetteRange: number('中心区域', 0.55, 0, 1, 0.01, 'vignette'),
  vignetteSoftness: number('暗角过渡', 0.45, 0, 1, 0.01, 'vignette'),
  vignetteRoundness: number('圆度', 0, 0, 1, 0.01, 'vignette'),
  vignetteCenterX: number('中心 X', 0.5, 0, 1, 0.01, 'vignette'),
  vignetteCenterY: number('中心 Y', 0.5, 0, 1, 0.01, 'vignette'),
  levelsChannel: { label: '色阶通道', type: 'select', default: 'rgb', group: 'levels', options: { rgb: 'RGB', r: '红', g: '绿', b: '蓝' } },
  inputBlack: number('输入黑场', 0, 0, 254, 1, 'levels', ''),
  inputWhite: number('输入白场', 255, 1, 255, 1, 'levels', ''),
  gamma: number('伽马', 1, 0.1, 3, 0.01, 'levels', ''),
  outputBlack: number('输出黑场', 0, 0, 254, 1, 'levels', ''),
  outputWhite: number('输出白场', 255, 1, 255, 1, 'levels', ''),
  grainStrength: number('颗粒强度', 0, 0, 1, 0.01, 'grain'),
  grainSize: number('颗粒大小', 1, 1, 8, 0.5, 'grain', 'px'),
  playbackRate: number('播放速度', 1, 0.5, 2, 0.05, 'playback', '倍'),
  volume: number('音量', 0, 0, 1, 0.01, 'playback'),
});

export function getBackgroundAppearance(config = {}) {
  const values = Object.fromEntries(Object.entries(BACKGROUND_FIELDS).map(([key, field]) => [key, config[key] ?? field.default]));
  // Non-neutral appearances authored before standard grading keep their pixels.
  values.colorProcessing = config.colorProcessing ?? (['temperature', 'tint', 'shadowStrength', 'midtoneStrength', 'highlightStrength']
    .some(key => Number(config[key] ?? 0) !== 0) ? 'legacy' : 'standard');
  // Older custom backgrounds stretched their media and stored volume inside mediaStyle.
  if (config.mediaStyle) {
    values.fit = config.fit ?? 'fill';
    values.volume = config.volume ?? config.mediaStyle.volume ?? 0;
  }
  return values;
}

export function isVideoBackground(config) {
  return config.mediaStyle ? config.mediaStyle.kind === 'video' : config.style === 'moonlit-animated';
}
