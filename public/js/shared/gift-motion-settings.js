// 两款全屏礼物的本机配置；结算与金额判断由礼物领域负责。
export const GIFT_MOTION_EFFECTS = Object.freeze([
  { style: 'gift-drop', prefix: 'giftDrop', label: '礼物掉落', fields: {
    Size: { label: '礼物大小', unit: 'px', default: 96, min: 32, max: 240 },
    DurationSeconds: { label: '停留时长', unit: '秒', default: 20, min: 3, max: 120 },
    Speed: { label: '掉落速度', unit: '%', default: 100, min: 50, max: 200 },
    Bounce: { label: '弹跳力度', unit: '%', default: 18, min: 0, max: 80 },
  } },
  { style: 'gift-swing', prefix: 'giftSwing', label: '礼物摇摇乐', fields: {
    Size: { label: '立牌大小', unit: 'px', default: 150, min: 64, max: 280 },
    DurationSeconds: { label: '停留时长', unit: '秒', default: 20, min: 3, max: 120 },
    Speed: { label: '摇摆速度', unit: '%', default: 100, min: 50, max: 200 },
    Angle: { label: '摆动幅度', unit: '度', default: 24, min: 5, max: 45 },
    TextMode: { label: '文字显示', default: 'full', options: [
      ['full', '昵称、礼物和数量'], ['gift', '礼物和数量'], ['none', '仅礼物图片'],
    ] },
  } },
]);

export const GIFT_MOTION_DEFAULTS = Object.freeze(Object.fromEntries(GIFT_MOTION_EFFECTS.flatMap(effect => [
  [`${effect.prefix}Enabled`, 'false'], [`${effect.prefix}ThresholdRmb`, '0'],
  ...Object.entries(effect.fields).map(([name, field]) => [`${effect.prefix}${name}`, String(field.default)]),
])));

export function readGiftMotionSettings(settings, effect) {
  const result = {};
  for (const [name, field] of Object.entries(effect.fields)) {
    const key = name[0].toLowerCase() + name.slice(1);
    if (field.options) {
      const value = settings[`${effect.prefix}${name}`];
      result[key] = field.options.some(([option]) => option === value) ? value : field.default;
      continue;
    }
    const value = Number(settings[`${effect.prefix}${name}`] ?? field.default);
    result[key] = Number.isFinite(value)
      ? Math.min(field.max, Math.max(field.min, value)) : field.default;
  }
  return result;
}
