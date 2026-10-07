'use strict';

const { readAdminHtml } = require('../helpers/admin-html');
const { readCssBundle } = require('../helpers/css-bundle');

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

function readDesktopLyricHtml() {
  const html = readAdminHtml();
  const start = html.indexOf('<div id="desktopLyricPage"');
  const end = html.indexOf('<section id="giftAssistantPage"', start);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

test('desktop lyric settings and preview retain named headings', () => {
  const html = readDesktopLyricHtml();

  for (const id of ['desktopLyricSettingsTitle', 'desktopLyricPreviewTitle']) {
    assert.match(html, new RegExp(`<h[1-6]\\b(?=[^>]*\\sid=["']${id}["'])[^>]*>[^<]+</h[1-6]>`));
  }
});

test('desktop lyric settings expose WeSing-only lyric source preferences', () => {
  const html = readDesktopLyricHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'desktop-lyric-preview.css');

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
  assert.match(html, /\sid=["']desktopLyricSpringHint["']/);
  assert.match(html, /\sid=["']desktopLyricBlurHint["']/);
  assert.match(styles, /label:has\(input:focus-visible\)/);
});

test('desktop lyric settings expose all persisted presentation controls', () => {
  const html = readDesktopLyricHtml();

  for (const id of [
    'desktopLyricFallbackFontFamily',
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
});
