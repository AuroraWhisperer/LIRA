'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { servePageOrAsset } = require('../../src/server/page-assets');
const { loadModuleExports } = require('../helpers/frontend-modules');

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
