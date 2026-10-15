'use strict';

const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { readCssBundle } = require('../helpers/css-bundle');

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

function readDesktopLyricHtml() {
  return readAdminFragmentHtml('pages/admin/song/desktop-lyric.html');
}

test('desktop lyric settings and preview retain named headings', () => {
  const html = readDesktopLyricHtml();

  for (const id of ['desktopLyricSettingsTitle', 'desktopLyricPreviewTitle']) {
    assert.match(html, new RegExp(`<h[1-6]\\b(?=[^>]*\\sid=["']${id}["'])[^>]*>[^<]+</h[1-6]>`));
  }
});

test('desktop lyric settings group players and expose WeSing-only lyric source preferences', () => {
  const html = readDesktopLyricHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'desktop-lyric-preview.css');

  assert.deepEqual([...html.matchAll(/name="desktopLyricSourceGroup" value="([^"]+)"/g)].map((match) => match[1]),
    ['internal', 'external', 'wesing']);
  assert.deepEqual([...html.matchAll(/name="desktopLyricSource" value="([^"]+)"/g)].map((match) => match[1]),
    ['auto', 'qq-client', 'netease-client']);
  assert.match(html, /<div id="desktopLyricExternalControls"[^>]* hidden>/);
  const sourceControls = html.match(/<fieldset id="desktopLyricSourceControls"[^>]*>([\s\S]*?)<\/fieldset>/)?.[1];
  assert.match(sourceControls, /<div id="desktopLyricWeSingSettings"[^>]* hidden>/);
  assert.match(html, /<[^>]+(?=[^>]*\srole=["']radiogroup["'])(?=[^>]*\saria-labelledby=["']weSingLyricSourceLabel["'])[^>]*>/);
  assert.match(
    html,
    /<input\b(?=[^>]*\stype=["']radio["'])(?=[^>]*\sname=["']weSingLyricSource["'])(?=[^>]*\svalue=["']netease["'])(?=[^>]*\schecked(?:\s|>|\/|=))[^>]*>/,
  );
  assert.match(html, /<input\b(?=[^>]*\stype=["']radio["'])(?=[^>]*\sname=["']weSingLyricSource["'])(?=[^>]*\svalue=["']qq["'])[^>]*>/);
  assert.match(html, /<input[\s\S]*?id="weSingSmartLyricMatch"[\s\S]*?type="checkbox"[\s\S]*?checked/);
  assert.doesNotMatch(html, /\bsource-tab\b/);
  assert.match(styles, /\.desktop-lyric-source-option input:checked \+ \.desktop-lyric-source-choice/);
  assert.match(styles, /\.desktop-lyric-source-option\s+input:focus-visible\s+\+\s+\.desktop-lyric-source-choice/);
});

test('desktop lyric relative controls display percentages without changing stored values', async () => {
  const html = readDesktopLyricHtml();
  const listeners = new Map();
  const range = {
    value: '0.15',
    addEventListener(type, handler) {
      listeners.set(`range:${type}`, handler);
    },
  };
  const number = {
    value: '15',
    addEventListener(type, handler) {
      listeners.set(`number:${type}`, handler);
    },
  };
  const document = {
    getElementById(id) {
      return id === 'range' ? range : id === 'number' ? number : null;
    },
  };
  const { FormsService } = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'), {
    document,
    window: { AdminApp: {} },
  });
  const service = new FormsService();
  service.refreshParameterRanges = () => {};
  service.bindRangePair('range', 'number', 0, 1, 0.15, 100);

  range.value = '0.35';
  listeners.get('range:input')();
  assert.equal(number.value, '35');

  number.value = '80';
  listeners.get('number:input')();
  assert.equal(range.value, '0.8');

  assert.match(
    html,
    /<input\b(?=[^>]*\sid=["']desktopLyricBgOpacityNumber["'])(?=[^>]*\stype=["']number["'])(?=[^>]*\smin=["']0["'])(?=[^>]*\smax=["']100["'])[^>]*>/,
  );
  assert.match(
    html,
    /<input\b(?=[^>]*\sid=["']desktopLyricBrightnessNumber["'])(?=[^>]*\stype=["']number["'])(?=[^>]*\smin=["']20["'])(?=[^>]*\smax=["']200["'])[^>]*>/,
  );
  assert.doesNotMatch(html, /class="desktop-lyric-unit">(?:比|倍)<\/span>/);
});

test('desktop lyric frontend defaults match storage defaults', async () => {
  const { DESKTOP_LYRIC_DEFAULTS } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-defaults.js'),
  );
  const storageDefaults = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).filter(([key]) => key.startsWith('desktopLyric')),
  );

  assert.deepEqual(JSON.parse(JSON.stringify(DESKTOP_LYRIC_DEFAULTS)), storageDefaults);
  assert.equal(DESKTOP_LYRIC_DEFAULTS.desktopLyricFontFamily, 'Lira Maiyuan');
  assert.equal(DESKTOP_LYRIC_DEFAULTS.desktopLyricStrokeEnabled, 'false');
  assert.equal(DESKTOP_LYRIC_DEFAULTS.desktopLyricSungColor, '');
  assert.equal(DESKTOP_LYRIC_DEFAULTS.desktopLyricCurrentLineEnhanced, 'false');
});

test('desktop lyric stroke starts disabled and preserves an explicit opt-in', async () => {
  const { normalizeDesktopLyricSettings } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-settings.js'),
  );
  const { createSceneExtraDefaults } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'scene-extra-components.js'),
  );
  const strokeInput = readDesktopLyricHtml().match(/<input\b[^>]*\bid="desktopLyricStrokeEnabled"[^>]*>/)?.[0];

  assert.ok(strokeInput);
  assert.doesNotMatch(strokeInput, /\bchecked\b/);
  assert.equal(createSceneExtraDefaults('lyrics').desktopLyricStrokeEnabled, 'false');
  assert.equal(normalizeDesktopLyricSettings().strokeEnabled, false);
  assert.equal(normalizeDesktopLyricSettings({ desktopLyricStrokeEnabled: 'true' }, DEFAULT_SETTINGS).strokeEnabled, true);
});

test('desktop lyric settings use icon alignment controls and performance-safe motion defaults', () => {
  const html = readDesktopLyricHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'desktop-lyric-preview.css');

  for (const key of ['desktopLyricSpringAnimation', 'desktopLyricBlurEffect', 'desktopLyricScaleEffect', 'desktopLyricBackgroundEnabled']) {
    assert.equal(DEFAULT_SETTINGS[key], 'false', `${key} must remain opt-in`);
  }
  assert.match(html, /id="desktopLyricTextAlign"[^>]*role="radiogroup"/);
  for (const value of ['left', 'center', 'right', 'justify']) {
    assert.match(html, new RegExp(`name="desktopLyricTextAlign"[\\s\\S]*?value="${value}"`));
  }
  assert.match(html, /id="desktopLyricSpringAnimation"[\s\S]*?type="checkbox"/);
  assert.match(html, /id="desktopLyricBlurEffect"[\s\S]*?type="checkbox"/);
  assert.match(html, /id="desktopLyricScaleEffect"[\s\S]*?type="checkbox"/);
  assert.match(html, /id="desktopLyricVisibleLines"[\s\S]*?type="number"/);
  const basicSettings = html.match(/<details\b[^>]*class="desktop-lyric-settings-group is-basic"[^>]* open>([\s\S]*?)<\/details>/)?.[1];
  assert.match(basicSettings, /id="desktopLyricVisibleLines"/);
  assert.equal((html.match(/id="desktopLyricVisibleLines"/g) || []).length, 1);
  assert.match(html, /\sid=["']desktopLyricSpringHint["']/);
  assert.match(html, /\sid=["']desktopLyricBlurHint["']/);
  assert.match(styles, /label:has\(input:focus-visible\)/);
});

test('desktop lyric settings expose presentation controls with automatic font fallback', () => {
  const html = readDesktopLyricHtml();
  assert.doesNotMatch(html, /desktopLyricFallbackFontFamily|备选字体|备用字体/);
  assert.match(html, /支持多语言歌词，缺字自动补齐/);
  for (const id of ['desktopLyricLetterSpacing', 'desktopLyricLetterSpacingNumber']) {
    assert.match(html, new RegExp(`<input\\b(?=[^>]*\\sid="${id}")(?=[^>]*\\smax="2")[^>]*>`));
  }

  for (const id of [
    'desktopLyricTextAlign',
    'desktopLyricLetterSpacing',
    'desktopLyricStrokeEnabled',
    'desktopLyricShadowEnabled',
    'desktopLyricShadowColor',
    'desktopLyricShowTranslation',
    'desktopLyricKaraokeEnabled',
    'desktopLyricKaraokeMode',
    'desktopLyricHidePassedLines',
    'desktopLyricTraditionalMode',
    'desktopLyricHideOnPause',
    'desktopLyricCurrentLineEnhanced',
    'desktopLyricBaseOpacity',
    'desktopLyricTranslationOpacity',
    'desktopLyricTimeOffsetMs',
    'desktopLyricNoLyricText',
    'desktopLyricSpringAnimation',
    'desktopLyricBlurEffect',
    'desktopLyricScaleEffect',
    'desktopLyricAlignPosition',
    'desktopLyricAlignAnchor',
    'desktopLyricTranslateX',
    'desktopLyricTranslateY',
    'desktopLyricPerspective',
    'desktopLyricRotateX',
    'desktopLyricRotateY',
    'desktopLyricBackgroundEnabled',
    'desktopLyricBackgroundRenderer',
    'desktopLyricGlobalOpacity',
    'desktopLyricBrightness',
    'desktopLyricContrast',
    'desktopLyricSaturation',
    'desktopLyricResetBtn',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('desktop lyric display strategy presents continuous and discrete highlighting clearly', () => {
  const html = readDesktopLyricHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'desktop-lyric-preview.css');

  for (const value of ['off', 'continuous', 'discrete']) {
    assert.match(html, new RegExp(`name="desktopLyricKaraokeMode"[\\s\\S]*?value="${value}"`));
  }
  assert.match(styles, /\.desktop-lyric-preview-card\.is-karaoke-discrete/);
  for (const key of ['desktopLyricSungColor', 'desktopLyricTextColor']) {
    assert.match(html, new RegExp(`<input\\b(?=[^>]*\\sid="${key}")(?=[^>]*\\stype="color")[^>]*>`));
  }
  assert.match(html, /id="desktopLyricSungColorInherited"[^>]*checked/);
  assert.equal((html.match(/id="desktopLyricTextColor"/g) || []).length, 1);
  assert.doesNotMatch(html.match(/class="desktop-lyric-settings-group is-basic"[\s\S]*?<\/details>/)[0], /desktopLyricTextColor/);
  assert.doesNotMatch(html, /id="desktopLyricTextColor"[^>]*data-color-opacity/);
});

test('karaoke colors preserve explicit alpha and reuse the saved text color for unsung lyrics', async () => {
  const { normalizeDesktopLyricSettings } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-settings.js'),
  );
  const { applyDesktopLyricStyles } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-styles.js'),
  );
  const properties = new Map();
  const card = { style: { setProperty: (key, value) => properties.set(key, value) }, classList: { toggle() {} } };
  applyDesktopLyricStyles(card, normalizeDesktopLyricSettings({
    desktopLyricSungColor: '#12345680', desktopLyricTextColor: '#abcdef80',
  }, DEFAULT_SETTINGS));
  assert.equal(properties.get('--preview-sung-color'), '#12345680');
  assert.equal(properties.get('--preview-color'), '#abcdef80');
  assert.equal(properties.get('--preview-opacity'), '0.95', 'Global opacity stays independent of either color alpha.');
  applyDesktopLyricStyles(card, normalizeDesktopLyricSettings({
    desktopLyricSungColor: 'invalid',
  }, DEFAULT_SETTINGS));
  assert.equal(properties.get('--preview-sung-color'), '');
  assert.equal(properties.get('--preview-color'), '#000000');
});
