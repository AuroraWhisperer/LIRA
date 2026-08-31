'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT = path.join(__dirname, '..');

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

test('Bilibili settings render the current account profile in the existing row', async () => {
  const module = await loadModuleExports(
    path.join(ROOT, 'public', 'js', 'admin', 'settings-auth.js'),
    { URL, URLSearchParams },
  );
  const elements = new Map([
    ['bilibiliAuthStatus', createElement('bilibiliAuthStatus')],
    [
      'bilibiliAuthProfile',
      createElement('bilibiliAuthProfile', { hidden: true }),
    ],
    [
      'bilibiliAuthAvatar',
      createElement('bilibiliAuthAvatar', { hidden: true }),
    ],
    ['bilibiliAuthName', createElement('bilibiliAuthName')],
    ['bilibiliAuthUid', createElement('bilibiliAuthUid')],
    ['bilibiliLoginBtn', createElement('bilibiliLoginBtn')],
    [
      'bilibiliLogoutBtn',
      createElement('bilibiliLogoutBtn', { style: { display: 'none' } }),
    ],
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

  assert.equal(elements.get('bilibiliAuthStatus').textContent, '已登录');
  assert.equal(elements.get('bilibiliAuthProfile').hidden, false);
  assert.equal(elements.get('bilibiliAuthName').textContent, '主播小号');
  assert.equal(elements.get('bilibiliAuthUid').textContent, 'UID: 288594073');
  assert.equal(elements.get('bilibiliAuthAvatar').hidden, false);
  assert.equal(elements.get('bilibiliAuthAvatar').alt, '主播小号的头像');
  const avatarUrl = new URL(
    elements.get('bilibiliAuthAvatar').src,
    'http://127.0.0.1',
  );
  assert.equal(avatarUrl.pathname, '/api/bilibili/avatar');
  assert.equal(
    avatarUrl.searchParams.get('url'),
    'https://i0.hdslb.com/bfs/face/host.jpg',
  );
  assert.equal(
    avatarUrl.searchParams.get('token'),
    'desktop-session-token',
  );
  assert.equal(elements.get('bilibiliLoginBtn').style.display, 'none');
  assert.equal(elements.get('bilibiliLogoutBtn').style.display, '');
  assert.equal(
    module.bilibiliAvatarSource('https://images.example.com/avatar.jpg'),
    '',
  );
});

test('Bilibili account markup keeps avatar, identity and actions in one aligned row', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'public', 'pages', 'admin', 'song', 'settings.html'),
    'utf8',
  );
  const css = fs.readFileSync(
    path.join(ROOT, 'public', 'css', 'admin', 'workspace', 'base.css'),
    'utf8',
  );
  const row = html.match(
    /<div\s+class="bilibili-auth-row"[\s\S]*?<\/div>/,
  )?.[0];

  assert.ok(row);
  assert.match(row, /id="bilibiliAuthAvatar"/);
  assert.match(row, /id="bilibiliAuthName"/);
  assert.match(row, /id="bilibiliAuthUid"/);
  assert.ok(row.indexOf('bilibiliAuthProfile') < row.indexOf('bilibiliLogoutBtn'));
  assert.match(css, /\.bilibili-auth-profile\s*\{[\s\S]*?align-items: center/);
  assert.match(css, /\.bilibili-auth-avatar\s*\{[\s\S]*?width: 28px/);
  assert.match(css, /\.bilibili-auth-identity\s*\{[\s\S]*?flex-direction: column/);
});
