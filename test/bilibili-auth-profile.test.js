'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { registerBilibiliIpc } = require('../src/electron/ipc/bilibili-ipc');

function loadBilibiliAuth(cookies) {
  const originalLoad = Module._load;
  const modulePath = require.resolve('../src/electron/bilibili-auth');
  const fakeElectron = {
    safeStorage: { isEncryptionAvailable: () => false },
    session: {
      fromPartition: () => ({
        cookies: { get: async () => cookies },
      }),
    },
  };

  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') return fakeElectron;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function bilibiliCookie(name, value) {
  return { name, value, domain: '.bilibili.com' };
}

test('Bilibili account profile resolves the logged-in UID name and avatar', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 0,
          data: {
            card: {
              name: '主播小号',
              face: 'https://i0.hdslb.com/bfs/face/host.jpg',
            },
          },
        }),
    };
  };
  const auth = loadBilibiliAuth([
    bilibiliCookie('DedeUserID', '288594073'),
    bilibiliCookie('SESSDATA', 'fake-session'),
    bilibiliCookie('bili_jct', 'fake-csrf'),
  ]);

  const profile = await auth.getBilibiliAccountProfile(
    path.join(os.tmpdir(), 'lira-missing-bilibili-profile-test'),
  );

  assert.deepEqual(profile, {
    uid: 288594073,
    name: '主播小号',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/host.jpg',
  });
  assert.equal(
    requests[0].url,
    'https://api.bilibili.com/x/web-interface/card?mid=288594073',
  );
  assert.match(requests[0].options.headers.Cookie, /SESSDATA=fake-session/);
});

test('Bilibili IPC exposes only the public profile result', async () => {
  const handlers = new Map();
  const profile = {
    uid: 288594073,
    name: '主播小号',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/host.jpg',
  };
  registerBilibiliIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    getAuthState: async () => ({ loggedIn: true, uid: profile.uid }),
    getProfile: async () => profile,
    login: async () => ({}),
    logout: async () => ({}),
  });

  assert.deepEqual(await handlers.get('bilibili:get-profile')(), profile);
  assert.equal('cookieHeader' in profile, false);
});
