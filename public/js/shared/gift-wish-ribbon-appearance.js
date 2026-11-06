export const GIFT_WISH_RIBBON_FIELDS = Object.freeze({
  ribbonColor: { label: '彩带颜色', type: 'color', default: '#ee87ac' },
  ribbonTrackColor: { label: '未完成底色', type: 'color', default: '#fee6fb' },
  ribbonBorderColor: { label: '边框颜色', type: 'color', default: '#ffffff' },
  ribbonTextColor: { label: '文字颜色', type: 'color', default: '#ffffff' },
  ribbonOutlineColor: { label: '文字描边颜色', type: 'color', default: '#4b494b' },
  ribbonHeight: { label: '彩带条高', type: 'number', default: 68, min: 40, max: 120, step: 1 },
  ribbonBorderWidth: { label: '边框粗细', type: 'number', default: 8, min: 0, max: 12, step: 1 },
  ribbonRadius: { label: '边框圆角', type: 'number', default: 10, min: 0, max: 36, step: 1 },
  ribbonFontSize: { label: '名称字号', type: 'number', default: 26, min: 12, max: 48, step: 1 },
  ribbonNumberFontSize: { label: '数字字号（留空跟随名称）', type: 'number', default: '', optional: true, min: 12, max: 48, step: 1 },
  ribbonStripeWidth: { label: '条纹粗细', type: 'number', default: 10, min: 4, max: 24, step: 1 },
  ribbonFlowDirection: { label: '流动方向', type: 'select', default: 'normal', options: { normal: '向右', reverse: '向左' } },
  ribbonSpeed: { label: '彩带流动周期（秒，0 为静止）', type: 'number', default: 2, min: 0, max: 20, step: 0.5 },
  ribbonDecorationStyle: { label: '右下角装饰', type: 'select', default: 'pastry',
    options: { none: '无', pastry: '原奶油条', bow: '蝴蝶结', sakura: '樱花', candy: '爱心糖', star: '流星' } },
  ribbonDecorations: { label: '显示边角装饰', type: 'checkbox', default: true },
});

export function getRibbonDecorationStyle(config) {
  return config.ribbonDecorations === false ? 'none' : config.ribbonDecorationStyle ?? 'pastry';
}
