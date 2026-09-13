'use strict';

const { readAdminHtml } = require('./helpers/admin-html');
const { readCssBundle } = require('./helpers/css-bundle');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '..');

function readDesktopLyricHtml() {
  const html = readAdminHtml();
  const start = html.indexOf('<div id="desktopLyricPage"');
  const end = html.indexOf('<section id="giftAssistantPage"', start);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

test('desktop lyric settings use Chinese-only section headings', () => {
  const html = readDesktopLyricHtml();
  const styles = readCssBundle(
    'public',
    'css',
    'admin',
    'desktop-lyric-preview.css',
  );

  assert.match(html, /<h3 id="desktopLyricSettingsTitle">歌词样式<\/h3>/);
  assert.match(
    html,
    /<h3 id="desktopLyricPreviewTitle">桌面歌词实时预览<\/h3>/,
  );
  assert.doesNotMatch(
    html,
    /STYLE CONTROLS|LIVE PREVIEW|desktop-lyric-preview-kicker/,
  );
  assert.doesNotMatch(styles, /desktop-lyric-preview-kicker/);
});

test('desktop lyric settings give more width to controls and scale down only the admin preview', () => {
  const styles = readCssBundle(
    'public',
    'css',
    'admin',
    'desktop-lyric-preview.css',
  );

  assert.match(
    styles,
    /\.desktop-lyric-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(460px, 1fr\) minmax\(320px, 648px\);/,
  );
  assert.match(
    styles,
    /\.desktop-lyric-preview-card\s*\{[\s\S]*?max-width:\s*648px;/,
  );
  assert.match(
    styles,
    /\.desktop-lyric-workspace \.desktop-lyric-preview-row-text\s*\{\s*font-size:\s*min\(calc\(var\(--preview-size\) \* 0\.9\), 8\.5cqi\);/,
  );
  assert.match(
    styles,
    /\.desktop-lyric-workspace \.desktop-lyric-preview-row-translation\s*\{\s*font-size:\s*min\(calc\(var\(--preview-translation-size\) \* 0\.9\), 7cqi\);/,
  );
  assert.match(
    styles,
    /\.desktop-lyric-workspace \.desktop-lyric-preview-row-roma\s*\{\s*font-size:\s*min\(calc\(var\(--preview-translation-size\) \* 0\.86 \* 0\.9\), 6cqi\);/,
  );
  assert.match(
    styles,
    /\.desktop-lyric-workspace \.desktop-lyric-preview-empty\s*\{\s*font-size:\s*13\.5px;/,
  );
});

test('desktop lyric settings expose WeSing-only lyric source preferences', () => {
  const html = readDesktopLyricHtml();
  const styles = readCssBundle(
    'public',
    'css',
    'admin',
    'desktop-lyric-preview.css',
  );
  const sourceSettingsIndex = html.indexOf(
    'class="theme-section desktop-lyric-source-settings"',
  );
  const styleSettingsIndex = html.indexOf(
    'class="desktop-lyric-settings-group is-basic"',
  );

  assert.ok(
    sourceSettingsIndex >= 0 && sourceSettingsIndex < styleSettingsIndex,
  );
  assert.match(
    html,
    /role="radiogroup"[^>]*aria-labelledby="weSingLyricSourceLabel"/,
  );
  assert.match(
    html,
    /<input[\s\S]*?type="radio"[\s\S]*?name="weSingLyricSource"[\s\S]*?value="netease"[\s\S]*?checked[\s\S]*?\/>/,
  );
  assert.match(
    html,
    /<input[\s\S]*?type="radio"[\s\S]*?name="weSingLyricSource"[\s\S]*?value="qq"[\s\S]*?\/>/,
  );
  assert.doesNotMatch(html, /网易云音乐（默认）/);
  assert.match(
    html,
    /<input[\s\S]*?id="weSingSmartLyricMatch"[\s\S]*?type="checkbox"[\s\S]*?checked/,
  );
  assert.match(html, /全民 K 歌在线歌词[\s\S]*?<lira-help[\s\S]*?>/);
  assert.match(html, /仅在本地 QRC 不可用/);
  assert.match(html, /不影响 QQ[\s\S]*?音乐和网易云音乐的歌词来源/);
  assert.doesNotMatch(html, /\bsource-tab\b/);
  assert.match(styles, /\.desktop-lyric-source-options\s*\{/);
  assert.match(
    styles,
    /\.desktop-lyric-source-option input:checked \+ \.desktop-lyric-source-choice/,
  );
  assert.match(
    styles,
    /\.desktop-lyric-source-option\s+input:focus-visible\s+\+\s+\.desktop-lyric-source-choice/,
  );
  assert.match(styles, /\.desktop-lyric-smart-match-row\s*\{/);
});

test('desktop lyric settings reserve help marks for non-obvious behavior', () => {
  const html = readDesktopLyricHtml();

  const normalizedHtml = html.replace(/\s+/g, ' ');
  for (const label of [
    '基础样式',
    '主字体',
    '字体大小',
    '文字颜色',
    '显示背景',
    '亮度',
  ]) {
    assert.doesNotMatch(normalizedHtml, new RegExp(`${label} <lira-help`));
  }
  for (const label of [
    '备选字体',
    '时间偏移',
    '弹性动画',
    '模糊效果',
    '显示歌词行数',
  ]) {
    assert.match(normalizedHtml, new RegExp(`${label} <lira-help`));
  }
});

test('desktop lyric settings define the merged presentation defaults', () => {
  assert.equal(
    DEFAULT_SETTINGS.desktopLyricFallbackFontFamily,
    'Microsoft JhengHei',
  );
  assert.equal(DEFAULT_SETTINGS.desktopLyricTextAlign, 'left');
  assert.equal(DEFAULT_SETTINGS.desktopLyricShowTranslation, 'true');
  assert.equal(DEFAULT_SETTINGS.desktopLyricKaraokeEnabled, 'true');
  assert.equal(DEFAULT_SETTINGS.desktopLyricKaraokeMode, 'continuous');
  assert.equal(DEFAULT_SETTINGS.desktopLyricHideOnPause, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricTimeOffsetMs, '0');
  assert.equal(DEFAULT_SETTINGS.desktopLyricSpringAnimation, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricBlurEffect, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricScaleEffect, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricAlignPosition, '0.5');
  assert.equal(DEFAULT_SETTINGS.desktopLyricBackgroundEnabled, 'false');
  assert.equal(DEFAULT_SETTINGS.desktopLyricBrightness, '1');
  assert.equal(DEFAULT_SETTINGS.desktopLyricVisibleLines, '0');
});

test('desktop lyric relative controls display percentages without changing stored values', async () => {
  const html = readDesktopLyricHtml();
  const styles = readCssBundle(
    'public',
    'css',
    'admin',
    'desktop-lyric-preview.css',
  );
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
  const { FormsService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    { document, window: { AdminApp: {} } },
  );
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
    /id="desktopLyricBgOpacityNumber"[\s\S]*?type="number"[\s\S]*?min="0"[\s\S]*?max="100"[\s\S]*?step="5"[\s\S]*?value="15"\s*\//,
  );
  assert.match(
    html,
    /id="desktopLyricBrightnessNumber"[\s\S]*?type="number"[\s\S]*?min="20"[\s\S]*?max="200"[\s\S]*?step="5"[\s\S]*?value="100"\s*\//,
  );
  assert.doesNotMatch(html, /class="desktop-lyric-unit">(?:比|倍)<\/span>/);
  assert.match(
    styles,
    /\.desktop-lyric-control \.range-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 82px/,
  );
  assert.match(
    styles,
    /\.desktop-lyric-control \.range-row input\[type=['"]number['"]\]\s*\{[^}]*height:\s*28px[^}]*padding:\s*3px 30px 3px 7px/,
  );
  assert.match(
    styles,
    /\.desktop-lyric-unit\s*\{[^}]*grid-column:\s*2[^}]*justify-self:\s*end/,
  );
});

test('desktop lyric frontend defaults match storage defaults', async () => {
  const { DESKTOP_LYRIC_DEFAULTS } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-defaults.js'),
  );
  const storageDefaults = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).filter(([key]) =>
      key.startsWith('desktopLyric'),
    ),
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(DESKTOP_LYRIC_DEFAULTS)),
    storageDefaults,
  );
});

test('desktop lyric settings use icon alignment controls and performance-safe motion defaults', () => {
  const html = readDesktopLyricHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'),
    'utf8',
  );
  const styles = readCssBundle(
    'public',
    'css',
    'admin',
    'desktop-lyric-preview.css',
  );

  assert.match(html, /id="desktopLyricTextAlign"[^>]*role="radiogroup"/);
  for (const value of ['left', 'center', 'right', 'justify']) {
    assert.match(
      html,
      new RegExp(`name="desktopLyricTextAlign"[\\s\\S]*?value="${value}"`),
    );
  }
  assert.match(html, /id="desktopLyricSpringAnimation"[\s\S]*?type="checkbox"/);
  assert.match(html, /id="desktopLyricBlurEffect"[\s\S]*?type="checkbox"/);
  assert.match(html, /id="desktopLyricScaleEffect"[\s\S]*?type="checkbox"/);
  assert.match(html, /id="desktopLyricVisibleLines"[\s\S]*?type="number"/);
  assert.doesNotMatch(source, /\['desktopLyricVisibleLines', 0, 99, 0\]/);
  assert.match(
    html,
    /<lira-help>[\s\S]*?<span id="desktopLyricSpringHint"[\s\S]*?切换歌词时显示回弹；会持续计算位置，性能充足时再开启。[\s\S]*?<\/lira-help>/,
  );
  assert.match(
    html,
    /<lira-help>[\s\S]*?<span id="desktopLyricBlurHint"[\s\S]*?模糊非当前歌词行；会增加合成压力，性能充足时再开启。[\s\S]*?<\/lira-help>/,
  );
  assert.match(styles, /\.desktop-lyric-align-options\s*\{/);
  assert.match(styles, /label:has\(input:focus-visible\)/);
  assert.doesNotMatch(styles, /\.desktop-lyric-performance-hint/);
});

test('desktop lyric settings organize the merged controls below lyric matching', () => {
  const html = readDesktopLyricHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'),
    'utf8',
  );
  const sourceIndex = html.indexOf(
    'class="theme-section desktop-lyric-source-settings"',
  );
  const groupNames = [
    '基础样式',
    '描边与阴影',
    '显示策略',
    '可见性与同步',
    '动画与布局',
    '背景与渲染',
    '操作',
  ];
  let previousIndex = sourceIndex;
  for (const name of groupNames) {
    const index = html.indexOf(name, previousIndex + 1);
    assert.ok(
      index > previousIndex,
      `${name} should follow the previous settings group`,
    );
    previousIndex = index;
  }

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
  assert.doesNotMatch(
    html,
    /desktopLyricLoadLocalFontsBtn|desktopLyricLocalFontStatus/,
  );
  assert.doesNotMatch(
    source,
    /desktopLyricLoadLocalFontsBtn|desktopLyricLocalFontStatus/,
  );
});

test('desktop lyric display strategy presents continuous and discrete highlighting clearly', () => {
  const html = readDesktopLyricHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'),
    'utf8',
  );
  const styles = readCssBundle(
    'public',
    'css',
    'admin',
    'desktop-lyric-preview.css',
  );

  assert.match(
    html,
    /<strong id="desktopLyricKaraokeTitle"[\s\S]*?逐字高亮方式[\s\S]*?<lira-help>/,
  );
  for (const value of ['off', 'continuous', 'discrete']) {
    assert.match(
      html,
      new RegExp(`name="desktopLyricKaraokeMode"[\\s\\S]*?value="${value}"`),
    );
  }
  assert.match(html, /逐字点亮<\/strong><small>低功耗<\/small>/);
  assert.match(html, /逐字高亮状态示例/);
  assert.match(source, /function selectedKaraokeMode\(\)/);
  assert.match(source, /desktopLyricKaraokeMode/);
  assert.match(styles, /\.desktop-lyric-karaoke-card\s*\{/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-karaoke-discrete/);
});
