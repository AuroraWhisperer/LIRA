// Queue overlay stateless formatting and timing helpers.
'use strict';

const multilingualFontFallback = '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';

export function hexToRgb(hex) {
  const normalized = String(hex || '#181823').replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const number = Number.parseInt(value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255
  };
}

export function queueScrollSeconds(settings, settingKey = 'queueScrollSpeed') {
  const urlSpeed = new URLSearchParams(location.search).get('speed');
  const settingSpeed = settings?.[settingKey] || settings?.queueScrollSpeed || 80;
  const speed = Math.round(Number(urlSpeed || settingSpeed));
  const displaySpeed = normalizeQueueScrollSpeed(speed);
  const actualSpeed = 50 + ((displaySpeed - 1) / 99) * 150;
  const seconds = Number((50 - ((actualSpeed - 50) / 150) * 49).toFixed(2));
  return seconds;
}

export function normalizeQueueScrollSpeed(speed) {
  if (!Number.isFinite(speed)) return 80;
  if (speed > 100) {
    return Math.round(1 + ((Math.max(50, Math.min(200, speed)) - 50) / 150) * 99);
  }
  return Math.max(1, Math.min(100, speed));
}

export function overlayLowPowerEnabled(settings) {
  const quality = new URLSearchParams(location.search).get('quality');
  if (quality === 'pretty' || quality === 'smooth') return false;
  if (quality === 'low') return true;
  return (settings.overlayLowPowerMode || 'false') === 'true';
}

export function scrollTravelSeconds(secondsPerViewport, distance, viewportDistance) {
  const safeSeconds = Math.max(0.01, Number(secondsPerViewport) || 0.01);
  const safeDistance = Math.max(0, Number(distance) || 0);
  const safeViewportDistance = Math.max(1, Number(viewportDistance) || 1);
  return Number(Math.max(0.05, (safeSeconds * safeDistance) / safeViewportDistance).toFixed(3));
}

export function bounceScrollTiming(downSeconds, upSeconds = 3) {
  const pauseSeconds = 1.5;
  const totalSeconds = pauseSeconds + downSeconds + pauseSeconds + upSeconds;
  return {
    totalSeconds,
    topPauseEndPercent: (pauseSeconds / totalSeconds) * 100,
    downPercent: ((pauseSeconds + downSeconds) / totalSeconds) * 100,
    pauseEndPercent: ((pauseSeconds + downSeconds + pauseSeconds) / totalSeconds) * 100
  };
}

export function hexToRgba(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  const alpha = Number(opacity);
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.76;
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
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
    scaleToFontSize((settings || {}).themeFontScale, 40),
    70,
    10
  );
}

export function identityQueueFontSize(settings) {
  return normalizeFontSize((settings || {}).identityQueueFontSize, 26, 78, 9);
}

export function scaleToFontSize(scale, baseSize) {
  const number = Number(scale);
  const safeScale = Number.isFinite(number) ? number : 1;
  return Math.round(safeScale * baseSize);
}

export function guardLabel(level) {
  return {
    1: '总督',
    2: '提督',
    3: '舰长'
  }[level] || '观众';
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
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function superChatPriceClass(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 1000) return 'identity-sc-price-red';
  if (Number.isFinite(number) && number >= 100) return 'identity-sc-price-yellow';
  return 'identity-sc-price-blue';
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function withMultilingualFallback(fontFamily) {
  const selected = String(fontFamily || '').trim();
  if (!selected) return multilingualFontFallback;
  return `${selected}, ${multilingualFontFallback}`;
}
