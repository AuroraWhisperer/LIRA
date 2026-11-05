'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function loadBilibiliAuth(cookies) {
  const originalLoad = Module._load;
  const modulePath = require.resolve('../../src/electron/bilibili-auth');
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

function createDataDir(t) {
  const scratchDir = path.join(__dirname, '../../tmp');
  fs.mkdirSync(scratchDir, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(scratchDir, 'bilibili-auth-profile-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('Bilibili account profile loads from the logged-in account when user cards are unavailable', async (t) => {
  const requests = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.endsWith('/nav') ? {
      code: 0,
      data: {
        isLogin: true,
        mid: 123,
        uname: '主播小号',
        face: '//i0.hdslb.com/bfs/face/synthetic.jpg',
      },
    } : { code: -412, data: null });
  });
  const auth = loadBilibiliAuth([
    bilibiliCookie('DedeUserID', '123'),
    bilibiliCookie('SESSDATA', 'fake-session'),
    bilibiliCookie('bili_jct', 'fake-csrf'),
  ]);

  const profile = await auth.getBilibiliAccountProfile(createDataDir(t));

  assert.deepEqual(profile, {
    uid: 123,
    name: '主播小号',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/synthetic.jpg',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.bilibili.com/x/web-interface/nav');
  assert.match(requests[0].options.headers.Cookie, /SESSDATA=fake-session/);
});

test('Bilibili account profile falls back to the user card when the login profile is unavailable', async (t) => {
  const requests = [];
  t.mock.method(global, 'fetch', async (url) => {
    requests.push(url);
    if (url.endsWith('/nav')) throw new Error('synthetic network failure');
    return Response.json({
      code: 0,
      data: { card: { name: '主播小号', face: 'https://i0.hdslb.com/bfs/face/synthetic.jpg' } },
    });
  });
  const auth = loadBilibiliAuth([
    bilibiliCookie('DedeUserID', '123'),
    bilibiliCookie('SESSDATA', 'fake-session'),
    bilibiliCookie('bili_jct', 'fake-csrf'),
  ]);

  const profile = await auth.getBilibiliAccountProfile(createDataDir(t));

  assert.equal(profile.name, '主播小号');
  assert.equal(profile.avatarUrl, 'https://i0.hdslb.com/bfs/face/synthetic.jpg');
  assert.equal(requests.length, 2);
  assert.equal(requests[1], 'https://api.bilibili.com/x/web-interface/card?mid=123');
});

test('Bilibili account profile rejects another account returned by the login endpoint', async (t) => {
  t.mock.method(global, 'fetch', async (url) => Response.json({
    code: 0,
    data: url.endsWith('/nav') ? {
      isLogin: true,
      mid: 456,
      uname: '另一个账号',
      face: 'https://i0.hdslb.com/bfs/face/other.jpg',
    } : {
      card: { name: '当前账号', face: 'https://i0.hdslb.com/bfs/face/current.jpg' },
    },
  }));
  const auth = loadBilibiliAuth([
    bilibiliCookie('DedeUserID', '123'),
    bilibiliCookie('SESSDATA', 'fake-session'),
    bilibiliCookie('bili_jct', 'fake-csrf'),
  ]);

  const profile = await auth.getBilibiliAccountProfile(createDataDir(t));

  assert.equal(profile.uid, 123);
  assert.equal(profile.name, '当前账号');
  assert.equal(profile.avatarUrl, 'https://i0.hdslb.com/bfs/face/current.jpg');
});
