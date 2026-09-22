'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createDesktopRequestAuth } = require('../src/electron/desktop-request-auth');
const { configureMediaRequestHeaders } = require('../src/electron/media-request-headers');

const BASE = 'http://127.0.0.1:3000';

function fixture() {
  const session = {};
  const frame = {
    url: `${BASE}/admin?desktop=1`,
    origin: BASE,
    processId: 4,
    frameToken: 'main-document',
    detached: false,
    parent: null,
  };
  const contents = { id: 11, session, mainFrame: frame, isDestroyed: () => false };
  let window = { webContents: contents, isDestroyed: () => false };
  let token = 'synthetic-main-only-token';
  const auth = createDesktopRequestAuth({
    desktopSession: session,
    getMainWindow: () => window,
    getBaseUrl: () => BASE,
    getToken: () => token,
  });
  function request(overrides = {}, headers = {}) {
    auth.applyHeaders(
      {
        id: 1,
        url: `${BASE}/api/settings`,
        method: 'GET',
        resourceType: 'xhr',
        webContentsId: contents.id,
        webContents: contents,
        frame,
        ...overrides,
      },
      headers,
    );
    return headers;
  }
  return {
    auth,
    request,
    frame,
    contents,
    session,
    setWindow: (value) => {
      window = value;
    },
    setToken: (value) => {
      token = value;
    },
  };
}

test('only the registered admin main frame receives management HTTP, media, beacon and WS headers', () => {
  const f = fixture();
  for (const [resourceType, url] of [
    ['xhr', `${BASE}/api/settings`],
    ['media', `${BASE}/api/music/stream`],
    ['ping', `${BASE}/api/playback/queue-state`],
    ['webSocket', 'ws://127.0.0.1:3000/ws'],
    ['mainFrame', `${BASE}/api/songs/export`],
  ]) {
    assert.equal(f.request({ resourceType, url }).Authorization, 'Bearer synthetic-main-only-token');
  }
});

test('initial and license-recovery navigations bootstrap admin HTML without granting license API access', () => {
  const f = fixture();
  for (const source of ['', 'about:blank', `${BASE}/license`]) {
    f.frame.url = source;
    f.frame.origin = source.startsWith(BASE) ? BASE : 'null';
    for (const pathname of ['/', '/admin', '/settings', '/songs']) {
      assert.ok(f.request({ resourceType: 'mainFrame', url: BASE + pathname }).Authorization);
    }
    assert.equal(f.request().Authorization, undefined);
    assert.equal(
      f.request({ resourceType: 'mainFrame', url: `${BASE}/admin`, method: 'POST' }).Authorization,
      undefined,
    );
  }
});

test('subframes, opaque or missing frames, detached documents and other sessions never receive management headers', () => {
  const f = fixture();
  for (const override of [
    { frame: null },
    { frame: undefined },
    { frame: { ...f.frame, parent: f.frame } },
    { frame: { ...f.frame, detached: true } },
    { frame: { ...f.frame, frameToken: 'old-document' } },
    { frame: { ...f.frame, processId: 9 } },
    { frame: { ...f.frame, origin: 'null' } },
    { frame: { ...f.frame, url: `${BASE}/clock` } },
    { frame: { ...f.frame, url: 'https://login.example.test/admin' } },
    { webContentsId: 12 },
    { webContents: { ...f.contents, session: {} } },
  ])
    assert.equal(f.request(override).Authorization, undefined);
  f.contents.session = {};
  assert.equal(f.request().Authorization, undefined);
  f.contents.session = f.session;
  f.setWindow(null);
  assert.equal(f.request().Authorization, undefined);
});

test('foreign origins, overlays, assets and wrong websocket protocols are outside the privileged target set', () => {
  const f = fixture();
  for (const url of [
    'http://localhost:3000/api/settings',
    'http://127.0.0.1:3001/api/settings',
    'https://127.0.0.1:3000/api/settings',
    'http://127.0.0.1.evil.test:3000/api/settings',
    'http://user:password@127.0.0.1:3000/api/settings',
    `${BASE}/clock`,
    `${BASE}/js/admin/index.js`,
    `${BASE}/api`,
    'ws://127.0.0.1:3001/ws',
    'wss://127.0.0.1:3000/ws',
    'ws://127.0.0.1:3000/ws/other',
  ])
    assert.equal(f.request({ url, resourceType: 'webSocket' }).Authorization, undefined);
});

test('redirects strip the exact attached management secret even after token rotation or disposal', () => {
  const f = fixture();
  const first = f.request();
  f.setToken('replacement-token');
  const redirected = f.request(
    { url: 'https://outside.example.test/api/settings' },
    {
      authorization: first.Authorization,
      Accept: 'application/json',
    },
  );
  assert.deepEqual(redirected, { Accept: 'application/json' });
  const second = f.request({ id: 2 });
  f.auth.dispose();
  assert.deepEqual(f.request({ id: 2 }, second), {});
  assert.deepEqual(f.request({ id: 3 }), {});
  f.auth.completeRequest({ id: 1 });
  f.auth.completeRequest({ id: 2 });
});

test('untrusted request headers keep their own scoped credentials while explicit leaked management headers are removed', () => {
  const f = fixture();
  assert.deepEqual(f.request({ frame: null }, { Authorization: 'Bearer overlay-clock' }), {
    Authorization: 'Bearer overlay-clock',
  });
  assert.deepEqual(f.request({ frame: null }, { authorization: 'Bearer synthetic-main-only-token' }), {});
});

test('navigation keeps the privileged window on admin/license documents or admin-initiated API downloads', () => {
  const f = fixture();
  for (const pathname of ['/', '/admin', '/settings', '/songs', '/license', '/api/songs/export'])
    assert.equal(f.auth.isAllowedNavigation(BASE + pathname), true);
  for (const target of [`${BASE}/clock`, `${BASE}/pages/overlays/clock.html`, 'https://outside.example.test/admin'])
    assert.equal(f.auth.isAllowedNavigation(target), false);
  f.frame.url = `${BASE}/license`;
  assert.equal(f.auth.isAllowedNavigation(`${BASE}/api/settings`), false);
});

test('media and management rules share one listener with request lifecycle cleanup', () => {
  const f = fixture();
  const registrations = {};
  f.session.webRequest = Object.fromEntries(
    ['onBeforeSendHeaders', 'onCompleted', 'onErrorOccurred'].map((event) => [
      event,
      (...args) => {
        assert.equal(registrations[event], undefined);
        registrations[event] = args;
      },
    ]),
  );
  const state = {};
  configureMediaRequestHeaders(f.session, state, f.auth);
  configureMediaRequestHeaders(f.session, state, f.auth);
  const [filter, listener] = registrations.onBeforeSendHeaders;
  assert.deepEqual(filter.urls, ['<all_urls>']);
  listener({ id: 2, url: 'https://y.qq.com/song', requestHeaders: {} }, ({ requestHeaders }) => {
    assert.deepEqual(requestHeaders, { Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com' });
  });
  assert.equal(registrations.onCompleted[0], f.auth.completeRequest);
  assert.equal(registrations.onErrorOccurred[0], f.auth.completeRequest);
});

test('window rebinding and disposal remove owned navigation listeners', () => {
  const f = fixture();
  function window() {
    const contents = new EventEmitter();
    contents.isDestroyed = () => false;
    contents.setWindowOpenHandler = (handler) => {
      contents.open = handler;
    };
    return { webContents: contents };
  }
  const first = window();
  const second = window();
  const opened = [];
  f.auth.bindWindow(first, { openExternal: (url) => opened.push(url) });
  assert.equal(first.webContents.listenerCount('will-navigate'), 1);
  f.auth.bindWindow(second, { openExternal: (url) => opened.push(url) });
  assert.equal(first.webContents.listenerCount('will-navigate'), 0);
  assert.deepEqual(first.webContents.open({ url: 'https://example.test' }), { action: 'deny' });
  assert.equal(opened.length, 0);
  f.auth.dispose();
  f.auth.dispose();
  assert.equal(second.webContents.listenerCount('will-navigate'), 0);
  assert.equal(second.webContents.listenerCount('will-redirect'), 0);
});
