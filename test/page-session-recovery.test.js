'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { servePageOrAsset } = require('../src/server/http-utils');
const { loadModuleExports } = require('./helpers/frontend-modules');

test('overlay socket closure confirms an expired session and reloads only once', async () => {
  const requests = [];
  let resolveCheck;
  const page = await createPage('/queue', (url, options) => {
    requests.push({ url, options });
    return new Promise((resolve) => { resolveCheck = resolve; });
  });
  const first = new page.window.WebSocket('ws://127.0.0.1:3000/ws');
  const second = new page.window.WebSocket('ws://127.0.0.1:3000/ws');
  first.close();
  second.close();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/state');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer old-token');
  resolveCheck({ status: 401 });
  await flush();
  assert.equal(page.reloads(), 1);
  second.close();
  await flush();
  assert.equal(page.reloads(), 1);
});

test('overlay API failure recovers poll-only pages with the same session check', async () => {
  const requests = [];
  const page = await createPage('/clock', async (url) => {
    requests.push(url);
    return { status: 401 };
  });
  await page.window.fetch('/api/settings');
  await flush();
  assert.deepEqual(requests, ['/api/settings', '/api/state']);
  assert.equal(page.reloads(), 1);
});

test('temporary network failures and a still-valid session do not reload overlays', async () => {
  let checks = 0;
  const page = await createPage('/queue', async () => {
    checks += 1;
    if (checks === 1) throw new Error('offline');
    return { status: 200 };
  });
  const socket = new page.window.WebSocket('ws://127.0.0.1:3000/ws');
  socket.close();
  await flush();
  socket.close();
  await flush();
  assert.equal(checks, 2);
  assert.equal(page.reloads(), 0);
});

test('external failures and admin requests do not trigger overlay recovery', async () => {
  for (const pathname of ['/queue', '/admin']) {
    const requests = [];
    const page = await createPage(pathname, async (url) => {
      requests.push(url);
      return { status: 401 };
    });
    await page.window.fetch('https://external.test/api/state');
    new page.window.WebSocket('wss://external.test/ws').close();
    if (pathname === '/admin') {
      await page.window.fetch('/api/state');
      new page.window.WebSocket('ws://127.0.0.1:3000/ws').close();
    }
    await flush();
    assert.equal(requests.length, pathname === '/admin' ? 2 : 1);
    assert.equal(page.reloads(), 0);
  }
});

test('leaving an overlay aborts a pending session check and suppresses reload', async () => {
  let signal;
  let resolveCheck;
  const page = await createPage('/queue', (_url, options) => {
    signal = options.signal;
    return new Promise((resolve) => { resolveCheck = resolve; });
  });
  new page.window.WebSocket('ws://127.0.0.1:3000/ws').close();
  page.hide();
  assert.equal(signal.aborted, true);
  resolveCheck({ status: 401 });
  await flush();
  assert.equal(page.reloads(), 0);
});

test('an open overlay recovers after a real runtime restarts with a rotated token', async (t) => {
  const { createServerRuntime } = require('../src/server');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-overlay-restart-'));
  const nativeFetch = globalThis.fetch;
  const originalAutoOpen = process.env.AUTO_OPEN_ADMIN;
  process.env.AUTO_OPEN_ADMIN = '0';
  t.mock.method(globalThis, 'fetch', (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input.href);
    assert.equal(url.hostname, '127.0.0.1', 'test must not call external services');
    return nativeFetch(input, options);
  });
  const first = createServerRuntime({ dataDir: path.join(tempDir, 'data') });
  let second;
  let page;
  let controller;
  let freshSocket;
  let refreshedPage;
  t.after(async () => {
    page?.hide();
    refreshedPage?.hide();
    controller?.dispose();
    freshSocket?.close();
    await first.stop({ exitProcess: false });
    await second?.stop({ exitProcess: false });
    if (originalAutoOpen === undefined) delete process.env.AUTO_OPEN_ADMIN;
    else process.env.AUTO_OPEN_ADMIN = originalAutoOpen;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const app = await first.start({ host: '127.0.0.1', startPort: 0 });
  const oldToken = first.getApiToken();
  page = await createPage('/queue', (url, options) =>
    nativeFetch(new URL(url, app.baseUrl), options), {
    baseUrl: app.baseUrl,
    html: await (await nativeFetch(`${app.baseUrl}/queue`)).text(),
    WebSocket,
  });
  const { createOverlaySocket } = await loadModuleExports(
    path.resolve(__dirname, '..', 'public/js/overlays/socket-client.js'),
    { window: page.window, WebSocket: page.window.WebSocket, location: new URL(app.baseUrl) },
  );
  let opens = 0;
  const retries = [];
  controller = createOverlaySocket({
    onOpen() { opens += 1; },
    setTimeoutFn(callback) { const timer = { callback }; retries.push(timer); return timer; },
    clearTimeoutFn(timer) { timer.cancelled = true; },
  });
  controller.start();
  await waitFor(() => opens === 1);
  await first.stop({ exitProcess: false });
  await waitFor(() => retries.some((timer) => !timer.cancelled));
  second = createServerRuntime({ dataDir: path.join(tempDir, 'data') });
  await second.start({ host: '127.0.0.1', startPort: Number(new URL(app.baseUrl).port) });
  assert.notEqual(second.getApiToken(), oldToken);
  assert.equal((await nativeFetch(`${app.baseUrl}/api/state`, {
    headers: { Authorization: `Bearer ${oldToken}` },
  })).status, 401);
  retries.find((timer) => !timer.cancelled).callback();
  await waitFor(() => page.reloads() === 1);
  page.hide();
  controller.dispose();

  refreshedPage = await createPage('/queue', (url, options) =>
    nativeFetch(new URL(url, app.baseUrl), options), {
    baseUrl: app.baseUrl,
    html: await (await nativeFetch(`${app.baseUrl}/queue`)).text(),
    WebSocket,
  });
  freshSocket = new refreshedPage.window.WebSocket(`${app.baseUrl.replace('http:', 'ws:')}/ws`);
  await waitFor(() => freshSocket.readyState === WebSocket.OPEN);
  assert.equal(refreshedPage.window.__API_TOKEN__, second.getApiToken());
  assert.equal((await refreshedPage.window.fetch('/api/state')).status, 200);
});

async function createPage(pathname, fetchFn, options = {}) {
  const location = new URL(pathname, options.baseUrl || 'http://127.0.0.1:3000');
  const html = options.html || await new Promise((resolve) => {
    servePageOrAsset(path.resolve(__dirname, '..', 'public'), { method: 'GET' }, {
      setHeader() {},
      writeHead(status) { assert.equal(status, 200); },
      end(body) { resolve(body.toString()); },
    }, location, 'old-token');
  });
  const match = html.match(/<script>\(function\(\)\{[\s\S]*?\}\)\(\);<\/script>/);
  assert.ok(match, 'expected the real injected session script');
  let reloads = 0;
  const listeners = new Map();
  location.reload = () => { reloads += 1; };
  class FakeWebSocket extends EventTarget {
    constructor(url) { super(); this.url = url; }
    close() { this.dispatchEvent(new Event('close')); }
  }
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const window = {
    fetch: fetchFn,
    WebSocket: options.WebSocket || FakeWebSocket,
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  vm.runInNewContext(match[0].slice(8, -9), {
    window, location, URL, Headers, AbortController, setTimeout, clearTimeout,
    document: { readyState: 'complete', querySelectorAll: () => [] },
  });
  return { window, reloads: () => reloads, hide: () => listeners.get('pagehide')?.() };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('expected session recovery before timeout');
}
