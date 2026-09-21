// Queue overlay stateless formatting and timing helpers.
'use strict';

import {
  escapeHtml, hexToRgb, hexToRgba, withMultilingualFallback,
  scrollTravelSeconds, overlayLowPowerEnabled,
} from './overlay-utils-module.js';

export {
  escapeHtml, hexToRgb, hexToRgba, withMultilingualFallback,
  scrollTravelSeconds, overlayLowPowerEnabled,
};

export function queueScrollSeconds(settings, settingKey = 'queueScrollSpeed') {
  const urlSpeed = new URLSearchParams(location.search).get('speed');
  const settingSpeed =
    settings?.[settingKey] || settings?.queueScrollSpeed || 80;
  const speed = Math.round(Number(urlSpeed || settingSpeed));
  const displaySpeed = normalizeQueueScrollSpeed(speed);
  const actualSpeed = 50 + ((displaySpeed - 1) / 99) * 150;
  const seconds = Number((50 - ((actualSpeed - 50) / 150) * 49).toFixed(2));
  return seconds;
}

export function normalizeQueueScrollSpeed(speed) {
  if (!Number.isFinite(speed)) return 80;
  if (speed > 100) {
    return Math.round(
      1 + ((Math.max(50, Math.min(200, speed)) - 50) / 150) * 99,
    );
  }
  return Math.max(1, Math.min(100, speed));
}

export function bounceScrollTiming(downSeconds, upSeconds = 3) {
  const pauseSeconds = 1.5;
  const totalSeconds = pauseSeconds + downSeconds + pauseSeconds + upSeconds;
  return {
    totalSeconds,
    topPauseEndPercent: (pauseSeconds / totalSeconds) * 100,
    downPercent: ((pauseSeconds + downSeconds) / totalSeconds) * 100,
    pauseEndPercent:
      ((pauseSeconds + downSeconds + pauseSeconds) / totalSeconds) * 100,
  };
}

export function normalizeGuardLevel(value) {
  const level = Number(value);
  return [1, 2, 3].includes(level) ? level : 0;
}

export function normalizeFontSize(value, fallback, max = 20, min = 5) {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  const safeValue = Number.isFinite(number) ? number : fallbackNumber;
  return Math.max(min, Math.min(max, Math.round(safeValue)));
}

export function queueSongFontSize(settings) {
  return normalizeFontSize(
    (settings || {}).queueSongFontSize,
    scaleToFontSize((settings || {}).themeFontScale, 28),
    70,
    10,
  );
}

export function identityQueueFontSize(settings) {
  return normalizeFontSize((settings || {}).identityQueueFontSize, 28, 78, 9);
}

export function scaleToFontSize(scale, baseSize) {
  const number = Number(scale);
  const safeScale = Number.isFinite(number) ? number : 1;
  return Math.round(safeScale * baseSize);
}

export function guardLabel(level) {
  return (
    {
      1: '总督',
      2: '提督',
      3: '舰长',
    }[level] || '观众'
  );
}

export function requesterIdentityLabel(guardLevel, medalName) {
  const guard = guardLabel(guardLevel);
  if (guard !== '观众') return guard;
  return String(medalName || '').trim();
}

export function requesterIdentityClass(guardLevel, medalLevel) {
  if (guardLevel === 3) return 'identity-captain';
  if (guardLevel === 2) return 'identity-admiral';
  if (guardLevel === 1) return 'identity-governor';
  return Number(medalLevel || 0) > 0 ? 'identity-fan' : 'identity-none';
}

export function medalLevelClass(level) {
  const value = Number(level || 0);
  if (value >= 51) return 'red';
  if (value >= 41) return 'purple';
  if (value >= 31) return 'deep-blue';
  if (value >= 21) return 'light-blue';
  if (value >= 1) return 'blue-purple';
  return 'none';
}

export function formatSuperChatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function superChatPriceClass(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 1000) return 'identity-sc-price-red';
  if (Number.isFinite(number) && number >= 100)
    return 'identity-sc-price-yellow';
  return 'identity-sc-price-blue';
}
