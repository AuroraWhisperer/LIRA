'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { servePageOrAsset } = require('../src/server/http-utils');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

test('wheel overlay is mapped, transparent, and renders labels through DOM APIs', () => {
  const html = fs.readFileSync(
    path.join(PUBLIC_DIR, 'pages', 'overlays', 'wheel.html'),
    'utf8',
  );
  const script = fs.readFileSync(
    path.join(PUBLIC_DIR, 'js', 'overlays', 'wheel.js'),
    'utf8',
  );
  const styles = fs.readFileSync(
    path.join(PUBLIC_DIR, 'css', 'overlays', 'wheel.css'),
    'utf8',
  );
  assert.match(html, /id="wheelSvg"/);
  assert.match(html, /id="wheelCenterButton"/);
  assert.match(html, />GO</);
  assert.match(html, /<script type="module" src="\/js\/overlays\/wheel\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(html, /\son(?:click|keydown)=/);
  assert.match(script, /createElementNS/);
  assert.match(script, /spinFromWheel/);
  assert.match(script, /createRadialLabel/);
  assert.match(script, /tspan/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(styles, /background:.*transparent/);
  assert.match(script, /wheel:update/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /cubic-bezier/);
  assert.match(styles, /\.wheel-center-button/);
  assert.match(styles, /\.wheel-center-arrow/);
});

test('wheel module entry binds its controls without relying on classic-script globals', async () => {
  const handlers = new Map();
  const elements = new Map();
  const requests = [];
  const sockets = [];
  const windowRef = { addEventListener() {} };
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      handlers: new Map(),
      addEventListener(type, handler) { this.handlers.set(type, handler); },
      classList: { toggle() {} },
      setAttribute() {},
      replaceChildren() {},
    });
    return elements.get(id);
  }
  await loadModuleExports(path.join(PUBLIC_DIR, 'js', 'overlays', 'wheel.js'), {
    window: windowRef,
    document: {
      addEventListener: (type, handler) => handlers.set(type, handler),
      getElementById: element,
    },
    location: { protocol: 'http:', host: 'localhost' },
    WebSocket: class {
      constructor() { sockets.push(this); }
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
  assert.equal(typeof element('wheelCenterButton').handlers.get('click'), 'function');
  element('wheelCenterButton').handlers.get('click')();
  assert.equal(element('wheelMessage').textContent, '请先等待主播配置至少两个选项');
  assert.equal(windowRef.spinFromWheel, undefined);
});

test('wheel overlay page is served without frame protection headers', async () => {
  let status;
  let headers = {};
  const body = await new Promise((resolve) => {
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
    servePageOrAsset(
      PUBLIC_DIR,
      { method: 'GET' },
      response,
      new URL('http://127.0.0.1/wheel'),
      'test-token',
    );
  });
  assert.equal(status, 200);
  assert.equal(headers['Content-Type'], 'text/html; charset=utf-8');
  const html = body.toString('utf8');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /id="wheelSvg"/);
  assert.match(html, /<\/html>\s*$/);
  assert.equal(headers['Content-Security-Policy'], undefined);
  assert.equal(headers['X-Frame-Options'], undefined);
});
