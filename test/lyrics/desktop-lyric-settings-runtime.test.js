'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

function createFontNode(tagName = 'select') {
  return {
    tagName: tagName.toUpperCase(), children: [], dataset: {}, value: '', textContent: '',
    prepend(child) { child.parentNode = this; this.children.unshift(child); },
    insertBefore(child, reference) {
      child.remove();
      child.parentNode = this;
      this.children.splice(reference ? this.children.indexOf(reference) : this.children.length, 0, child);
      return child;
    },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    replaceChildren(...children) {
      this.children = []; children.forEach(child => this.appendChild(child));
      this.value = children[0]?.value || '';
    },
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    },
    querySelector(selector) {
      const key = selector.includes('data-local-fonts') ? 'localFonts'
        : selector.includes('data-saved-fonts') ? 'savedFonts' : 'sharedFonts';
      return this.children.find(child => child.dataset[key] === 'true') || null;
    },
    get options() { return this.children.flatMap(child => child.tagName === 'OPTGROUP' ? child.children : [child]); },
  };
}

test('desktop lyric settings automatically list local font families and preserve denial state', async () => {
  const form = { addEventListener() {} };
  const select = createFontNode();
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
      createElement: createFontNode,
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
  assert.deepEqual(
    localGroup.children.map((option) => option.value),
    ['"Arial"', '"Cascadia Code"', '"宋体"'],
  );
  assert.equal(new Set(select.options.map(option => option.value)).size, select.options.length);
});

test('desktop lyric local font detection keeps built-ins when permission is denied', async () => {
  const faces = require('../../src/fonts/catalog.json').fonts.map(font => ({ family: font.family, status: 'loaded' }));
  faces.load = async descriptor => faces.filter(face => descriptor.includes(`"${face.family}"`));
  const form = { addEventListener() {} };
  const select = createFontNode();
  const elements = new Map([
    ['desktopLyricForm', form],
    ['desktopLyricFontFamily', select],
  ]);
  let queryCount = 0;
  const sandbox = {
    console: { ...console, warn() {} },
    document: {
      createElement: createFontNode,
      fonts: faces,
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
  assert.ok(select.options.some(option => option.value === '"Lira Kuaile"'));
  assert.equal(new Set(select.options.map(option => option.value)).size, select.options.length);
  assert.equal(select.querySelector('optgroup[data-local-fonts="true"]'), null);
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
  elements.set('desktopLyricFontFamily', Object.assign(createFontNode(), { value: values.desktopLyricFontFamily }));
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
      createElement: createFontNode,
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
  windowListeners.get('app:settings-state')({
    detail: {
      ...values,
      weSingLyricSource: 'netease',
      weSingSmartLyricMatch: 'true',
    },
  });
  scheduledTimer.callback();
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].body.weSingLyricSource, 'netease');
  assert.equal(apiCalls[0].body.weSingSmartLyricMatch, 'true');
  assert.equal(apiCalls[0].body.desktopLyricTextAlign, 'justify');
  assert.equal(apiCalls[0].body.desktopLyricSungColor, '#ff220080');
  assert.equal(apiCalls[0].body.desktopLyricTextColor, '#123456');
  assert.equal(elements.get('desktopLyricSungColorInherited').checked, false);
  assert.equal(apiCalls[0].body.desktopLyricFontFamily, 'Microsoft YaHei', 'An explicitly saved font is preserved.');
  assert.equal(Object.hasOwn(apiCalls[0].body, 'desktopLyricFallbackFontFamily'), false,
    'Changing visible settings must not overwrite the retired fallback field.');

  lyricSourceInputs[0].checked = false;
  lyricSourceInputs[1].checked = true;
  smartLyricMatch.checked = false;
  listeners.get('change')();
  windowListeners.get('app:settings-state')({ detail: { ...values,
    weSingLyricSource: 'netease', weSingSmartLyricMatch: 'true' } });
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

  await new Promise((resolve) => setImmediate(resolve));
  await resetListeners.get('click')();
  assert.equal(apiCalls.length, 2, 'cancelled reset keeps the saved settings');
  confirmReset = true;
  await resetListeners.get('click')();
  assert.equal(apiCalls.length, 3);
  const { DESKTOP_LYRIC_DEFAULTS } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-defaults.js'),
  );
  assert.equal(apiCalls[2].body.desktopLyricFontSize, DESKTOP_LYRIC_DEFAULTS.desktopLyricFontSize);
  assert.equal(apiCalls[2].body.weSingLyricSource, 'qq');
  assert.equal(apiCalls[2].body.weSingSmartLyricMatch, 'false');
});
