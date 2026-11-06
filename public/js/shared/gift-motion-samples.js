import { GIFT_MOTION_EFFECTS, readGiftMotionSettings } from './gift-motion-settings.js';

const gifts = [['小花花', 'flower'], ['牛哇牛哇', 'cheer'], ['打call', 'call']];

export function createGiftMotionSamples(style, settings = {}) {
  const effect = GIFT_MOTION_EFFECTS.find(effect => effect.style === style);
  return gifts.map(([giftName, image], index) => ({
    type: 'gift:frame', themeId: style, eventId: `motion-preview-${style}-${index}`,
    userName: ['观众A', '观众B', '观众C'][index], giftName,
    num: style === 'gift-drop' ? 8 : index + 1, totalPriceCents: 100,
    artworkPath: `/img/overlays/gift-feed/${image}.webp`,
    motion: readGiftMotionSettings(settings, effect), preview: true,
  }));
}
