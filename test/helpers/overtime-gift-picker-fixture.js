'use strict';

// VM harness for public/js/admin/overtime.js gift picker with a minimal fake DOM.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const OVERTIME_ENTRY = path.join(__dirname, '..', '..', 'public', 'js', 'admin', 'overtime.js');

async function createFixture({
  globalGifts = createGifts(3),
  saleGifts = globalGifts.slice(0, 2),
  selectedGiftIds = [],
  fetchPayload = {
    ok: true,
    data: { gifts: globalGifts },
  },
  fetchImpl = null,
  initialState = {},
  confirmImpl = async () => true,
  parsedDuration = 0,
} = {}) {
  const document = createFakeDocument();
  const window = { AdminApp: {} };
  const state = {
    fetchCalls: [],
    apiCalls: [],
    addedGifts: [],
    confirmationCalls: [],
    confirmImpl,
    parsedDuration,
    overtimeState: initialState.overtime || null,
    fetchImpl: fetchImpl || (() => Promise.resolve({ ok: true, payload: fetchPayload })),
  };
  const namespace = await loadOvertimeModule({
    document,
    window,
    state,
    saleGifts,
  });
  const rules = document.getElementById('overtimeRules');
  for (const id of selectedGiftIds) {
    const row = document.createElement('article');
    row.dataset.overtimeRule = 'true';
    row.dataset.giftId = String(id);
    const identity = document.createElement('span');
    identity.className = 'overtime-rule-identity';
    row.append(identity);
    rules.append(row);
  }
  namespace.applyGiftCatalog({
    refreshedAt: '2026-09-05T00:00:00.000Z',
    gifts: saleGifts,
  });
  namespace.initOvertime(initialState);
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
  });
  const source = `${fs.readFileSync(OVERTIME_ENTRY, 'utf8')}
    const { applyGiftCatalog, applyServerGiftArtwork, open: openGiftPicker } = giftPicker;
    export { applyGiftCatalog, applyServerGiftArtwork, openGiftPicker };`;
  const entryUrl = pathToFileURL(OVERTIME_ENTRY).href;
  const module = new vm.SourceTextModule(source, {
    context,
    identifier: entryUrl,
  });
  function stub(exports) {
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      },
      { context },
    );
  }
  const dependencies = {
    '../shared/event-bus.js': stub({ eventBus: { on() {} }, Events: {} }),
    '../shared/utils.js': stub({
      async api(url, body) {
        state.apiCalls.push({ url, body });
        return {
          data: { gifts: saleGifts, refreshedAt: '2026-09-05T00:00:00.000Z' },
        };
      },
      copyText: async () => {},
      localOverlayOrigin: () => 'http://127.0.0.1',
      readJsonResponse: async (response) => response.payload,
      showError(error) {
        state.lastError = error;
      },
      showConfirmationDialog(options) {
        state.confirmationCalls.push(options);
        return state.confirmImpl(options);
      },
      toast() {},
    }),
    './overtime-rule-editor.js': stub({
      createOvertimeRuleEditor(root) {
        return {
          setLimits() {},
          renderRules() {},
          readRules: () => [],
          createRule(gift) {
            state.addedGifts.push({ ...gift });
            const row = document.createElement('article');
            row.dataset.overtimeRule = 'true';
            row.dataset.giftId = String(gift.id);
            row.dataset.giftIdentity = JSON.stringify(gift.giftIdentity || null);
            row.scrollIntoView = () => {};
            root.append(row);
            return row;
          },
        };
      },
    }),
    './overtime-time-view.js': stub({
      createOvertimeTimeView: () => ({
        renderSettlements() {},
        populateInitialDurationSelectors() {},
        syncDurationSelectorsFromInput() {},
        syncDurationInputFromSelectors() {},
        renderInitialDuration() {},
        parseInitialDuration: () => state.parsedDuration,
        formatClockDisplay: (milliseconds) => `${milliseconds / 1000} 秒`,
      }),
    }),
    './overtime-status-view.js': stub({
      createOvertimeStatusView: () => ({
        renderState(next) {
          state.overtimeState = { ...state.overtimeState, ...next };
        },
        syncClockLoop() {},
        stopClockLoop() {},
        getState: () => state.overtimeState,
      }),
    }),
    './overtime-preview.js': stub({
      createOvertimeAppearance: () => ({
        receive() {},
        open() {},
      }),
    }),
  };
  for (const specifier of [
    '../shared/gift-image-fallback.js',
    '../shared/gift-catalog-roles.js',
    './overtime-gift-identity.js',
  ]) {
    const file = path.resolve(path.dirname(OVERTIME_ENTRY), specifier);
    dependencies[specifier] = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), {
      context,
      identifier: pathToFileURL(file).href,
    });
  }
  const linked = new Map(Object.entries(dependencies).map(([specifier, dependency]) =>
    [new URL(specifier, entryUrl).href, dependency]));
  await module.link((specifier, parent) => {
    const url = new URL(specifier, parent.identifier);
    if (!linked.has(url.href)) linked.set(url.href, new vm.SourceTextModule(fs.readFileSync(url, 'utf8'), {
      context, identifier: url.href,
    }));
    return linked.get(url.href);
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
    for (const listener of this.listeners.get(type) || []) results.push(listener(dispatchedEvent));
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

module.exports = { createFixture, createGifts, deferred, flush, nodeText, openPicker, optionNodes };
