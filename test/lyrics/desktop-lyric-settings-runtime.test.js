'use strict';

const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { readCssBundle } = require('../helpers/css-bundle');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

function readDesktopLyricHtml() {
  return readAdminFragmentHtml('pages/admin/song/desktop-lyric.html');
}

test('desktop lyric settings automatically list local font families and preserve denial state', async () => {
  const form = { addEventListener() {} };
  const select = {
    value: 'Microsoft YaHei',
    children: [],
    replaceChildren(...children) {
      this.children = [];
      children.forEach(child => this.appendChild(child));
      this.value = children[0]?.value || '';
    },
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
      return this.children.flatMap(child => child.tagName === 'OPTION' ? [child] : child.children || []);
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
  assert.equal(select.value, 'Lira Maiyuan');
  assert.equal(new Set(select.options.map(option => option.value)).size, select.options.length);
});

test('desktop lyric local font detection keeps built-ins when permission is denied', async () => {
  const form = { addEventListener() {} };
  const select = {
    value: 'Microsoft YaHei',
    children: [],
    replaceChildren(...children) {
      this.children = children;
      this.value = children[0]?.value || '';
    },
    querySelector() {
      return null;
    },
    get options() {
      return this.children;
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
      createElement: () => ({}),
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
  assert.equal(select.value, 'Lira Maiyuan');
  assert.ok(select.options.some(option => option.value === 'Lira Kuaile'));
  assert.ok(select.options.some(option => option.value === 'Lira Smiley'));
  assert.ok(select.options.some(option => option.value === 'Lira Xiaolai'));
  assert.ok(select.options.some(option => option.value === 'Lira Assorted'));
  assert.ok(select.options.every(option => !/内置|推荐|（默认）/.test(option.textContent)));
  assert.equal(new Set(select.options.map(option => option.value)).size, select.options.length);
  assert.equal(select.querySelector('optgroup[data-local-fonts="true"]'), null);
});

test('desktop lyric fonts route complex scripts and automatically fill gaps before legacy and system fallback', async () => {
  const { applyDesktopLyricStyles } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-styles.js'),
  );
  const { DESKTOP_LYRIC_DEFAULTS } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-defaults.js'),
  );
  const { normalizeDesktopLyricSettings } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-settings.js'),
  );
  const properties = new Map();
  const card = { style: { setProperty: (name, value) => properties.set(name, value) }, classList: { toggle() {} } };
  for (const [selected, primary, generic] of [
    ['Lira Maiyuan', 'Lira Maiyuan', 'sans-serif'],
    ['KaiTi, STKaiti, serif', 'KaiTi, STKaiti', 'serif'],
    ['Courier New, Consolas, monospace', 'Courier New, Consolas', 'monospace'],
    ['"Local Font", sans-serif', '"Local Font"', 'sans-serif'],
  ]) {
    const values = normalizeDesktopLyricSettings({ desktopLyricFontFamily: selected,
      desktopLyricFallbackFontFamily: 'Legacy Font' }, DESKTOP_LYRIC_DEFAULTS);
    applyDesktopLyricStyles(card, values);
    const stack = properties.get('--preview-font');
    assert.ok(stack.startsWith(`"Lira Lyric Scripts", ${primary}, "Lira Lyric Korean", "Lira Xiaolai", "Lira Lyric Extended", Legacy Font,`));
    assert.ok(stack.endsWith(`system-ui, ${generic}`));
    assert.equal(values.fontFamily, selected, 'Rendering does not change the saved font choice.');
  }
});

test('desktop lyric preview keeps accessible controls and shared renderer wiring', () => {
  const html = readDesktopLyricHtml();
  const settingsSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric.js'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'desktop-lyric-preview.js'), 'utf8');
  const rendererSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-renderer.js'),
    'utf8',
  );
  const sharedRenderer = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'lyric-word-renderer.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'desktop-lyric-preview.css');
  const workspaceStyles = readCssBundle('public', 'css', 'admin', 'workspace', 'song.css');

  assert.match(html, /id="desktopLyricAutosaveState"/);
  assert.match(html, /<[^>]+(?=[^>]*\sid=["']desktopLyricForm["'])(?=[^>]*\saria-labelledby=["']desktopLyricSettingsTitle["'])[^>]*>/);
  assert.match(html, /\sid=["']desktopLyricLivePreview["']/);
  assert.match(html, /<[^>]+(?=[^>]*\sid=["']desktopLyricPreviewViewport["'])(?=[^>]*\stabindex=["']0["'])[^>]*>/);
  assert.match(html, /id="desktopLyricPreviewTimeline"/);
  assert.match(html, /<[^>]+(?=[^>]*\sid=["']desktopLyricPreviewPlayback["'])(?=[^>]*\saria-live=["']polite["'])[^>]*>/);
  assert.doesNotMatch(html, /desktopLyricPreviewProgress|desktop-lyric-preview-progress/);
  assert.match(html, /<button\b(?=[^>]*\sid=["']desktopLyricCopyUrlBtn["'])(?=[^>]*\stype=["']button["'])[^>]*>/);
  assert.match(html, /data-lyric-preview-background="grid"/);
  assert.match(rendererSource, /new LyricWordRenderer/);
  assert.match(source, /app:lyric-state/);
  assert.match(source, /app:lyric-timeline/);
  assert.match(rendererSource, /textContent\s*=/);
  assert.doesNotMatch(rendererSource, /innerHTML\s*=/);
  assert.match(source, /await copyText\(desktopLyricUrl\)/);
  assert.doesNotMatch(source, /navigator\.clipboard\.writeText\(desktopLyricUrl\)/);
  assert.match(source, /`\$\{localOverlayOrigin\(location\)\}\/lyrics`/);
  assert.doesNotMatch(source, /musicAPI\.openLyricWindow|desktopLyricOpenWindowBtn/);
  assert.match(sharedRenderer, /element\.textContent = word\.text/);
  assert.match(sharedRenderer, /requestAnimationFrame/);
  assert.match(styles, /--preview-word-progress/);
  assert.match(styles, /\.desktop-lyric-preview-stage\.is-solid/);
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
    /@media \(max-width:\s*[\d.]+px\)[\s\S]*?\.desktop-lyric-settings\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/,
  );
  assert.match(styles, /\.desktop-lyric-preview-row\.is-active/);
  assert.match(styles, /\.desktop-lyric-preview-countdown-dot/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(rendererSource, /requestAnimationFrame\(animateLyricFollow\)/);
  assert.match(rendererSource, /addEventListener\(["']pointerdown["'], pauseAutomaticFollow/);
  assert.doesNotMatch(rendererSource, /behavior:\s*['"]smooth['"]/);
  assert.doesNotMatch(rendererSource, /scrollIntoView/);
  assert.match(styles, /\.desktop-lyric-preview-viewport\.is-following/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-translation-hidden/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-hide-passed/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-paused-hidden/);
  assert.match(styles, /\.desktop-lyric-preview-card\.is-background-enabled/);
  assert.match(styles, /--preview-global-opacity/);
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
  let confirmReset = false;
  const values = {
    desktopLyricFontFamily: 'Microsoft YaHei',
    desktopLyricFontWeight: '800',
    desktopLyricTextColor: '#123456',
    desktopLyricSungColor: '#ff220080',
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
  elements.set('desktopLyricSungColorInherited', { checked: true });
  elements.get('desktopLyricFontFamily').replaceChildren = function (...options) { this.options = options; };
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
      createElement: () => ({}),
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
          dangerConfirm: async () => confirmReset,
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
  assert.equal(apiCalls[0].body.desktopLyricSungColor, '#ff220080');
  assert.equal(apiCalls[0].body.desktopLyricTextColor, '#123456');
  assert.equal(elements.get('desktopLyricSungColorInherited').checked, false);
  assert.equal(elements.get('desktopLyricSungColor').disabled, false);
  assert.equal(apiCalls[0].body.desktopLyricFontFamily, 'Microsoft YaHei', 'An explicitly saved font is preserved.');
  assert.equal(Object.hasOwn(apiCalls[0].body, 'desktopLyricFallbackFontFamily'), false,
    'Changing visible settings must not overwrite the retired fallback field.');

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
  elements.get('desktopLyricSungColorInherited').checked = true;
  elements.get('desktopLyricTextColor').value = '#abcdef80';
  listeners.get('change')();
  assert.equal(apiCalls.length, 1, 'a second write waits for the in-flight request');
  resolveFirstSave({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[0].url, '/api/settings');
  assert.equal(apiCalls[1].body.desktopLyricFontSize, '64');
  assert.equal(apiCalls[1].body.desktopLyricSungColor, '');
  assert.equal(apiCalls[1].body.desktopLyricTextColor, '#abcdef80');
  assert.equal(apiCalls[1].body.weSingLyricSource, 'qq');
  assert.equal(apiCalls[1].body.weSingSmartLyricMatch, 'false');
  assert.equal(autosaveState.textContent, '已自动保存');
  assert.match(autosaveState.className, /is-saved/);

  await new Promise((resolve) => setImmediate(resolve));
  await resetListeners.get('click')();
  assert.equal(apiCalls.length, 2, 'cancelled reset keeps the saved settings');
  confirmReset = true;
  await resetListeners.get('click')();
  assert.equal(apiCalls.length, 3);
  assert.equal(apiCalls[2].body.desktopLyricFontSize, '56');
  assert.equal(apiCalls[2].body.desktopLyricFontFamily, 'Lira Maiyuan');
  assert.equal(apiCalls[2].body.desktopLyricCurrentLineEnhanced, 'false');
  assert.equal(apiCalls[2].body.desktopLyricSungColor, '');
  assert.equal(apiCalls[2].body.desktopLyricTextColor, '#000000');
  assert.equal(elements.get('desktopLyricSungColor').disabled, true);
  assert.equal(apiCalls[2].body.weSingLyricSource, 'qq');
  assert.equal(apiCalls[2].body.weSingSmartLyricMatch, 'false');
});
