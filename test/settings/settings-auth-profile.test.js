'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT = path.join(__dirname, '../..');

test('Bilibili account changes reconnect the existing listener once without reconnecting on initialization', async () => {
  const listeners = new Map();
  const reconnects = [];
  const noop = () => {};
  const context = vm.createContext({
    window: {},
    document: {
      addEventListener(type, listener) {
        const handlers = listeners.get(type) || [];
        handlers.push(listener);
        listeners.set(type, handlers);
      },
    },
  });
  const dependencies = {
    '../shared/utils.js': Object.fromEntries([
      'api', 'dangerConfirm', 'localOverlayOrigin', 'logoutConfirm', 'readJsonResponse',
      'showConfirmationDialog', 'showStackedToast', 'toast', 'value',
    ].map(name => [name, noop])),
    './settings-auth.js': { initBilibiliAuth: noop },
    './settings-blindbox.js': { createBlindboxSettings: () => ({}) },
    './settings-form.js': { createSettingsForm: () => ({}) },
    './song-request-blacklist.js': { createSongRequestBlacklist: noop },
    './song-request-user-blacklist.js': { createSongRequestUserBlacklist: noop },
    './settings-license.js': { initLicenseAccountDevice: noop, initLicenseAgreement: noop },
    './settings-operations.js': {
      createSettingsOperations: () => ({ reconnectBilibili: options => reconnects.push({ ...options }) }),
    },
    './settings-room-profile.js': { createBilibiliRoomProfile: () => ({ refresh: noop }) },
    './settings-guard-expiry.js': { initGuardExpirySettings: () => ({ refresh: noop }) },
    '../shared/event-bus.js': { eventBus: { on: noop }, Events: {} },
    './state.js': { stateService: {} },
    './forms.js': { formsService: {} },
    './queue.js': { renderState: noop },
    './gifts/blindbox.js': { giftBlindbox: {} },
  };
  const entry = new vm.SourceTextModule(fs.readFileSync(path.join(ROOT, 'public/js/admin/settings.js'), 'utf8'), { context });
  await entry.link(specifier => {
    const exports = dependencies[specifier];
    assert.ok(exports, `Unexpected dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await entry.evaluate();
  entry.namespace.initBilibiliAuth();
  assert.deepEqual(reconnects, [], 'reading the saved account does not restart the listener');
  const handlers = listeners.get('app:bilibili-auth-changed');
  assert.equal(handlers.length, 1);
  for (const change of ['login', 'logout']) {
    handlers[0]();
    assert.deepEqual(reconnects.at(-1), { silent: true }, `${change} refreshes the listener with current credentials`);
  }
  assert.equal(reconnects.length, 2);
});

function createElement(id, overrides = {}) {
  const listeners = new Map();
  return {
    id,
    textContent: '',
    className: '',
    hidden: false,
    alt: '',
    src: '',
    title: '',
    disabled: false,
    style: {},
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeAttribute(name) {
      if (name === 'src') this.src = '';
      if (name === 'title') this.title = '';
    },
    ...overrides,
  };
}

test('Bilibili profile avatars load only through the authenticated proxy for Bilibili image hosts', async () => {
  const module = await loadModuleExports(path.join(ROOT, 'public', 'js', 'admin', 'settings-auth.js'), {
    URL,
    URLSearchParams,
  });
  const elements = new Map([
    ['bilibiliAuthStatus', createElement('bilibiliAuthStatus')],
    ['bilibiliAuthProfile', createElement('bilibiliAuthProfile', { hidden: true })],
    ['bilibiliAuthAvatar', createElement('bilibiliAuthAvatar', { hidden: true })],
    ['bilibiliAuthName', createElement('bilibiliAuthName')],
    ['bilibiliAuthUid', createElement('bilibiliAuthUid')],
    ['bilibiliLoginBtn', createElement('bilibiliLoginBtn')],
    ['bilibiliLogoutBtn', createElement('bilibiliLogoutBtn', { style: { display: 'none' } })],
  ]);
  const windowRef = {
    __API_TOKEN__: 'desktop-session-token',
    bilibiliAuth: {
      getAuthState: async () => ({ loggedIn: true, uid: 288594073 }),
      getProfile: async () => ({
        uid: 288594073,
        name: '主播小号',
        avatarUrl: 'https://i0.hdslb.com/bfs/face/host.jpg',
      }),
      login: async () => ({}),
      logout: async () => ({}),
    },
  };

  module.initBilibiliAuth({
    documentRef: {
      getElementById: (id) => elements.get(id),
      dispatchEvent() {},
    },
    windowRef,
    toast() {},
    logoutConfirm: async () => false,
  });
  await new Promise((resolve) => setImmediate(resolve));

  const avatarUrl = new URL(elements.get('bilibiliAuthAvatar').src, 'http://127.0.0.1');
  assert.equal(avatarUrl.pathname, '/api/bilibili/avatar');
  assert.equal(avatarUrl.searchParams.get('url'), 'https://i0.hdslb.com/bfs/face/host.jpg');
  assert.equal(avatarUrl.searchParams.get('token'), 'desktop-session-token');
  assert.equal(module.bilibiliAvatarSource('https://images.example.com/avatar.jpg'), '');
});

test('Bilibili login and confirmed logout announce each auth change once', async () => {
  const module = await loadModuleExports(path.join(ROOT, 'public', 'js', 'admin', 'settings-auth.js'), {
    URL,
    URLSearchParams,
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    },
  });
  const elements = new Map([
    ['bilibiliAuthStatus', createElement('bilibiliAuthStatus')],
    ['bilibiliAuthProfile', createElement('bilibiliAuthProfile', { hidden: true })],
    ['bilibiliAuthAvatar', createElement('bilibiliAuthAvatar', { hidden: true })],
    ['bilibiliAuthName', createElement('bilibiliAuthName')],
    ['bilibiliAuthUid', createElement('bilibiliAuthUid')],
    ['bilibiliLoginBtn', createElement('bilibiliLoginBtn')],
    ['bilibiliLogoutBtn', createElement('bilibiliLogoutBtn', { style: { display: 'none' } })],
  ]);
  let authState = { loggedIn: false };
  const windowRef = {
    __API_TOKEN__: '',
    bilibiliAuth: {
      getAuthState: async () => authState,
      login: async () => {
        authState = { loggedIn: true, uid: 42 };
        return { state: authState };
      },
      logout: async () => {
        authState = { loggedIn: false };
      },
    },
  };
  const authEvents = [];
  const documentRef = {
    getElementById: (id) => elements.get(id),
    dispatchEvent(event) {
      authEvents.push(event.type);
    },
  };
  let logoutPrompt;

  module.initBilibiliAuth({
    documentRef,
    windowRef,
    toast() {},
    logoutConfirm: async (options) => {
      logoutPrompt = options;
      return true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  await elements.get('bilibiliLoginBtn').listeners.get('click')();
  assert.deepEqual(authEvents, ['app:bilibili-auth-changed']);

  await elements.get('bilibiliLogoutBtn').listeners.get('click')();
  assert.ok(logoutPrompt);
  assert.deepEqual(authEvents, ['app:bilibili-auth-changed', 'app:bilibili-auth-changed']);
});
