const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../../src/shared/danmaku-layout');

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

test('new default regions preserve previously saved dimensions', () => {
  const saved = layout.createLayout();
  saved.regions.bubble = { x: 120, y: 240, width: 380, height: 560 };
  saved.regions.minimal = { x: 600, y: 200, width: 504, height: 592 };
  saved.regions.identity = { x: 40, y: 480, width: 640, height: 560 };
  assert.deepEqual(layout.normalizeLayout(saved), saved);
});

// Styles added after the first saved layouts may be absent from older settings.
const OPTIONAL_REGIONS = ['sinking', 'window', 'comic', 'startrail', 'sketch', 'whiteframe', 'starveil', 'moonlit', 'floating', 'comet', 'aurora', 'starlight', 'prismatic', 'harbor', 'snowfox', 'ripploid', 'twitter', 'mist', 'spooky', 'flower-letter', 'notebook', 'christmas', 'christmas-letter'];

test('older layouts gain each missing newer region at its default without moving saved regions', () => {
  const original = layout.createLayout();
  for (const missing of [...OPTIONAL_REGIONS.map((style) => [style]), OPTIONAL_REGIONS]) {
    const legacy = structuredClone(original);
    missing.forEach((style) => delete legacy.regions[style]);
    legacy.regions.signal.x = 123;
    legacy.regions.glow.x = 100;
    legacy.regions.glow.width -= 100;
    const upgraded = layout.normalizeLayout(legacy);
    for (const style of missing) {
      assert.deepEqual(upgraded.regions[style], layout.defaultRegion(style, original.canvas, original.contentScale), style);
    }
    assert.deepEqual(upgraded.regions.signal, legacy.regions.signal);
    assert.deepEqual(upgraded.regions.glow, legacy.regions.glow);
    assert.equal(missing.some((style) => Object.hasOwn(legacy.regions, style)), false, 'input is not mutated');
  }
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
  const upgraded = layout.normalizeLayout(Object.assign(layout.createLayout(), {
    regions: Object.fromEntries(Object.entries(layout.createLayout().regions).filter(([style]) => !['floating', 'comet'].includes(style))),
  }));
  assert.deepEqual(layout.resizeCanvas(upgraded, { width: 1080, height: 1920 }).regions.floating, { x: 0, y: 0, width: 1080, height: 1920 },
    'restored random regions keep filling the canvas after resizing');
});

test('Node and browser layout contracts stay identical', () => {
  const browser = require('../../public/js/shared/danmaku-layout.js');
  assert.deepEqual(browser.CANVAS_PRESETS, layout.CANVAS_PRESETS);
  assert.deepEqual(browser.REGION_DEFAULTS, layout.REGION_DEFAULTS);
  const original = layout.createLayout();
  assert.deepEqual(browser.createLayout(), original);
  for (const canvas of [{ width: 3840, height: 2160 }, { width: 1080, height: 1920 }]) {
    assert.deepEqual(browser.resizeCanvas(original, canvas), layout.resizeCanvas(original, canvas));
  }
  const legacy = structuredClone(original);
  OPTIONAL_REGIONS.forEach(style => delete legacy.regions[style]);
  assert.deepEqual(browser.normalizeLayout(legacy), layout.normalizeLayout(legacy));
  assert.throws(() => browser.normalizeLayout({ ...original, extra: true }), { code: 'INVALID_OVERLAY_LAYOUT' });
  const region = { x: 200, y: 300, width: 500, height: 400 };
  assert.deepEqual(browser.fitRegion({ ...region, x: 1900 }, original.canvas), layout.fitRegion({ ...region, x: 1900 }, original.canvas));
  for (const handle of ['', 'nw', 'se']) {
    assert.deepEqual(browser.moveRegion(region, handle, 9000, -9000, original.canvas), layout.moveRegion(region, handle, 9000, -9000, original.canvas));
  }
});
