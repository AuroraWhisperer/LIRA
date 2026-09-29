const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const layout = require('../../src/shared/danmaku-layout');

test('fixed defaults are bottom left; random regions fill the canvas', () => {
  const value = layout.createLayout();
  assert.deepEqual(value.canvas, { width: 1920, height: 1080 });
  for (const [style, region] of Object.entries(value.regions)) {
    if (layout.REGION_DEFAULTS[style]) {
      assert.equal(region.x, 40);
      assert.equal(region.y + region.height, 1040);
    } else assert.deepEqual(region, { x: 0, y: 0, width: 1920, height: 1080 });
  }
  assert.deepEqual(layout.normalizeLayout(value), value);
});

test('resolution changes scale composition; portrait changes retain typography and contain every region', () => {
  const original = layout.createLayout();
  const large = layout.resizeCanvas(original, { width: 3840, height: 2160 });
  assert.equal(large.contentScale, 2);
  assert.deepEqual(large.regions.signal, { x: 80, y: 880, width: 1120, height: 1200 });
  assert.deepEqual(layout.resizeCanvas(large, original.canvas), original);
  const portrait = layout.resizeCanvas(large, { width: 1080, height: 1920 });
  assert.equal(portrait.contentScale, 2);
  assert.deepEqual(layout.normalizeLayout(portrait), portrait);
  assert.deepEqual(portrait.regions.glow, { x: 0, y: 0, width: 1080, height: 1920 });
  const defaultPortrait = layout.resizeCanvas(original, { width: 1080, height: 1920 });
  assert.equal(defaultPortrait.regions.identity.y + defaultPortrait.regions.identity.height, 1880);
  assert.equal(defaultPortrait.regions.identity.x, 40);
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

test('Node and browser layout contracts stay identical', () => {
  const root = path.join(__dirname, '../..');
  const browser = fs.readFileSync(path.join(root, 'public/js/shared/danmaku-layout.js'), 'utf8');
  const node = fs.readFileSync(path.join(root, 'src/shared/danmaku-layout.js'), 'utf8');
  assert.equal(node.replace(/\r\n/g, '\n'), browser.replace(/\r\n/g, '\n').replace(/export \{([^}]+)\};\s*$/, 'module.exports = {$1};\n'));
});
