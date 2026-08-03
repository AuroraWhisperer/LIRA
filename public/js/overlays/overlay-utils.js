(function () {
  'use strict';

const multilingualFontFallback = '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';

function hexToRgb(hex) {
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

function hexToRgba(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  const alpha = Number(opacity);
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.76;
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + safeAlpha + ')';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function withMultilingualFallback(fontFamily) {
  const selected = String(fontFamily || '').trim();
  if (!selected) return multilingualFontFallback;
  return selected + ', ' + multilingualFontFallback;
}

function scrollTravelSeconds(secondsPerViewport, distance, viewportDistance) {
  const safeSeconds = Math.max(0.01, Number(secondsPerViewport) || 0.01);
  const safeDistance = Math.max(0, Number(distance) || 0);
  const safeViewportDistance = Math.max(1, Number(viewportDistance) || 1);
  return Number(Math.max(0.05, (safeSeconds * safeDistance) / safeViewportDistance).toFixed(3));
}

function overlayLowPowerEnabled(settings) {
  const quality = new URLSearchParams(location.search).get('quality');
  if (quality === 'pretty' || quality === 'smooth') return false;
  if (quality === 'low') return true;
  return (settings.overlayLowPowerMode || 'false') === 'true';
}

  window.OverlayUtils = {
    escapeHtml,
    hexToRgb,
    hexToRgba,
    withMultilingualFallback,
    scrollTravelSeconds,
    overlayLowPowerEnabled
  };
})();
