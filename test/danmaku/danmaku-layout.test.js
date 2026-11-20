const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../../src/shared/danmaku-layout');

test('widening a horizontal strip adds card space while preserving the content scale', async () => {
  const { canvasContentScale } = await import('../../public/js/overlays/danmaku-canvas.js');
  const value = layout.createLayout();
  for (const style of ['stargazer', 'glowy']) {
    const region = value.regions[style];
    const options = { [style]: { [`${style}Layout`]: 'horizontal' } };
    region.height = 260;
    const original = canvasContentScale(value, style, options);
    region.width = 1200;
    assert.equal(canvasContentScale(value, style, options), original);
    assert.ok(canvasContentScale(value, style) > original, 'vertical cards retain width-based scaling');
  }
  const horizontal = value.regions['celestial-horizontal'];
  const barScale = canvasContentScale(value, 'celestial-horizontal');
  horizontal.width = 1200;
  assert.equal(canvasContentScale(value, 'celestial-horizontal'), barScale);
});

test('resolution changes scale composition; portrait changes retain typography and contain every region', () => {
  const original = layout.createLayout();
  original.regions.signal = { x: 100, y: 200, width: 400, height: 300 };
  const large = layout.resizeCanvas(original, { width: 3840, height: 2160 });
  assert.equal(large.contentScale, 2);
  assert.deepEqual(large.regions.signal, { x: 200, y: 400, width: 800, height: 600 });
  assert.deepEqual(layout.resizeCanvas(large, original.canvas), original);
  const portrait = layout.resizeCanvas(large, { width: 1080, height: 1920 });
  assert.equal(portrait.contentScale, 2);
  assert.deepEqual(layout.normalizeLayout(portrait), portrait);
  assert.deepEqual(portrait.regions.glow, { x: 0, y: 0, width: 1080, height: 1920 });
});

test('drag and every resize handle keep opposite edges fixed and stay inside the canvas', () => {
  const canvas = { width: 1920, height: 1080 };
  const region = { x: 200, y: 300, width: 500, height: 400 };
  assert.deepEqual(layout.moveRegion(region, '', -900, 900, canvas), { ...region, x: 0, y: 680 });
  for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const next = layout.moveRegion(region, handle, 45, 35, canvas);
    if (handle.includes('w')) assert.equal(next.x + next.width, 700);
    if (handle.includes('n')) assert.equal(next.y + next.height, 700);
    if (!handle.includes('w')) assert.equal(next.x, 200);
    if (!handle.includes('n')) assert.equal(next.y, 300);
  }
  assert.equal(layout.moveRegion(region, 'nw', 9000, 9000, canvas).width, 64);
});

test('invalid layout values never become a partial valid configuration', () => {
  assert.equal(layout.normalizeLayout(null), null);
  const value = layout.createLayout();
  for (const invalid of [undefined, {}, [], { ...value, extra: true }, { ...value, contentScale: '1' },
    { ...value, canvas: { width: 319, height: 1080 } },
    { ...value, regions: { ...value.regions, signal: { x: 1800, y: 0, width: 560, height: 600 } } }])
    assert.throws(() => layout.normalizeLayout(invalid), { code: 'INVALID_OVERLAY_LAYOUT' });
});

test('new default regions preserve previously saved dimensions and text scaling', async () => {
  const { canvasContentScale } = await import('../../public/js/overlays/danmaku-canvas.js');
  const saved = layout.createLayout();
  saved.regions.bubble = { x: 120, y: 240, width: 380, height: 560 };
  saved.regions.minimal = { x: 600, y: 200, width: 504, height: 592 };
  saved.regions.identity = { x: 40, y: 480, width: 640, height: 560 };
  saved.regions['dark-moon'] = { x: 40, y: 320, width: 640, height: 720 };
  assert.deepEqual(layout.normalizeLayout(saved), saved);
  assert.equal(canvasContentScale(saved, 'dark-moon'), 1, 'saved text keeps its original scale');
});

// Styles added after the first saved layouts may be absent from older settings.
const OPTIONAL_REGIONS = ['coffee', 'horizontal-charm', 'neon-glass', 'astral', 'glowy', 'glass-bubble', 'celestial-horizontal', 'animated-gradient', 'stargazer', 'wireframe', 'sea-breeze', 'sea-breeze-random', 'glass', 'sinking', 'window', 'stardust', 'comic', 'startrail', 'sketch', 'whiteframe', 'starveil', 'moonlit', 'floating', 'comet', 'aurora', 'starlight', 'dark-moon', 'prismatic', 'harbor', 'snowfox', 'ripploid', 'twitter', 'mist', 'spooky', 'flower-letter', 'notebook', 'christmas', 'christmas-letter'];

test('older layouts gain each missing newer region at its default without moving saved regions', () => {
  const original = layout.createLayout();
  const oldest = structuredClone(original);
  for (const style of OPTIONAL_REGIONS) delete oldest.regions[style];
  oldest.regions.signal.x = 123;
  oldest.regions.glow.x = 100;
  oldest.regions.glow.width -= 100;
  const restored = layout.normalizeLayout(oldest);
  for (const style of OPTIONAL_REGIONS) {
    assert.deepEqual(restored.regions[style], layout.defaultRegion(style, original.canvas, original.contentScale), style);
  }
  assert.deepEqual(restored.regions.signal, oldest.regions.signal);
  assert.deepEqual(restored.regions.glow, oldest.regions.glow);
  assert.ok(OPTIONAL_REGIONS.every(style => !Object.hasOwn(oldest.regions, style)), 'input is not mutated');

  for (const canvas of [{ width: 1280, height: 720 }, { width: 1080, height: 1920 }]) {
    const legacy = layout.resizeCanvas(original, canvas);
    OPTIONAL_REGIONS.forEach(style => delete legacy.regions[style]);
    const upgraded = layout.normalizeLayout(legacy);
    assert.deepEqual(upgraded.regions.sketch, layout.defaultRegion('sketch', canvas, legacy.contentScale));
    assert.deepEqual(upgraded.regions.floating, { x: 0, y: 0, ...canvas });
  }
  const required = Object.keys(layout.REGION_DEFAULTS).filter((style) => !OPTIONAL_REGIONS.includes(style));
  assert.ok(required.includes('signal'));
  for (const style of required) {
    const invalid = layout.createLayout();
    delete invalid.regions[style];
    assert.throws(() => layout.normalizeLayout(invalid), { code: 'INVALID_OVERLAY_LAYOUT' }, style);
  }
  const partial = layout.createLayout();
  delete partial.regions.floating;
  delete partial.regions.comet;
  partial.regions.sketch = { x: 123, y: 84, width: 300, height: 200 };
  const upgraded = layout.normalizeLayout(partial);
  assert.deepEqual(upgraded.regions.sketch, partial.regions.sketch);
  assert.deepEqual(layout.resizeCanvas(upgraded, { width: 1080, height: 1920 }).regions.floating, { x: 0, y: 0, width: 1080, height: 1920 },
    'restored random regions keep filling the canvas after resizing');
});

test('the CommonJS layout and resolution entries use the browser contracts', async () => {
  const browser = await import('../../public/js/shared/danmaku-layout.js');
  const { CANVAS_PRESETS } = await import('../../public/js/shared/canvas-presets.js');
  assert.equal(layout.normalizeLayout, browser.normalizeLayout);
  assert.equal(layout.CANVAS_PRESETS, CANVAS_PRESETS);
  assert.equal(require('../../src/shared/canvas-presets').CANVAS_PRESETS, CANVAS_PRESETS);
});
