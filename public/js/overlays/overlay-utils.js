export { escapeHtml } from '../shared/html-escape.js';
export { withMultilingualFallback } from '../shared/font-family.js';

export function hexToRgb(hex) {
  const normalized = String(hex || '#181823').replace('#', '');
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;
  const number = Number.parseInt(value.slice(0, 6), 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255,
  };
}

export function hexToRgba(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  const alpha = Number(opacity);
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.76;
  const colorAlpha = /^#[\da-f]{8}$/i.test(hex) ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + safeAlpha * colorAlpha + ')';
}

export function scrollTravelSeconds(secondsPerViewport, distance, viewportDistance) {
  const safeSeconds = Math.max(0.01, Number(secondsPerViewport) || 0.01);
  const safeDistance = Math.max(0, Number(distance) || 0);
  const safeViewportDistance = Math.max(1, Number(viewportDistance) || 1);
  return Number(Math.max(0.05, (safeSeconds * safeDistance) / safeViewportDistance).toFixed(3));
}

export function overlayLowPowerEnabled(settings) {
  const quality = new URLSearchParams(location.search).get('quality');
  if (quality === 'pretty' || quality === 'smooth') return false;
  if (quality === 'low') return true;
  return (settings.overlayLowPowerMode || 'false') === 'true';
}
