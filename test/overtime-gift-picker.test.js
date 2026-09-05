'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT_DIR = path.join(__dirname, '..');
const OVERTIME_ENTRY = path.join(
  ROOT_DIR,
  'public',
  'js',
  'admin',
  'overtime.js',
);

test('blank global activation renders the full local catalog and filters in place', async () => {
  const globalGifts = createGifts(3000);
  globalGifts[2999].name = '星光礼物 Gift 2999';
  const fixture = await createFixture({
    globalGifts,
    saleGifts: [globalGifts[0], globalGifts[1]],
    selectedGiftIds: [globalGifts[0].id],
  });

  await openPicker(fixture);
  assert.equal(optionNodes(fixture).length, 4);

  await fixture.elements.globalSearchButton.dispatchEvent('click');

  assert.equal(fixture.state.fetchCalls.length, 1);
  assert.equal(fixture.state.fetchCalls[0].url, '/api/overtime/gifts/catalog');
  assert.equal(fixture.state.fetchCalls[0].options?.method || 'GET', 'GET');
  assert.equal(fixture.state.fetchCalls[0].options?.body, undefined);
  assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');
  assert.equal(optionNodes(fixture).length, 2999);
  assert.equal(
    optionNodes(fixture).some((node) => nodeText(node).includes('Gift 0000')),
    false,
  );
  const image = fixture.elements.results.querySelector('img');
  assert.equal(image.loading, 'lazy');
  assert.equal(image.decoding, 'async');

  fixture.elements.search.value = 'gift-2999';
  await fixture.elements.search.dispatchEvent('input');
  assert.equal(optionNodes(fixture).length, 1);
  assert.match(nodeText(optionNodes(fixture)[0]), /Gift 2999/);

  for (const query of ['星光', 'gIfT 2999']) {
    fixture.elements.search.value = query;
    await fixture.elements.search.dispatchEvent('input');
    assert.equal(optionNodes(fixture).length, 1);
    assert.match(nodeText(optionNodes(fixture)[0]), /Gift 2999/);
  }

  fixture.elements.search.value = '';
  await fixture.elements.search.dispatchEvent('input');
  assert.equal(optionNodes(fixture).length, 2999);

  fixture.elements.search.value = 'gift-2998';
  const requestCount = fixture.state.fetchCalls.length;
  const globalEnter = await fixture.elements.search.dispatchEvent('keydown', {
    key: 'Enter',
  });
  assert.equal(globalEnter.defaultPrevented, true);
  assert.equal(fixture.elements.picker.open, true);
  assert.equal(fixture.state.fetchCalls.length, requestCount);
  assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');
  assert.equal(optionNodes(fixture).length, 1);

  fixture.elements.search.value = '';
  await fixture.elements.globalSearchButton.dispatchEvent('click');
  assert.equal(fixture.elements.globalSearchButton.textContent, '搜索全部礼物');
  assert.equal(optionNodes(fixture).length, 4);

  fixture.elements.search.value = 'guard';
  await fixture.elements.search.dispatchEvent('input');
  const saleRequestCount = fixture.state.fetchCalls.length;
  const saleEnter = await fixture.elements.search.dispatchEvent('keydown', {
    key: 'Enter',
  });
  assert.equal(saleEnter.defaultPrevented, true);
  assert.equal(fixture.elements.picker.open, true);
  assert.equal(fixture.state.fetchCalls.length, saleRequestCount);
  assert.equal(optionNodes(fixture).length, 3);

  await fixture.elements.globalSearchButton.dispatchEvent('click');
  fixture.elements.search.value = 'does-not-exist';
  await fixture.elements.search.dispatchEvent('input');
  assert.match(nodeText(fixture.elements.results), /全部礼物中没有匹配项/);
});

test('global picker distinguishes an unavailable cache from a valid empty cache', async () => {
  for (const scenario of [
    {
      fetchPayload: { ok: true, data: null },
      expected: /本地礼物库尚未缓存|读取本地礼物库失败/,
    },
    { fetchPayload: { ok: true, data: { gifts: [] } }, expected: /本地礼物库暂无礼物/ },
  ]) {
    const fixture = await createFixture(scenario);
    await openPicker(fixture);
    await fixture.elements.globalSearchButton.dispatchEvent('click');
    assert.match(nodeText(fixture.elements.results), scenario.expected);
    assert.equal(fixture.elements.globalSearchButton.disabled, false);
    assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');
  }
});

test('global picker shows fetch failures and can return to sale gifts', async () => {
  const fixture = await createFixture({
    fetchImpl: async () => {
      throw new Error('catalog unavailable');
    },
  });
  await openPicker(fixture);
  await fixture.elements.globalSearchButton.dispatchEvent('click');

  assert.match(nodeText(fixture.elements.results), /catalog unavailable/);
  assert.equal(fixture.elements.globalSearchButton.disabled, false);
  assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');

  await fixture.elements.globalSearchButton.dispatchEvent('click');
  assert.equal(fixture.elements.globalSearchButton.textContent, '搜索全部礼物');
  assert.ok(optionNodes(fixture).length > 0);
});

test('off-sale global gifts remain selectable and are added through the rule editor', async () => {
  const saleGifts = createGifts(1);
  const globalGifts = [...saleGifts, { id: 'gift-off-sale', name: 'Off Sale', rmb: 2 }];
  const fixture = await createFixture({ globalGifts, saleGifts });
  await openPicker(fixture);
  await fixture.elements.globalSearchButton.dispatchEvent('click');

  fixture.elements.search.value = 'gift-off-sale';
  await fixture.elements.search.dispatchEvent('input');
  assert.equal(optionNodes(fixture).length, 1);
  await optionNodes(fixture)[0].dispatchEvent('click');

  assert.equal(fixture.state.addedGifts[0].id, 'gift-off-sale');
  assert.equal(fixture.elements.picker.open, false);
});

test('reopening the picker invalidates a pending global catalog response', async () => {
  const pending = deferred();
  const newerPending = deferred();
  let catalogRequestCount = 0;
  const fixture = await createFixture({
    globalGifts: [{ id: 'stale-gift', name: 'Stale Gift', rmb: 1 }],
    saleGifts: [{ id: 'current-sale-gift', name: 'Current Sale Gift', rmb: 1 }],
    fetchImpl: () =>
      catalogRequestCount++ === 0 ? pending.promise : newerPending.promise,
  });
  await openPicker(fixture);

  const loading = fixture.elements.globalSearchButton.dispatchEvent('click');
  await flush();
  assert.equal(fixture.elements.globalSearchButton.disabled, true);
  assert.match(nodeText(fixture.elements.results), /正在读取本地礼物库/);

  fixture.elements.picker.close();
  fixture.namespace.openGiftPicker();
  await flush();
  assert.equal(fixture.elements.globalSearchButton.disabled, false);
  assert.equal(fixture.elements.globalSearchButton.textContent, '搜索全部礼物');
  assert.ok(optionNodes(fixture).length > 0);

  const newerLoading = fixture.elements.globalSearchButton.dispatchEvent('click');
  await flush();
  assert.equal(fixture.elements.globalSearchButton.disabled, true);

  pending.resolve({
    ok: true,
    payload: { ok: true, data: { gifts: [{ id: 'stale-gift', name: 'Stale Gift', rmb: 1 }] } },
  });
  await loading;
  await flush();

  assert.equal(fixture.elements.globalSearchButton.disabled, true);
  assert.match(nodeText(fixture.elements.results), /正在读取本地礼物库/);

  newerPending.resolve({
    ok: true,
    payload: {
      ok: true,
      data: { gifts: [{ id: 'newer-gift', name: 'Newer Gift', rmb: 1 }] },
    },
  });
  await newerLoading;
  await flush();

  assert.equal(fixture.elements.globalSearchButton.textContent, '返回在售礼物');
  assert.ok(optionNodes(fixture).length > 0);
  assert.equal(nodeText(fixture.elements.results).includes('Stale Gift'), false);
  assert.match(nodeText(fixture.elements.results), /Newer Gift/);
});

async function createFixture({
  globalGifts = createGifts(3),
  saleGifts = globalGifts.slice(0, 2),
  selectedGiftIds = [],
  fetchPayload = {
    ok: true,
    data: { gifts: globalGifts },
  },
  fetchImpl = null,
} = {}) {
  const document = createFakeDocument();
  const window = { AdminApp: {} };
  const state = {
    fetchCalls: [],
    apiCalls: [],
    addedGifts: [],
    fetchImpl:
      fetchImpl ||
      (() => Promise.resolve({ ok: true, payload: fetchPayload })),
  };
  const namespace = await loadOvertimeModule({ document, window, state, saleGifts });
  const rules = document.getElementById('overtimeRules');
  for (const id of selectedGiftIds) {
    const row = document.createElement('article');
    row.dataset.overtimeRule = 'true';
    row.dataset.giftId = String(id);
    rules.append(row);
  }
  namespace.applyGiftCatalog({
    refreshedAt: '2026-09-05T00:00:00.000Z',
    gifts: saleGifts,
  });
  namespace.init();
  await flush();
  return {
    namespace,
    state,
    document,
    elements: {
      picker: document.getElementById('overtimeGiftPicker'),
      search: document.getElementById('overtimeGiftSearch'),
      results: document.getElementById('overtimeGiftResults'),
      globalSearchButton: document.getElementById('overtimeGlobalGiftSearchBtn'),
    },
  };
}

async function loadOvertimeModule({ document, window, state, saleGifts }) {
  const context = vm.createContext({
    console,
    document,
    window,
    fetch: (url, options) => {
      if (url === '/api/overtime/gifts/catalog') {
        state.fetchCalls.push({ url, options });
        return state.fetchImpl(url, options);
      }
      if (url === '/api/overtime/gifts')
        return Promise.resolve({
          ok: true,
          payload: {
            ok: true,
            data: { gifts: saleGifts, refreshedAt: '2026-09-05T00:00:00.000Z' },
          },
        });
      if (url === '/api/overtime')
        return Promise.resolve({
          ok: true,
          payload: { ok: true, data: { settlements: [] } },
        });
      throw new Error(`Unexpected overtime request: ${url}`);
    },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    __testDocument: document,
    __testApi: async (url, body) => {
      state.apiCalls.push({ url, body });
      return { data: { gifts: saleGifts, refreshedAt: '2026-09-05T00:00:00.000Z' } };
    },
    __testReadJsonResponse: async (response) => response.payload,
    __testShowError: (error) => {
      state.lastError = error;
    },
    __testAddedGifts: state.addedGifts,
    __testEventBus: { on() {} },
    __testEvents: {},
  });
  const source = `${fs.readFileSync(OVERTIME_ENTRY, 'utf8')}\nexport { init, applyGiftCatalog, openGiftPicker };`;
  const entryUrl = pathToFileURL(OVERTIME_ENTRY).href;
  const module = new vm.SourceTextModule(source, {
    context,
    identifier: entryUrl,
  });
  const stubs = {
    '../shared/event-bus.js': new vm.SourceTextModule(
      'export const eventBus = globalThis.__testEventBus; export const Events = globalThis.__testEvents;',
      { context, identifier: `${entryUrl}?event-bus` },
    ),
    '../shared/utils.js': new vm.SourceTextModule(
      [
        'export const api = (...args) => globalThis.__testApi(...args);',
        'export const copyText = async () => {};',
        'export const localOverlayOrigin = () => "http://127.0.0.1";',
        'export const readJsonResponse = (...args) => globalThis.__testReadJsonResponse(...args);',
        'export const showError = (error) => globalThis.__testShowError(error);',
        'export const toast = () => {};',
      ].join('\n'),
      { context, identifier: `${entryUrl}?utils` },
    ),
    './overtime-rule-editor.js': new vm.SourceTextModule(
      [
        'export function createOvertimeRuleEditor(root) {',
        '  return {',
        '    setLimits() {},',
        '    renderRules() {},',
        '    readRules() { return []; },',
        '    createRule(gift) {',
        '      globalThis.__testAddedGifts.push({ ...gift });',
        '      const row = globalThis.__testDocument.createElement("article");',
        '      row.dataset.overtimeRule = "true";',
        '      row.dataset.giftId = String(gift.id);',
        '      row.scrollIntoView = () => {};',
        '      root.append(row);',
        '      return row;',
        '    },',
        '  };',
        '}',
      ].join('\n'),
      { context, identifier: `${entryUrl}?rule-editor` },
    ),
    './overtime-time-view.js': new vm.SourceTextModule(
      [
        'export function createOvertimeTimeView() {',
        '  return {',
        '    renderSettlements() {},',
        '    populateInitialDurationSelectors() {},',
        '    syncDurationSelectorsFromInput() {},',
        '    syncDurationInputFromSelectors() {},',
        '    renderInitialDuration() {},',
        '    parseInitialDuration() { return 0; },',
        '    formatClockDisplay() { return ""; },',
        '  };',
        '}',
      ].join('\n'),
      { context, identifier: `${entryUrl}?time-view` },
    ),
    './overtime-status-view.js': new vm.SourceTextModule(
      [
        'export function createOvertimeStatusView() {',
        '  return {',
        '    renderState() {},',
        '    syncClockLoop() {},',
        '    stopClockLoop() {},',
        '    getState() { return null; },',
        '  };',
        '}',
      ].join('\n'),
      { context, identifier: `${entryUrl}?status-view` },
    ),
  };

  await module.link((specifier) => {
    const dependency = stubs[specifier];
    if (!dependency) throw new Error(`Unexpected overtime dependency: ${specifier}`);
    return dependency;
  });
  await module.evaluate();
  return module.namespace;
}

function createGifts(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `gift-${String(index).padStart(4, '0')}`,
    name: `Gift ${String(index).padStart(4, '0')}`,
    rmb: (index % 10) + 1,
  }));
}

function createFakeDocument() {
  const elements = new Map();
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      if (!elements.has(id)) {
        const node = new FakeElement('div', document);
        node.id = id;
        elements.set(id, node);
      }
      return elements.get(id);
    },
    addEventListener() {},
  };
  const picker = document.getElementById('overtimeGiftPicker');
  picker.showModal = () => {
    picker.open = true;
  };
  picker.close = () => {
    picker.open = false;
  };
  return document;
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.parentNode = null;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
    };
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!node) continue;
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatchEvent(type, event = {}) {
    let defaultPrevented = false;
    const dispatchedEvent = {
      ...event,
      target: this,
      preventDefault() {
        defaultPrevented = true;
      },
    };
    const results = [];
    for (const listener of this.listeners.get(type) || [])
      results.push(listener(dispatchedEvent));
    await Promise.all(results);
    return { defaultPrevented };
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (matchesSelector(child, selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  scrollIntoView() {}
}

function matchesSelector(node, selector) {
  const simple = selector.trim().split(/\s+/).at(-1);
  if (simple.startsWith('.'))
    return simple
      .slice(1)
      .split('.')
      .every((name) => node.className.split(/\s+/).includes(name));
  if (simple === 'img') return node.tagName === 'img';
  const attribute = simple.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
  if (!attribute) return false;
  const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return (
    Object.prototype.hasOwnProperty.call(node.dataset, key) &&
    (attribute[2] === undefined || node.dataset[key] === attribute[2])
  );
}

function optionNodes(fixture) {
  return fixture.elements.results.querySelectorAll('.overtime-gift-option');
}

function nodeText(node) {
  return `${node.textContent || ''}${(node.children || []).map(nodeText).join('')}`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function openPicker(fixture) {
  fixture.namespace.openGiftPicker();
  await flush();
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}
