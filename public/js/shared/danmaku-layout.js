import { CANVAS_PRESETS } from './canvas-presets.js';

// Display contract mirrored by the desktop main process and the server.
const REGION_DEFAULTS = Object.freeze({
  coffee: [400, 640],
  'neon-glass': [480, 700],
  'horizontal-charm': [1920, 120],
  astral: [640, 720],
  'celestial-horizontal': [1920, 80],
  'sea-breeze': [480, 700],
  'sea-breeze-random': null,
  startrail: null,
  sinking: null,
  bubble: [570, 560], signal: [560, 600], minimal: [588, 576],
  ranked: [640, 640], transparent: [520, 540], identity: [640, 616],
  sketch: [480, 700],
  prismatic: [480, 700],
  harbor: [480, 700],
  snowfox: [480, 700],
  ripploid: [480, 700],
  twitter: [480, 700],
  'flower-letter': [480, 700],
  spooky: [480, 700],
  notebook: [480, 700],
  glowy: [480, 700],
  glass: [480, 700],
  'animated-gradient': [480, 700],
  christmas: [480, 700],
  stargazer: [480, 700],
  'christmas-letter': [480, 700],
  wireframe: [480, 700],
  starlight: [480, 700],
  'dark-moon': [480, 700],
  moonlit: [480, 700],
  comic: null,
  window: null,
  stardust: null,
  'glass-bubble': null,
  outline: null, mist: null, whiteframe: null, cream: null, glow: null, starveil: null, floating: null, comet: null, aurora: null,
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
  if (['celestial-horizontal', 'horizontal-charm'].includes(style)) return fitRegion({ x: 0, y: canvas.height - height, width: canvas.width, height }, canvas);
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
    || !regions || typeof regions !== 'object' || Array.isArray(regions)
    || Object.keys(regions).some((style) => !Object.hasOwn(REGION_DEFAULTS, style))
    || Object.keys(REGION_DEFAULTS).some((style) => !['coffee', 'horizontal-charm', 'neon-glass', 'astral', 'glowy', 'glass-bubble', 'celestial-horizontal', 'animated-gradient', 'sea-breeze', 'sea-breeze-random', 'glass', 'sinking', 'window', 'stardust', 'comic', 'startrail', 'sketch', 'mist', 'whiteframe', 'starveil', 'moonlit', 'floating', 'comet', 'aurora', 'starlight', 'dark-moon', 'prismatic', 'harbor', 'snowfox', 'ripploid', 'twitter', 'spooky', 'flower-letter', 'notebook', 'christmas', 'christmas-letter', 'stargazer', 'wireframe'].includes(style) && !Object.hasOwn(regions, style))) fail();
  const normalized = {};
  for (const style of Object.keys(REGION_DEFAULTS)) {
    const region = !Object.hasOwn(regions, style)
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

export { CANVAS_PRESETS, REGION_DEFAULTS, createLayout, defaultRegion, fitRegion, normalizeLayout, resizeCanvas, moveRegion };
