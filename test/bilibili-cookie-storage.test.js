'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-cookie-storage-'));
  const authDir = path.join(dataDir, 'bilibili-auth');
  fs.mkdirSync(authDir);
  let cookies = [
    { name: 'DedeUserID', value: '123', domain: '.bilibili.com', path: '/' },
    { name: 'SESSDATA', value: 'synthetic-session', domain: '.bilibili.com', path: '/' },
    { name: 'bili_jct', value: 'synthetic-csrf', domain: '.bilibili.com', path: '/' },
  ];
  let encryptionAvailable = true;
  const electron = {
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (text) => Buffer.from(`encrypted:${text}`),
      decryptString: (bytes) => bytes.toString().slice('encrypted:'.length),
    },
    session: {
      fromPartition: () => ({
        cookies: { get: async () => cookies.map((cookie) => ({ ...cookie })), set: async (cookie) => cookies.push(cookie) },
        clearStorageData: async () => { cookies = []; },
      }),
    },
  };
  const modulePath = require.resolve('../src/electron/bilibili-auth');
  const originalLoad = Module._load;
  delete require.cache[modulePath];
  let auth;
  try {
    Module._load = function (request, parent, isMain) {
      return request === 'electron' ? electron : originalLoad.call(this, request, parent, isMain);
    };
    auth = require(modulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
  const previousSwitch = process.env.BILIBILI_PLAINTEXT_COOKIE_EXPORT;
  process.env.BILIBILI_PLAINTEXT_COOKIE_EXPORT = '1';
  t.after(() => {
    if (previousSwitch === undefined) delete process.env.BILIBILI_PLAINTEXT_COOKIE_EXPORT;
    else process.env.BILIBILI_PLAINTEXT_COOKIE_EXPORT = previousSwitch;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { auth, dataDir, authDir, clearCookies: () => { cookies = []; }, disableEncryption: () => { encryptionAvailable = false; } };
}

test('Bilibili login persists and restores encrypted cookies without honoring the retired export switch', async (t) => {
  const f = fixture(t);
  const saved = await f.auth.persistBilibiliCookieSnapshot(f.dataDir);
  assert.equal(saved.cookieCount, 3);
  assert.equal(fs.existsSync(path.join(f.authDir, 'cookies.enc')), true);
  assert.equal(fs.existsSync(path.join(f.authDir, 'cookies.txt')), false);
  f.clearCookies();
  await f.auth.restoreBilibiliCookieSnapshot(f.dataDir);
  assert.equal((await f.auth.getBilibiliAuthState(f.dataDir)).uid, 123);
  assert.equal((await f.auth.getBilibiliAuthState(f.dataDir)).loggedIn, true);
  assert.match(await f.auth.getBilibiliCookieHeader(), /SESSDATA=synthetic-session/);
  await f.auth.logoutBilibiliAccount(f.dataDir);
  assert.equal((await f.auth.getBilibiliAuthState(f.dataDir)).loggedIn, false);
  assert.equal(fs.existsSync(path.join(f.authDir, 'cookies.enc')), false);
});

test('a retired plaintext snapshot is removed on persistence, restoration and logout', async (t) => {
  const f = fixture(t);
  const legacyPath = path.join(f.authDir, 'cookies.txt');
  fs.writeFileSync(legacyPath, 'old-synthetic-cookie');
  await f.auth.persistBilibiliCookieSnapshot(f.dataDir);
  assert.equal(fs.existsSync(legacyPath), false);
  fs.writeFileSync(legacyPath, 'old-synthetic-cookie');
  f.clearCookies();
  await f.auth.restoreBilibiliCookieSnapshot(f.dataDir);
  assert.equal(fs.existsSync(legacyPath), false);
  fs.writeFileSync(legacyPath, 'old-synthetic-cookie');
  await f.auth.logoutBilibiliAccount(f.dataDir);
  assert.equal(fs.existsSync(legacyPath), false);
});

test('unavailable encryption never falls back to plaintext or erases the live login', async (t) => {
  const f = fixture(t);
  f.disableEncryption();
  await assert.rejects(f.auth.persistBilibiliCookieSnapshot(f.dataDir), /safeStorage/);
  assert.equal(fs.existsSync(path.join(f.authDir, 'cookies.txt')), false);
  assert.equal(fs.existsSync(path.join(f.authDir, 'cookies.enc')), false);
  assert.equal((await f.auth.getBilibiliAuthState(f.dataDir)).loggedIn, true);
});
