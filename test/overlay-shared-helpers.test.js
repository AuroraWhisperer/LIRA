'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');
const overlayPath = (file) => path.join(__dirname, '../public/js/overlays', file);

test('ESM overlay utilities use the same functions as the classic-script surface', async () => {
  const window = {};
  const location = { search: '?quality=low' };
  const utils = await loadModuleExports(overlayPath('overlay-utils-module.js'), {
    window,
    location,
    URLSearchParams,
  });
  for (const name of [
    'hexToRgb',
    'hexToRgba',
    'withMultilingualFallback',
    'overlayLowPowerEnabled',
    'scrollTravelSeconds',
    'escapeHtml',
  ]) {
    assert.equal(utils[name], window.OverlayUtils[name]);
  }
  assert.equal(utils.hexToRgba('#abc', 2), 'rgba(170, 187, 204, 1)');
  assert.equal(utils.hexToRgba('#abc', -1), 'rgba(170, 187, 204, 0)');
  assert.equal(utils.hexToRgba('#abc', 'invalid'), 'rgba(170, 187, 204, 0.76)');
  assert.equal(utils.overlayLowPowerEnabled({}), true);
  location.search = '?quality=pretty';
  assert.equal(utils.overlayLowPowerEnabled({ overlayLowPowerMode: 'true' }), false);
  location.search = '';
  assert.equal(utils.overlayLowPowerEnabled({ overlayLowPowerMode: 'true' }), true);
});

test('shared theme tokens preserve colors, blur, glow and fonts without replacing page backgrounds', async () => {
  const location = { search: '' };
  const { applyOverlayTheme } = await loadModuleExports(overlayPath('overlay-theme.js'), {
    window: {},
    location,
    URLSearchParams,
  });
  const values = new Map();
  const classes = new Map();
  const root = { style: { setProperty: (key, value) => values.set(key, value) } };
  const panel = {
    classList: { toggle: (key, value) => classes.set(key, value) },
    style: { backgroundColor: 'page-owned' },
  };
  const settings = {
    themePrimary: '#abc',
    themeAccent: '#123456',
    themeBackground: '#000',
    backdropBlur: '8',
    glowIntensity: '4',
    enableGradient: 'true',
    gradientEnd: '#fff',
    overlayFontFamily: 'Custom Font',
    overlayFontWeight: '600',
  };
  applyOverlayTheme(root, panel, settings);
  assert.equal(values.get('--overlay-primary-r'), '170');
  assert.equal(values.get('--overlay-accent-b'), '86');
  assert.equal(values.get('--overlay-blur'), '8px');
  assert.equal(values.get('--overlay-glow-color'), 'rgba(18, 52, 86, 0.05)');
  assert.equal(values.get('--overlay-gradient-r'), '255');
  assert.match(values.get('--overlay-font-family'), /^Custom Font, /);
  assert.equal(values.get('--overlay-font-weight'), '600');
  assert.equal(classes.get('has-backdrop-blur'), true);
  assert.equal(classes.get('gradient-bg'), true);
  location.search = '?quality=low';
  applyOverlayTheme(root, panel, settings);
  assert.equal(classes.get('low-power'), true);
  assert.equal(classes.get('has-backdrop-blur'), false);
  assert.equal(values.get('--overlay-blur'), '0px');
  assert.equal(values.get('--overlay-glow-color'), 'transparent');
  assert.equal(panel.style.backgroundColor, 'page-owned');
});
