'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { servePageOrAsset } = require('../../src/server/page-assets');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');

const ROOT_DIR = path.join(__dirname, '../..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

test('wheel overlay uses no inline handlers or HTML injection', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'pages', 'overlays', 'wheel.html'), 'utf8');
  const script = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'overlays', 'wheel.js'), 'utf8');
  assert.doesNotMatch(html, /\son(?:click|keydown)=/);
  assert.doesNotMatch(script, /innerHTML/);
});

test('wheel module entry binds its controls without relying on classic-script globals', async () => {
  const handlers = new Map();
  const elements = new Map();
  const requests = [];
  const sockets = [];
  const windowRef = { addEventListener() {} };
  function element(id) {
    if (!elements.has(id))
      elements.set(id, {
        handlers: new Map(),
        addEventListener(type, handler) {
          this.handlers.set(type, handler);
        },
        classList: { toggle() {} },
        setAttribute() {},
        replaceChildren() {},
      });
    return elements.get(id);
  }
  await loadModuleExports(path.join(PUBLIC_DIR, 'js', 'overlays', 'wheel.js'), {
    URLSearchParams,
    window: windowRef,
    document: {
      addEventListener: (type, handler) => handlers.set(type, handler),
      getElementById: element,
      querySelectorAll: () => [],
    },
    location: { protocol: 'http:', host: 'localhost' },
    WebSocket: class {
      constructor() {
        sockets.push(this);
      }
      addEventListener() {}
    },
    fetch: async (url) => {
      requests.push(url);
      return { json: async () => ({ ok: true, data: { entries: [] } }) };
    },
    setTimeout,
    clearTimeout,
  });
  handlers.get('DOMContentLoaded')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, ['/api/wheel']);
  assert.equal(sockets.length, 1);
  element('wheelCenterButton').handlers.get('click')();
  assert.ok(element('wheelMessage').textContent, 'fewer than two entries explain instead of spinning');
  assert.equal(windowRef.spinFromWheel, undefined);
});

test('wheel retains unchanged segments while refreshing appearance, spins and cleared results', () => {
  const elements = new Map();
  let created = 0;
  const timers = [];
  const node = () => ({ children: [], dataset: {}, style: { setProperty() {} }, classes: new Set(), attributes: new Map(),
    classList: { add() {}, toggle() {} },
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name); },
    append(child) { this.children.push(child); }, replaceChildren() { this.children = []; } });
  const byId = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const document = { body: node(), addEventListener() {}, getElementById: byId,
    createElement(tag) { return this.createElementNS('', tag); },
    createElementNS(_namespace, tag) {
      created++;
      const element = node();
      element.tag = tag;
      element.classList.toggle = (name, enabled) => enabled ? element.classes.add(name) : element.classes.delete(name);
      return element;
    },
    querySelectorAll(selector) {
      return byId('wheelSegments').children.filter(element => selector !== '.wheel-label' || element.tag === 'text');
    } };
  const context = vm.createContext({ document, URLSearchParams,
    window: { matchMedia: () => ({ matches: false }), setTimeout(callback) { timers.push(callback); } },
    state: { entries: [{ label: 'A', weight: 1 }, { label: 'B', weight: 2 }], spin: null, lastResult: null } });
  vm.runInContext(readJsModuleBundle('public', 'js', 'overlays', 'wheel.js'), context);
  const render = () => vm.runInContext('renderState(state)', context);
  render();
  const first = byId('wheelSegments').children[0];
  const count = created;
  for (let index = 0; index < 20; index++) render();
  assert.equal(created, count);
  context.state.lastResult = { index: 0 };
  render();
  assert.equal(first.classes.has('is-selected'), true);
  assert.equal(byId('wheelGroup').style.transform, 'rotate(-60deg)', 'restored result points to the weighted segment center');
  assert.equal(byId('wheelGroup').style.transition, 'none', 'restoration does not replay a spin');
  context.state.spin = { id: 'spin', index: 1, startedAt: Date.now(), durationMs: 1000, turns: 5 };
  render(); render();
  assert.equal(timers.length, 1, 'repeated snapshots never restart a spin');
  const spinningTarget = Number(byId('wheelGroup').style.transform.match(/[-\d.]+/)[0]);
  assert.equal(first.classes.has('is-selected'), false);
  context.state.spin = null;
  context.state.lastResult = { index: 1 };
  render();
  const restoredTarget = Number(byId('wheelGroup').style.transform.match(/[-\d.]+/)[0]);
  assert.equal(((spinningTarget - restoredTarget) % 360 + 360) % 360, 0, 'finished and reopened views share the same result angle');
  context.state.lastResult = null;
  render();
  timers[0]();
  assert.equal(byId('wheelSegments').children.some(element => element.classes.has('is-selected')), false, 'a cleared result is not revived by the old animation callback');
  assert.equal(byId('wheelSegments').children[0], first);
  vm.runInContext('componentConfig = { textColor: "red", showResult: false, labelFontSize: 22 }', context);
  render();
  assert.equal(document.querySelectorAll('.wheel-label')[0].style.fill, 'red');
  assert.equal(byId('wheelMessage').hidden, true);
  assert.equal(created, count);
  context.state.entries[0].weight = 3;
  render();
  assert.notEqual(byId('wheelSegments').children[0], first);
  const weighted = byId('wheelSegments').children[0];
  vm.runInContext('componentConfig.labelFontSize = 30', context);
  render();
  assert.notEqual(byId('wheelSegments').children[0], weighted);
});

test('wheel overlay page allows embedding with isolated script origin', async () => {
  let status;
  let headers = {};
  await new Promise((resolve) => {
    const response = {
      setHeader(name, value) {
        headers[name] = value;
      },
      writeHead(nextStatus, nextHeaders) {
        status = nextStatus;
        headers = { ...headers, ...nextHeaders };
      },
      end: resolve,
    };
    servePageOrAsset(PUBLIC_DIR, { method: 'GET' }, response, new URL('http://127.0.0.1/wheel'), 'test-token');
  });
  assert.equal(status, 200);
  assert.equal(headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(headers['Content-Security-Policy'], 'sandbox allow-scripts');
  assert.equal(headers['X-Frame-Options'], undefined);
});
