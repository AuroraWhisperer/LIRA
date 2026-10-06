const { CANVAS_PRESETS } = require('./canvas-presets');

// Display contract mirrored by the desktop main process and the server.
const REGION_DEFAULTS = Object.freeze({
  bubble: [380, 560], signal: [560, 600], minimal: [294, 480],
  ranked: [640, 640], transparent: [520, 540], identity: [640, 560],
  moonlit: [640, 720],
  outline: null, cream: null, glow: null,
});

function fitRegion(region, canvas) {
  const width = Math.min(canvas.width, Math.max(64, Math.round(region.width)));
  const height = Math.min(canvas.height, Math.max(64, Math.round(region.height)));
  return {
    x: Math.min(canvas.width - width, Math.max(0, Math.round(region.x))),
    y: Math.min(canvas.height - height, Math.max(0, Math.round(region.y))),
    width, height,
  };
}

function defaultRegion(style, canvas, contentScale = 1) {
  const size = REGION_DEFAULTS[style];
  if (!size) return { x: 0, y: 0, ...canvas };
  const width = Math.round(size[0] * contentScale);
  const height = Math.round(size[1] * contentScale);
  const margin = Math.round(40 * contentScale);
  return fitRegion({ x: margin, y: canvas.height - height - margin, width, height }, canvas);
}

function createLayout() {
  const canvas = { width: 1920, height: 1080 };
  return {
    canvas, contentScale: 1,
    regions: Object.fromEntries(Object.keys(REGION_DEFAULTS).map((style) => [style, defaultRegion(style, canvas)])),
  };
}

function normalizeLayout(value) {
  if (value === null) return null;
  const fail = () => { throw Object.assign(new Error('INVALID_OVERLAY_LAYOUT'), { code: 'INVALID_OVERLAY_LAYOUT' }); };
  const keysAre = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).length === keys.length && keys.every((key) => Object.hasOwn(object, key));
  if (!keysAre(value, ['canvas', 'contentScale', 'regions']) || !keysAre(value.canvas, ['width', 'height'])) fail();
  const { canvas, contentScale, regions } = value;
  if (!Object.values(canvas).every((n) => Number.isInteger(n) && n >= 320 && n <= 7680)
    || !Number.isFinite(contentScale) || contentScale < 0.1 || contentScale > 8
    || (!keysAre(regions, Object.keys(REGION_DEFAULTS))
      && !keysAre(regions, Object.keys(REGION_DEFAULTS).filter((style) => style !== 'moonlit')))) fail();
  const normalized = {};
  for (const style of Object.keys(REGION_DEFAULTS)) {
    const region = style === 'moonlit' && !Object.hasOwn(regions, style)
      ? defaultRegion(style, canvas, contentScale) : regions[style];
    if (!keysAre(region, ['x', 'y', 'width', 'height']) || !Object.values(region).every(Number.isInteger)
      || region.x < 0 || region.y < 0 || region.width < 64 || region.height < 64
      || region.x + region.width > canvas.width || region.y + region.height > canvas.height) fail();
    normalized[style] = { x: region.x, y: region.y, width: region.width, height: region.height };
  }
  return { canvas: { ...canvas }, contentScale, regions: normalized };
}

function resizeCanvas(layout, canvas) {
  const sameRatio = layout.canvas.width * canvas.height === canvas.width * layout.canvas.height;
  const ratio = sameRatio ? canvas.width / layout.canvas.width : 1;
  const contentScale = Math.round(layout.contentScale * ratio * 1e6) / 1e6;
  const regions = Object.fromEntries(Object.entries(layout.regions).map(([style, region]) => {
    const full = region.x === 0 && region.y === 0 && region.width === layout.canvas.width
      && region.height === layout.canvas.height;
    const previousDefault = defaultRegion(style, layout.canvas, layout.contentScale);
    const isDefault = Object.keys(region).every((key) => region[key] === previousDefault[key]);
    const resized = full ? { x: 0, y: 0, ...canvas }
      : !sameRatio && isDefault ? defaultRegion(style, canvas, contentScale)
        : Object.fromEntries(Object.entries(region).map(([key, value]) => [key, value * ratio]));
    return [style, fitRegion(resized, canvas)];
  }));
  return normalizeLayout({ canvas, contentScale, regions });
}

function moveRegion(region, handle, dx, dy, canvas) {
  if (!handle) return fitRegion({ ...region, x: region.x + dx, y: region.y + dy }, canvas);
  let { x, y, width, height } = region;
  const right = x + width;
  const bottom = y + height;
  if (handle.includes('w')) x = Math.max(0, Math.min(right - 64, Math.round(x + dx)));
  if (handle.includes('n')) y = Math.max(0, Math.min(bottom - 64, Math.round(y + dy)));
  width = handle.includes('e') ? Math.max(64, Math.min(canvas.width - x, Math.round(width + dx))) : right - x;
  height = handle.includes('s') ? Math.max(64, Math.min(canvas.height - y, Math.round(height + dy))) : bottom - y;
  return { x, y, width, height };
}

module.exports = { CANVAS_PRESETS, REGION_DEFAULTS, createLayout, defaultRegion, fitRegion, normalizeLayout, resizeCanvas, moveRegion };
