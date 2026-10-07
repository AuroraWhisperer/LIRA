export const GUARD_THANKS_EFFECTS = Object.freeze([
  { style: 'aurora', label: '辉光', prefix: 'guardThanksAurora' },
  { style: 'classic', label: '经典', prefix: 'guardThanksClassic' },
]);

// 空值表示尚未独立保存：沿用旧风格的开关和文字，不额外开启另一套动画。
export function readGuardThanksEffect(settings, effect) {
  const enabled = settings[`${effect.prefix}Enabled`];
  return {
    enabled: enabled === 'true' || enabled === 'false' ? enabled === 'true'
      : settings.guardThanksEnabled === 'true' && (settings.guardThanksStyle || 'aurora') === effect.style,
    textMode: settings[`${effect.prefix}TextMode`] || settings.guardThanksTextMode || 'bilingual',
  };
}
