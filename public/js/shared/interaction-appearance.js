import { inspectInteractionText } from './interaction-rules.js';

export const INTERACTION_APPEARANCE_DEFAULTS = Object.freeze({
  interactionOverlayTitle: '',
  interactionOverlayHint: '',
  interactionRatingRules: '发弹幕评分：1–10 分\n只发整数，不带其他内容\n多次评分，以最后一次为准',
  interactionTextColor: '#172b3a',
  interactionBackgroundColor: '#ffffff',
  interactionBackgroundOpacity: '100',
  interactionOverallOpacity: '100',
  interactionBarColor: '#bee9e2',
  interactionTrackColor: '#f0f3f6',
  interactionFontSize: '20',
  interactionCornerRadius: '20',
  interactionShowStatus: 'true',
  interactionShowParticipants: 'true',
});

const NUMBER_RANGES = {
  interactionBackgroundOpacity: [0, 100],
  interactionOverallOpacity: [0, 100],
  interactionFontSize: [16, 24],
  interactionCornerRadius: [0, 32],
};

export function normalizeInteractionAppearanceValue(key, value) {
  if (!Object.hasOwn(INTERACTION_APPEARANCE_DEFAULTS, key)) return null;
  if (key === 'interactionRatingRules') {
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').normalize('NFC') : null;
  }
  if (key === 'interactionOverlayTitle' || key === 'interactionOverlayHint') {
    if (typeof value !== 'string') return null;
    const result = inspectInteractionText(value, key === 'interactionOverlayTitle' ? 60 : 80);
    return !result.text || !result.error ? result.text : null;
  }
  if (key === 'interactionShowStatus' || key === 'interactionShowParticipants') {
    return [true, false, 'true', 'false'].includes(value) ? String(value) : null;
  }
  if (Object.hasOwn(NUMBER_RANGES, key)) {
    if (!['string', 'number'].includes(typeof value) || !/^\d{1,3}$/.test(String(value))) return null;
    const number = Number(value);
    const [min, max] = NUMBER_RANGES[key];
    return number >= min && number <= max ? String(number) : null;
  }
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

export function readInteractionAppearance(settings = {}) {
  return Object.fromEntries(Object.entries(INTERACTION_APPEARANCE_DEFAULTS).map(([key, fallback]) => [
    key, normalizeInteractionAppearanceValue(key, settings[key]) ?? fallback,
  ]));
}

export function applyInteractionAppearance(element, settings) {
  const appearance = readInteractionAppearance(settings);
  element.style.setProperty('--interaction-text', appearance.interactionTextColor);
  element.style.setProperty('--interaction-background', appearance.interactionBackgroundColor);
  element.style.setProperty('--interaction-opacity', `${appearance.interactionBackgroundOpacity}%`);
  element.style.setProperty('--interaction-overall-opacity', String(Number(appearance.interactionOverallOpacity) / 100));
  element.style.setProperty('--interaction-bar', appearance.interactionBarColor);
  element.style.setProperty('--interaction-track', appearance.interactionTrackColor);
  element.style.setProperty('--interaction-font-size', `${appearance.interactionFontSize}px`);
  element.style.setProperty('--interaction-radius', `${appearance.interactionCornerRadius}px`);
  return appearance;
}
