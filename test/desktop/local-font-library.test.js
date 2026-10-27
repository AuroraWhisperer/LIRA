'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

function createNode(tagName) {
  return {
    tagName: String(tagName || '').toUpperCase(),
    children: [],
    dataset: {},
    prepend(child) { child.parentNode = this; this.children.unshift(child); },
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

function createSelect(value, builtIns) {
  const select = createNode('select');
  builtIns.forEach(({ value: optionValue, label }) => {
    const option = createNode('option');
    option.value = optionValue;
    option.textContent = label;
    select.appendChild(option);
  });
  select.value = value;
  select.querySelector = (selector) => {
    const key = selector === 'optgroup[data-local-fonts="true"]' ? 'localFonts'
      : selector === 'optgroup[data-shared-fonts]' ? 'sharedFonts' : null;
    return key && select.children.find((child) => child.dataset?.[key] === 'true') || null;
  };
  Object.defineProperty(select, 'options', {
    get() {
      return this.children.flatMap((child) => (child.tagName === 'OPTGROUP' ? child.children : [child]));
    },
  });
  return select;
}

test('shared local font library queries once for queue, desktop lyric and large player selectors', async () => {
  let queryCount = 0;
  const createElement = (tagName) => createNode(tagName);
  const illustratedSelect = createSelect('default', [
    { value: 'default', label: '幼圆' },
    {
      value: 'Microsoft YaHei, PingFang SC, sans-serif',
      label: '微软雅黑 · 清晰',
    },
  ]);
  const lyricSelect = createSelect('Microsoft YaHei', [{ value: 'Microsoft YaHei', label: '微软雅黑（默认）' }]);
  const playerSelect = createSelect('maiyuan', [{ value: 'maiyuan', label: '荆南麦圆' }]);
  const sandbox = {
    console,
    document: { createElement },
    window: {
      addEventListener() {},
      async queryLocalFonts() {
        queryCount += 1;
        return [
          { family: 'Microsoft YaHei' },
          { family: ' Cascadia Code ' },
          { family: 'Arial' },
          { family: 'arial' },
          { family: '' },
        ];
      },
    },
  };
  const library = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'local-font-library.js'),
    sandbox,
  );

  library.registerLocalFontSelect(illustratedSelect);
  library.registerLocalFontSelect(lyricSelect);
  library.registerLocalFontSelect(playerSelect);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(queryCount, 1);
  for (const select of [illustratedSelect, lyricSelect]) {
    const group = select.querySelector('optgroup[data-local-fonts="true"]');
    assert.equal(group.label, '本机字体');
    assert.deepEqual(
      group.children.map((option) => option.textContent),
      ['Arial', 'Cascadia Code'],
    );
    assert.deepEqual(
      group.children.map((option) => option.value),
      ['"Arial"', '"Cascadia Code"'],
    );
  }
  assert.equal(illustratedSelect.value, 'default');
  assert.equal(lyricSelect.value, 'Microsoft YaHei');
  assert.equal(playerSelect.value, 'maiyuan');
  assert.deepEqual(playerSelect.querySelector('optgroup[data-local-fonts="true"]').children.map((option) => option.textContent),
    ['Arial', 'Cascadia Code', 'Microsoft YaHei']);
});

test('shared display fonts keep legacy selections without duplicate options or local-font queries', async () => {
  let queries = 0;
  const fonts = require('../../src/fonts/catalog.json').fonts;
  const faces = fonts.map(font => ({ family: font.family, status: 'loaded' }));
  faces.load = async descriptor => faces.filter(face => descriptor.includes(`"${face.family}"`));
  const library = await loadModuleExports(path.join(ROOT_DIR, 'public/js/shared/font-library.js'), {
    document: { createElement: createNode, fonts: faces }, console,
    window: { queryLocalFonts: async () => { queries++; return [{ family: 'Custom Local' }, { family: 'Long'.repeat(30) }]; } },
  });
  const selections = ['maiyuan', 'Lira Smiley', '"月渡花汀文楷"', '"Unavailable Font"'];
  for (const saved of selections) {
    const select = createSelect(saved, [{ value: saved, label: '旧设置' }]);
    const unregister = library.registerFontSelect(select, { maxLength: 80 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(select.value, saved);
    const group = select.querySelector('optgroup[data-shared-fonts]');
    assert.deepEqual(group.children.map(option => option.dataset.fontId), fonts.map(font => font.id));
    const selected = select.options.find(option => option.value === saved);
    let valueWrites = 0;
    Object.defineProperty(selected, 'value', {
      get: () => saved,
      set() { valueWrites++; },
    });
    library.ensureSavedFontOption(select, saved);
    assert.equal(valueWrites, 0, 'An unchanged font must not rebuild the open menu during focusout.');
    library.populateSharedFontOptions(select);
    assert.equal(select.value, saved);
    assert.equal(select.children.filter(child => child.dataset.sharedFonts).length, 1);
    assert.equal(new Set(select.options.map(option => option.value)).size, select.options.length);
    assert.equal(select.querySelector('optgroup[data-local-fonts="true"]').children.length, 1);
    unregister();
  }
  assert.equal(queries, 1);
});

test('shared font menus exclude missing, loading and failed faces, then add decoded fonts without changing selection', async () => {
  const pending = Promise.withResolvers();
  const readyFace = { family: 'Lira Maiyuan', status: 'loading' };
  const failedFace = { family: 'Lira Kuaile', status: 'error' };
  const faces = [readyFace, failedFace];
  let loads = 0;
  faces.load = descriptor => {
    loads++;
    return descriptor.includes('Lira Maiyuan') ? pending.promise : Promise.reject(new Error('decode failed'));
  };
  const library = await loadModuleExports(path.join(ROOT_DIR, 'public/js/shared/font-library.js'), {
    document: { createElement: createNode, fonts: faces }, window: {},
  });
  const saved = createSelect('maiyuan', [{ value: 'default', label: '默认字体' }, { value: 'maiyuan', label: '旧设置' }]);
  const fresh = createSelect('default', [{ value: 'default', label: '默认字体' }]);
  const disposeSaved = library.registerFontSelect(saved);
  const disposeFresh = library.registerFontSelect(fresh);
  assert.equal(loads, 2, 'Selectors share each font load.');
  assert.equal(saved.querySelector('optgroup[data-shared-fonts]'), null);
  assert.equal(fresh.querySelector('optgroup[data-shared-fonts]'), null);
  assert.equal(saved.value, 'maiyuan');
  assert.equal(saved.options.find(option => option.value === 'maiyuan').disabled, true);
  assert.match(saved.options.find(option => option.value === 'maiyuan').textContent, /未就绪/);
  readyFace.status = 'loaded';
  pending.resolve([readyFace]);
  await new Promise(resolve => setImmediate(resolve));
  for (const select of [saved, fresh]) {
    const group = select.querySelector('optgroup[data-shared-fonts]');
    assert.deepEqual(group.children.map(option => option.dataset.fontId), ['maiyuan']);
    assert.ok(!group.children[0].disabled);
    assert.doesNotMatch(group.children[0].textContent, /未就绪/);
  }
  assert.equal(saved.value, 'maiyuan');
  assert.equal(fresh.value, 'default');
  const replacement = { family: 'Lira Smiley', status: 'loaded' };
  faces.splice(0, faces.length, replacement);
  faces.load = async () => { loads++; return [replacement]; };
  library.refreshSharedFonts();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads, 3);
  assert.deepEqual(fresh.querySelector('optgroup[data-shared-fonts]').children.map(option => option.dataset.fontId), ['smiley']);
  assert.equal(saved.value, 'maiyuan');
  assert.equal(saved.options.find(option => option.value === 'maiyuan').disabled, true);
  disposeSaved();
  disposeFresh();
  faces.splice(0, faces.length, readyFace);
  library.refreshSharedFonts();
  assert.equal(loads, 3, 'Disposed selectors do not trigger font loads after stylesheet changes.');
});

test('shared local font library preserves a saved option missing from the current machine', async () => {
  const select = createSelect('default', [{ value: 'default', label: '幼圆' }]);
  const sandbox = {
    console,
    document: { createElement: (tagName) => createNode(tagName) },
    window: {},
  };
  const library = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'local-font-library.js'),
    sandbox,
  );

  library.ensureSavedFontOption(select, '"Example Local Font"');
  library.ensureSavedFontOption(select, '"Example Local Font"');

  assert.equal(select.options.length, 2);
  assert.equal(select.options[1].value, '"Example Local Font"');
  assert.equal(select.options[1].textContent, 'Example Local Font（当前设置）');
  assert.equal(select.options[1].dataset.savedLocalFont, 'true');
});

test('shared local font library retries a security error after the first user gesture', async () => {
  const listeners = new Map();
  const select = createSelect('default', [{ value: 'default', label: '幼圆' }]);
  let queryCount = 0;
  const sandbox = {
    console,
    document: { createElement: (tagName) => createNode(tagName) },
    window: {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      removeEventListener(type) {
        listeners.delete(type);
      },
      queryLocalFonts() {
        queryCount += 1;
        if (queryCount === 1) {
          const error = new Error('User activation required');
          error.name = 'SecurityError';
          throw error;
        }
        return Promise.resolve([{ family: 'Cascadia Code' }]);
      },
    },
  };
  const library = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'local-font-library.js'),
    sandbox,
  );

  library.registerLocalFontSelect(select);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queryCount, 1);
  assert.equal(typeof listeners.get('pointerdown'), 'function');

  listeners.get('pointerdown')();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(queryCount, 2);
  assert.deepEqual(
    select.querySelector('optgroup[data-local-fonts="true"]').children.map((option) => option.textContent),
    ['Cascadia Code'],
  );
});
