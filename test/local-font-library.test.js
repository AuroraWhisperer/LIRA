'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

function createNode(tagName) {
  return {
    tagName: String(tagName || '').toUpperCase(),
    children: [],
    dataset: {},
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    }
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
    if (selector !== 'optgroup[data-local-fonts="true"]') return null;
    return select.children.find((child) => child.dataset?.localFonts === 'true') || null;
  };
  Object.defineProperty(select, 'options', {
    get() {
      return this.children.flatMap((child) => child.tagName === 'OPTGROUP' ? child.children : [child]);
    }
  });
  return select;
}

test('shared local font library queries once and populates both registered selectors', async () => {
  let queryCount = 0;
  const createElement = (tagName) => createNode(tagName);
  const illustratedSelect = createSelect('default', [
    { value: 'default', label: '跟随每种风格默认字体' },
    { value: 'Microsoft YaHei, PingFang SC, sans-serif', label: '微软雅黑 · 清晰' }
  ]);
  const lyricSelect = createSelect('Microsoft YaHei', [
    { value: 'Microsoft YaHei', label: '微软雅黑（默认）' }
  ]);
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
          { family: '' }
        ];
      }
    }
  };
  const library = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'local-font-library.js'),
    sandbox
  );

  library.registerLocalFontSelect(illustratedSelect);
  library.registerLocalFontSelect(lyricSelect);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(queryCount, 1);
  for (const select of [illustratedSelect, lyricSelect]) {
    const group = select.querySelector('optgroup[data-local-fonts="true"]');
    assert.equal(group.label, '本机字体');
    assert.deepEqual(group.children.map((option) => option.textContent), ['Arial', 'Cascadia Code']);
    assert.deepEqual(group.children.map((option) => option.value), ['"Arial"', '"Cascadia Code"']);
  }
  assert.equal(illustratedSelect.value, 'default');
  assert.equal(lyricSelect.value, 'Microsoft YaHei');
});

test('shared local font library preserves a saved option missing from the current machine', async () => {
  const select = createSelect('default', [
    { value: 'default', label: '跟随每种风格默认字体' }
  ]);
  const sandbox = {
    console,
    document: { createElement: (tagName) => createNode(tagName) },
    window: {}
  };
  const library = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'local-font-library.js'),
    sandbox
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
  const select = createSelect('default', [
    { value: 'default', label: '跟随每种风格默认字体' }
  ]);
  let queryCount = 0;
  const sandbox = {
    console,
    document: { createElement: (tagName) => createNode(tagName) },
    window: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
      queryLocalFonts() {
        queryCount += 1;
        if (queryCount === 1) {
          const error = new Error('User activation required');
          error.name = 'SecurityError';
          throw error;
        }
        return Promise.resolve([{ family: 'Cascadia Code' }]);
      }
    }
  };
  const library = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'local-font-library.js'),
    sandbox
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
    ['Cascadia Code']
  );
});
