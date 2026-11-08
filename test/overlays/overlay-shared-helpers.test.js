'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const overlayPath = (file) => path.join(__dirname, '../../public/js/overlays', file);

test('scene avatars reject credential-bearing, untrusted and private local URLs', async () => {
  const { sceneAvatarSource } = await loadModuleExports(overlayPath('scene-extra-client.js'), { URL });
  assert.equal(sceneAvatarSource('https://i0.hdslb.com/a.webp'), 'https://i0.hdslb.com/a.webp');
  assert.equal(sceneAvatarSource('/img/overlays/danmaku-ranked/viewer.webp'), '/img/overlays/danmaku-ranked/viewer.webp');
  for (const url of ['http://i0.hdslb.com/a.webp', 'https://untrusted.example/a.webp', '/api/bilibili/avatar',
    'https://user:secret@i0.hdslb.com/a.webp', '/img/overlays/danmaku-ranked/../secret.webp']) {
    assert.equal(sceneAvatarSource(url), '');
  }
});

test('overlay utilities escape markup, combine color alpha and resolve low-power mode', async () => {
  const location = { search: '?quality=low' };
  const utils = await loadModuleExports(overlayPath('overlay-utils-module.js'), {
    window: {},
    location,
    URLSearchParams,
  });
  assert.equal(utils.hexToRgba('#abc', 2), 'rgba(170, 187, 204, 1)');
  assert.deepEqual({ ...utils.hexToRgb('#12345680') }, { r: 18, g: 52, b: 86 });
  assert.equal(utils.hexToRgba('#12345600', 0.76), 'rgba(18, 52, 86, 0)');
  assert.equal(utils.hexToRgba('#12345680', 0.5), `rgba(18, 52, 86, ${128 / 255 * 0.5})`);
  assert.equal(utils.overlayLowPowerEnabled({}), true);
  location.search = '?quality=pretty';
  assert.equal(utils.overlayLowPowerEnabled({ overlayLowPowerMode: 'true' }), false);
  location.search = '';
  assert.equal(utils.overlayLowPowerEnabled({ overlayLowPowerMode: 'true' }), true);
  assert.equal(utils.escapeHtml('"quoted" & <tag>'), '&quot;quoted&quot; &amp; &lt;tag&gt;');
  assert.equal(utils.withMultilingualFallback('Noto Sans').split(/,\s*/)[0], 'Noto Sans', 'the selected font must stay first');
});

test('shared theme applies saved colors and fonts and drops blur in low-power mode', async () => {
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
  assert.equal(values.get('--overlay-blur'), '8px');
  assert.match(values.get('--overlay-font-family'), /^Custom Font, /);
  location.search = '?quality=low';
  applyOverlayTheme(root, panel, settings);
  assert.equal(classes.get('has-backdrop-blur'), false);
  assert.equal(values.get('--overlay-blur'), '0px');
});
