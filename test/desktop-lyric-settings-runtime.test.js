'use strict';

const { readAdminHtml } = require('./helpers/admin-html');
const { readCssBundle } = require('./helpers/css-bundle');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '..');

function readDesktopLyricHtml() {
  const html = readAdminHtml();
  const start = html.indexOf('<div id="desktopLyricPage"');
  const end = html.indexOf('<section id="giftAssistantPage"', start);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

test('desktop lyric settings automatically list local font families and preserve denial state', async () => {
  const form = { addEventListener() {} };
  const builtInOption = {
    value: 'Microsoft YaHei',
    textContent: '微软雅黑（默认）',
  };
  const select = {
    value: 'Microsoft YaHei',
    children: [],
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector !== 'optgroup[data-local-fonts="true"]') return null;
      return this.children.find((child) => child.dataset?.localFonts === 'true') || null;
    },
    get options() {
      return [builtInOption, ...this.children.flatMap((child) => child.children || [])];
    },
  };
  const elements = new Map([
    ['desktopLyricForm', form],
    ['desktopLyricFontFamily', select],
  ]);
  function createNode(tagName) {
    return {
      tagName: tagName.toUpperCase(),
      children: [],
      dataset: {},
      value: '',
      textContent: '',
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
      },
    };
  }

  let queryCount = 0;
  const sandbox = {
    console: { ...console, warn() {} },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      createElement: createNode,
    },
    setTimeout,
    clearTimeout,
    window: {
      addEventListener() {},
      async queryLocalFonts() {
        queryCount += 1;
        return [
          { family: 'Arial' },
          { family: 'Arial' },
          { family: ' 宋体 ' },
          { family: 'Cascadia Code' },
          { family: '' },
        ];
      },
      AdminApp: {
        utils: { setValue() {}, api: async () => ({ ok: true }) },
        forms: { bindRangePair() {} },
        desktopLyricPreview: { init() {}, applySettings() {} },
      },
    },
  };

  const dependencies = { ...sandbox.window.AdminApp };
  const { createDesktopLyric } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'),
    sandbox,
  );
  const desktopLyric = createDesktopLyric({
    utils: dependencies.utils,
    forms: dependencies.forms,
    preview: dependencies.desktopLyricPreview,
  });
  sandbox.window.AdminApp = {};
  desktopLyric.initDesktopLyricForm();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(queryCount, 1);
  const localGroup = select.querySelector('optgroup[data-local-fonts="true"]');
  assert.equal(localGroup.label, '本机字体');
  assert.deepEqual(
    localGroup.children.map((option) => option.textContent),
    ['Arial', 'Cascadia Code', '宋体'],
  );
  assert.deepEqual(
    localGroup.children.map((option) => option.value),
    ['"Arial"', '"Cascadia Code"', '"宋体"'],
  );
  assert.equal(select.value, 'Microsoft YaHei');
});

test('desktop lyric local font detection keeps built-ins when permission is denied', async () => {
  const form = { addEventListener() {} };
  const builtInOption = {
    value: 'Microsoft YaHei',
    textContent: '微软雅黑（默认）',
  };
  const select = {
    value: 'Microsoft YaHei',
    children: [],
    querySelector() {
      return null;
    },
    get options() {
      return [builtInOption];
    },
  };
  const elements = new Map([
    ['desktopLyricForm', form],
    ['desktopLyricFontFamily', select],
  ]);
  let queryCount = 0;
  const sandbox = {
    console: { ...console, warn() {} },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    window: {
      addEventListener() {},
      async queryLocalFonts() {
        queryCount += 1;
        const error = new Error('Permission denied');
        error.name = 'NotAllowedError';
        throw error;
      },
      AdminApp: {
        utils: { setValue() {}, api: async () => ({ ok: true }) },
        forms: { bindRangePair() {} },
        desktopLyricPreview: { init() {}, applySettings() {} },
      },
    },
  };

  const dependencies = { ...sandbox.window.AdminApp };
  const { createDesktopLyric } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'),
    sandbox,
  );
  const desktopLyric = createDesktopLyric({
    utils: dependencies.utils,
    forms: dependencies.forms,
    preview: dependencies.desktopLyricPreview,
  });
  sandbox.window.AdminApp = {};
  desktopLyric.initDesktopLyricForm();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(queryCount, 1);
  assert.equal(select.value, 'Microsoft YaHei');
  assert.equal(select.querySelector('optgroup[data-local-fonts="true"]'), null);
});

test('desktop lyric settings include a live word-timed preview', () => {
  const html = readDesktopLyricHtml();
  const settingsSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js'), 'utf8');
  const rendererSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-renderer.js'),
    'utf8',
  );
  const previewSettingsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-settings.js'),
    'utf8',
  );
  const previewStylesSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-styles.js'),
    'utf8',
  );
  const sharedRenderer = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-word-renderer.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'desktop-lyric-preview.css');
  const workspaceStyles = readCssBundle('public', 'css', 'admin', 'workspace', 'song.css');

  assert.match(html, /class="desktop-lyric-workspace"/);
  assert.match(html, /class="[^"]*desktop-lyric-settings-fields[^"]*"/);
  assert.match(html, /id="desktopLyricAutosaveState"/);
  assert.ok(html.indexOf('id="desktopLyricForm"') < html.indexOf('id="desktopLyricLivePreview"'));
  assert.doesNotMatch(html, /保存桌面歌词设置/);
  assert.match(html, /id="desktopLyricLivePreview"/);
  assert.match(html, /id="desktopLyricPreviewViewport"[^>]*tabindex="0"/);
  assert.match(html, /id="desktopLyricPreviewTimeline"/);
  assert.match(html, /id="desktopLyricPreviewPlayback"[^>]*aria-live="polite"/);
  assert.match(html, /id="desktopLyricPreviewProgress"/);
  assert.match(html, /id="desktopLyricCopyUrlBtn"[\s\S]*?>[\s\S]*?复制桌面歌词[\s\S]*?<\//);
  assert.match(html, /data-lyric-preview-background="grid"/);
  assert.match(rendererSource, /new LyricWordRenderer/);
  assert.match(source, /app:lyric-state/);
  assert.match(source, /app:lyric-timeline/);
  assert.match(rendererSource, /createElement\(["']div["']\)/);
  assert.match(rendererSource, /latestTimeline\.lines\.forEach/);
  assert.match(rendererSource, /`歌词已载入 · \$\{lineCount\} 行`/);
  assert.match(rendererSource, /textContent\s*=/);
  assert.doesNotMatch(rendererSource, /innerHTML\s*=/);
  assert.match(source, /import \{ copyText, localOverlayOrigin, toast \} from ["']\.\.\/shared\/utils\.js["'];/);
  assert.match(source, /await copyText\(desktopLyricUrl\)/);
  assert.doesNotMatch(source, /navigator\.clipboard\.writeText\(desktopLyricUrl\)/);
  assert.match(source, /`\$\{localOverlayOrigin\(location\)\}\/lyrics`/);
  assert.match(source, /桌面歌词地址已复制/);
  assert.doesNotMatch(source, /musicAPI\.openLyricWindow|desktopLyricOpenWindowBtn/);
  assert.match(previewSettingsSource, /desktopLyricFontFamily/);
  assert.match(previewStylesSource, /style\.setProperty/);
  assert.match(previewSettingsSource, /desktopLyricTimeOffsetMs/);
  assert.match(previewSettingsSource, /desktopLyricHideOnPause/);
  assert.match(previewSettingsSource, /desktopLyricBackgroundRenderer/);
  assert.match(sharedRenderer, /element\.textContent = word\.text/);
  assert.match(sharedRenderer, /requestAnimationFrame/);
  assert.match(styles, /--preview-word-progress/);
  assert.match(styles, /\.desktop-lyric-preview-stage\.is-solid/);
  assert.match(styles, /height:\s*clamp\(520px,\s*calc\(100vh - 210px\),\s*760px\)/);
  assert.match(workspaceStyles, /\.song-workspace[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.desktop-lyric-settings\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/);
  assert.match(styles, /\.desktop-lyric-preview-viewport[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.desktop-lyric-preview-viewport[\s\S]*?overscroll-behavior-y:\s*auto/);
  assert.match(
    styles,
    /\.desktop-lyric-workspace\s+\.desktop-lyric-preview-viewport:has\(\.desktop-lyric-preview-empty\)\s*\{[^}]*overflow-y:\s*hidden/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*980px\)[\s\S]*?\.desktop-lyric-settings\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/,
  );
  assert.match(styles, /\.desktop-lyric-preview-row\.is-active/);
  assert.match(styles, /\.desktop-lyric-preview-countdown-dot/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(rendererSource, /requestAnimationFrame\(animateLyricFollow\)/);
  assert.match(rendererSource, /MANUAL_FOLLOW_PAUSE_MS = 6000/);
  assert.match(rendererSource, /addEventListener\(["']pointerdown["'], pauseAutomaticFollow/);
  assert.doesNotMatch(rendererSource, /behavior:\s*['"]smooth['"]/);
  assert.doesNotMatch(rendererSource, /scrollIntoView/);
  assert.match(styles, /mask-image:\s*linear-gradient\(\s*to bottom/);
  assert.match(styles, /\.desktop-lyric-preview-viewport\.is-following/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-translation-hidden/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-hide-passed/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-paused-hidden/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-background-enabled/);
  assert.match(styles, /--preview-global-opacity/);
  assert.match(styles, /scale\(1\.02\)/);
  assert.match(styles, /container-name:\s*admin-lyric-preview/);
  assert.match(styles, /\.desktop-lyric-settings-fields\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(settingsSource, /form\.addEventListener\('submit'/);
  assert.doesNotMatch(settingsSource, /reloadState\(\)/);
});

test('desktop lyric settings debounce input and serialize the latest automatic save', async () => {
  const listeners = new Map();
  const windowListeners = new Map();
  const apiCalls = [];
  const form = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
  };
  const autosaveState = { textContent: '', className: '' };
  const resetListeners = new Map();
  const values = {
    desktopLyricFontFamily: 'Microsoft YaHei',
    desktopLyricFontWeight: '800',
    desktopLyricTextColor: '#000000',
    desktopLyricStrokeColor: '#ffffff',
    desktopLyricFontSize: '56',
    desktopLyricStrokeWidth: '3',
    desktopLyricOpacity: '0.95',
    desktopLyricBgOpacity: '0.15',
    desktopLyricScale: '1',
    desktopLyricLineHeight: '1.4',
    desktopLyricShadowIntensity: '0.35',
    desktopLyricTranslationScale: '0.65',
    desktopLyricTextAlign: 'justify',
  };
  const elements = new Map(Object.entries(values).map(([id, value]) => [id, { value }]));
  const lyricSourceInputs = [
    { value: 'netease', checked: true },
    { value: 'qq', checked: false },
  ];
  const textAlignInputs = [
    { value: 'left', checked: false },
    { value: 'center', checked: false },
    { value: 'right', checked: false },
    { value: 'justify', checked: true },
  ];
  const smartLyricMatch = { checked: true };
  elements.set('desktopLyricForm', form);
  elements.set('desktopLyricAutosaveState', autosaveState);
  elements.set('weSingSmartLyricMatch', smartLyricMatch);
  elements.set('desktopLyricResetBtn', {
    addEventListener(type, handler) {
      resetListeners.set(type, handler);
    },
  });
  let scheduledTimer = null;
  let resolveFirstSave;
  const sandbox = {
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelector(selector) {
        if (selector === 'input[name="weSingLyricSource"]:checked') {
          return lyricSourceInputs.find((input) => input.checked) || null;
        }
        if (selector === 'input[name="desktopLyricTextAlign"]:checked') {
          return textAlignInputs.find((input) => input.checked) || null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'input[name="weSingLyricSource"]') return lyricSourceInputs;
        if (selector === 'input[name="desktopLyricTextAlign"]') return textAlignInputs;
        return [];
      },
    },
    setTimeout(callback, delay) {
      scheduledTimer = { callback, delay };
      return 1;
    },
    clearTimeout() {
      scheduledTimer = null;
    },
    window: {
      addEventListener(type, handler) {
        windowListeners.set(type, handler);
      },
      AdminApp: {
        utils: {
          value: (id) => elements.get(id)?.value || '',
          setValue: (id, value) => {
            const element = elements.get(id);
            if (element) element.value = value;
          },
          api: (url, body) => {
            apiCalls.push({ url, body });
            if (apiCalls.length === 1) {
              return new Promise((resolve) => {
                resolveFirstSave = resolve;
              });
            }
            return Promise.resolve({ ok: true });
          },
        },
        forms: { bindRangePair() {} },
        desktopLyricPreview: { init() {}, applySettings() {} },
      },
    },
  };

  const dependencies = { ...sandbox.window.AdminApp };
  const { createDesktopLyric } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'),
    sandbox,
  );
  const desktopLyric = createDesktopLyric({
    utils: dependencies.utils,
    forms: dependencies.forms,
    preview: dependencies.desktopLyricPreview,
  });
  sandbox.window.AdminApp = {};
  desktopLyric.initDesktopLyricForm();

  listeners.get('input')();
  assert.equal(apiCalls.length, 0);
  assert.equal(scheduledTimer, null);
  assert.equal(autosaveState.textContent, '正在读取设置…');
  windowListeners.get('app:settings-state')({
    detail: {
      ...values,
      weSingLyricSource: 'netease',
      weSingSmartLyricMatch: 'true',
    },
  });
  assert.equal(scheduledTimer.delay, 500);
  scheduledTimer.callback();
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].body.weSingLyricSource, 'netease');
  assert.equal(apiCalls[0].body.weSingSmartLyricMatch, 'true');
  assert.equal(apiCalls[0].body.desktopLyricTextAlign, 'justify');

  windowListeners.get('app:settings-state')({
    detail: {
      ...values,
      weSingLyricSource: 'qq',
      weSingSmartLyricMatch: 'false',
    },
  });
  assert.equal(lyricSourceInputs[0].checked, false);
  assert.equal(lyricSourceInputs[1].checked, true);
  assert.equal(smartLyricMatch.checked, false);

  elements.get('desktopLyricFontSize').value = '64';
  listeners.get('change')();
  assert.equal(apiCalls.length, 1, 'a second write waits for the in-flight request');
  resolveFirstSave({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[0].url, '/api/settings');
  assert.equal(apiCalls[1].body.desktopLyricFontSize, '64');
  assert.equal(apiCalls[1].body.weSingLyricSource, 'qq');
  assert.equal(apiCalls[1].body.weSingSmartLyricMatch, 'false');
  assert.equal(autosaveState.textContent, '已自动保存');
  assert.match(autosaveState.className, /is-saved/);

  await new Promise((resolve) => setImmediate(resolve));
  resetListeners.get('click')();
  assert.equal(apiCalls.length, 3);
  assert.equal(apiCalls[2].body.desktopLyricFontSize, '56');
  assert.equal(apiCalls[2].body.weSingLyricSource, 'qq');
  assert.equal(apiCalls[2].body.weSingSmartLyricMatch, 'false');
});
