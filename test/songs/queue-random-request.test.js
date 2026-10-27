'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createServerRuntime } = require('../../src/server');
const { createBilibiliRuntime } = require('../../src/server/bilibili-runtime');
const { applySettingsPatch } = require('../../src/server/settings-service');
const { createSettingsStore, DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { normalizeRoomInput } = require('../../src/bilibili/room-input');
const { BilibiliApiClient } = require('../../src/bilibili/danmaku/api-client');
const { handleDanmakuMessage } = require('../../src/bilibili/bilibili-message-handler');
const { addQueueItem } = require('../../src/music/queue-service');

test('queue random uses the logged-in account and existing danmaku request rules', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-queue-random-'));
  const runtime = createServerRuntime({ dataDir });
  let account = { loggedIn: false, uid: 0 };
  const profileUids = [];
  const pendingProfile = Promise.withResolvers();
  const profileEntered = Promise.withResolvers();
  t.mock.method(BilibiliApiClient.prototype, 'fetchUserProfile', async (uid) => {
    profileUids.push(String(uid));
    if (Number(uid) === 44) { profileEntered.resolve(); await pendingProfile.promise; }
    return { name: `账号${uid}` };
  });
  t.after(async () => {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const app = await runtime.start({
    host: '127.0.0.1',
    startPort: 0,
    bilibiliAuth: {
      getAuthState: async () => account,
      getUid: async () => account.uid,
      getCookieHeader: async () => '',
    },
  });
  const token = runtime.getApiToken();
  async function post(route, body = {}) {
    const response = await fetch(`${app.baseUrl}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  }
  async function expectRejected(pattern) {
    const result = await post('/api/queue/random');
    assert.equal(result.status, 400);
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
  }

  const unauthorized = await fetch(`${app.baseUrl}/api/queue/random`, {
    method: 'POST',
  });
  assert.equal(unauthorized.status, 401);
  await expectRejected(/请先登录/);
  account = { loggedIn: true, uid: 42 };
  await post('/api/settings', {
    paused: false,
    userCooldownSeconds: 0,
    allowDuplicate: false,
  });
  await expectRejected(/没有可随机歌曲/);
  const disabled = await post('/api/songs/save', { name: '不可点歌曲' });
  await post('/api/songs/toggle', { id: disabled.data.id });
  await expectRejected(/没有可随机歌曲/);
  await post('/api/songs/save', {
    name: '测试随机歌',
    artist: '测试歌手',
    categoryName: '国语',
  });
  await post('/api/settings', { paused: true });
  await expectRejected(/暂停接收点歌/);
  await post('/api/settings', { paused: false, userCooldownSeconds: 60 });
  const accepted = await post('/api/queue/random', {
    requesterUid: 'forged',
    requesterName: '伪造账号',
    message: '点歌 伪造歌曲',
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.song_name, '测试随机歌');
  assert.equal(accepted.data.artist, '测试歌手');
  assert.equal(accepted.data.requester_uid, '42');
  assert.equal(accepted.data.requester_name, '账号42');
  assert.equal(accepted.data.source, 'random');
  assert.equal(accepted.data.category_name, '国语');
  await expectRejected(/冷却中/);
  await post('/api/settings', { userCooldownSeconds: 0 });
  await expectRejected(/已经有这首歌/);
  await post('/api/settings', { allowDuplicate: true, queueLimit: 1 });
  await expectRejected(/队列已达到上限/);
  await post('/api/queue/action', { action: 'clear' });
  account = { loggedIn: true, uid: 43 };
  const nextAccount = await post('/api/queue/random');
  assert.equal(nextAccount.data.requester_uid, '43');
  assert.equal(nextAccount.data.requester_name, '账号43');
  assert.deepEqual(profileUids, ['42', '43']);
  account = { loggedIn: true, uid: 44 };
  const changingAccount = post('/api/queue/random');
  await profileEntered.promise;
  account = { loggedIn: true, uid: 45 };
  pendingProfile.resolve();
  const cancelled = await changingAccount;
  assert.equal(cancelled.status, 400);
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.error, '直播账号或房间已变更，已取消本次随机点歌，请重试。');
  const snapshot = await fetch(`${app.baseUrl}/api/state`, { headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual((await snapshot.json()).data.queue.waiting.map((item) => item.id), [nextAccount.data.id]);
  account = { loggedIn: false, uid: 0 };
  await expectRejected(/请先登录/);
});

for (const change of ['account', 'account-away-back', 'logout-login', 'room', 'room-away-back']) {
  test(`pending random song is cancelled after ${change} without inserting or consuming cooldown`, async (t) => {
    const f = await randomFixture(t);
    const pending = f.runtime.requestRandomSong();
    await f.profileEntered.promise;
    if (change.startsWith('account')) {
      f.setAccount(84);
      if (change === 'account-away-back') f.setAccount(42);
    } else if (change === 'logout-login') {
      f.setAccount(0);
      f.setAccount(42);
    } else {
      f.setRoom('200');
      if (change === 'room-away-back') f.setRoom('100');
    }
    f.profile.resolve({ name: '账号42' });
    const result = await pending;
    assert.equal(result.accepted, false);
    assert.match(result.reason, /已取消.*请重试/);
    assert.deepEqual(f.rows, []);
    assert.equal(f.cooldown.size, 0);
  });
}

for (const phase of ['initial identity', 'final identity']) {
  test(`random song rechecks changes after awaiting the ${phase}`, async (t) => {
    const f = await randomFixture(t);
    const entered = Promise.withResolvers();
    const read = Promise.withResolvers();
    let reads = 0;
    f.provider.getRequestIdentity = async () => {
      const snapshot = { ...f.account };
      reads += 1;
      if (reads === (phase === 'initial identity' ? 1 : 2)) {
        entered.resolve();
        await read.promise;
      }
      return snapshot;
    };
    t.after(() => read.resolve());
    f.profile.resolve({ name: '账号42' });
    const pending = f.runtime.requestRandomSong();
    await entered.promise;
    f.setAccount(84);
    f.setAccount(42);
    read.resolve();
    assert.equal((await pending).accepted, false);
    assert.deepEqual(f.rows, []);
  });
}

test('same-account renewal and reconnect preserve a random request and later switches keep its queued song', async (t) => {
  const f = await randomFixture(t);
  const pending = f.runtime.requestRandomSong();
  await f.profileEntered.promise;
  f.account.sessionRevision += 1;
  f.account.cookieHeader = 'renewed-cookie';
  f.setRoom('https://live.bilibili.com/100');
  f.runtime.configure(true);
  await f.runtime.reconnect();
  f.profile.resolve({ name: '账号42' });
  const result = await pending;
  assert.equal(result.accepted, true);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].requesterUid, '42');
  assert.equal(f.rows[0].requesterGuardLevel, 3);
  assert.equal(f.cooldown.size, 0, 'zero cooldown does not persist a request timestamp');
  f.setAccount(84);
  f.setRoom('200');
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0], result.queueItem, 'an accepted song is not rolled back');
});

test('room changes committed while WeSing apply is pending still cancel a random request after switching back', async (t) => {
  const f = await randomFixture(t);
  const applyEntered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let applying = 0;
  const dependencies = {
    settings: { defaults: DEFAULT_SETTINGS, get: f.settingsStore.getSettings, setMany: f.settingsStore.setSettings },
    weSing: { async prepareConfiguration() { return { async apply() {
      applying += 1;
      if (applying === 2) applyEntered.resolve();
      await release.promise;
    } }; } },
    bilibili: f.runtime,
    broadcastSnapshot() {},
  };
  t.after(() => release.resolve());
  const pending = f.runtime.requestRandomSong();
  await f.profileEntered.promise;
  const first = applySettingsPatch(dependencies, { roomId: '200', weSingLyricOffsetMs: 100 });
  const second = applySettingsPatch(dependencies, { roomId: '100', weSingLyricOffsetMs: 200 });
  await applyEntered.promise;
  assert.equal(f.settingsStore.getSettings().roomId, '100');
  f.profile.resolve({ name: '账号42' });
  assert.equal((await pending).accepted, false);
  assert.deepEqual(f.rows, []);
  release.resolve();
  await Promise.all([first, second]);
});

test('a failed room commit preserves the pending random request', async (t) => {
  const f = await randomFixture(t);
  const pending = f.runtime.requestRandomSong();
  await f.profileEntered.promise;
  f.db.exec("CREATE TEMP TRIGGER reject_room_update BEFORE UPDATE ON settings WHEN NEW.key = 'roomId' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END");
  assert.throws(() => f.settingsStore.setSetting('roomId', '200'), /synthetic write failure/);
  f.profile.resolve({ name: '账号42' });
  assert.equal((await pending).accepted, true);
  assert.equal(f.rows.length, 1);
});

test('desktop random applies verified room gates and guard cooldowns without trusting absent medal evidence', async (t) => {
  const f = await randomFixture(t);
  f.profile.resolve({ name: '账号42' });
  f.settingsStore.setSettings({ songRequestMinMedalLevel: '1', userCooldownSeconds: '60', userCooldownCaptainSeconds: '0' });
  assert.equal((await f.runtime.requestRandomSong()).code, 'REQUESTER_MEDAL_REQUIRED');
  assert.equal(f.cooldown.size, 0);
  f.settingsStore.setSettings({ songRequestGuardMedalBypass: 'true', songRequestGuardLevel: '2' });
  assert.equal((await f.runtime.requestRandomSong()).code, 'REQUESTER_GUARD_REQUIRED');
  f.settingsStore.setSetting('songRequestGuardLevel', '3');
  assert.equal((await f.runtime.requestRandomSong()).accepted, true);
  assert.equal((await f.runtime.requestRandomSong()).accepted, true, 'verified captain override zero bypasses the general interval');
  f.settingsStore.setSetting('songRequestUserBlacklist', JSON.stringify([{ uid: '42', expiresAt: 0 }]));
  assert.equal((await f.runtime.requestRandomSong()).code, 'REQUESTER_BLACKLISTED');
  assert.equal(f.rows.length, 2);
});

async function randomFixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const settingsStore = createSettingsStore(db);
  settingsStore.setSettings({ roomId: '100', danmakuMonitoringEnabled: 'true', allowDuplicate: 'true', userCooldownSeconds: '0' });
  const account = { uid: 42, loggedIn: true, identityRevision: 0, sessionRevision: 0, cookieHeader: 'synthetic-cookie' };
  const rows = [];
  const cooldown = new Map();
  const profile = Promise.withResolvers();
  const profileEntered = Promise.withResolvers();
  const domain = {
    settings: settingsStore.getSettings,
    settingsStore: { getDefaultSettings: () => ({ userCooldownSeconds: '0' }) },
    userRequestCooldown: {
      getLastRequestAt: (key) => cooldown.get(key) || 0,
      recordAccepted: (key) => cooldown.set(key, Date.now()),
    },
    pickRandomSong: () => ({ name: '测试歌曲', artist: '测试歌手' }),
    addQueueItem: (input) => addQueueItem({
      settings: settingsStore.getSettings,
      defaults: () => ({ queueLimit: '100' }),
      store: { countActive: () => rows.length, insertRequest: (row) => { rows.push(row); return row; } },
    }, input),
  };
  const runtime = createBilibiliRuntime({
    settingsStore,
    domainServices: { messages: { handleDanmaku: (event) => handleDanmakuMessage(domain, event) } },
    broadcastSnapshot() {},
    readRoomGuardCount: async () => null,
    buildClient(roomId, context) {
      const users = context.userInfoService;
      users.setRoom({ roomId, ownerUid: roomId === '100' ? '900' : '901' });
      const run = users.beginRoomRun();
      users.ingestHint({ uid: '42', roomIdentity: { guardKnown: true, guardLevel: roomId === '100' ? 3 : 1 } },
        { ...run, source: 'danmaku', roomIdentityVerified: true });
      return {
        roomId,
        apiClient: { fetchUserProfile: () => { profileEntered.resolve(); return profile.promise; } },
        start() {},
        async restart() {},
        stop() { users.endRoomRun(run); },
      };
    },
  });
  const provider = {
    getAuthState: async () => ({ ...account }),
    getRequestIdentity: async () => ({ ...account }),
    getIdentityRevision: () => account.identityRevision,
    getSessionRevision: () => account.sessionRevision,
    getCookieHeader: async () => account.cookieHeader,
    getUid: async () => account.uid,
  };
  runtime.setAuthProvider(provider);
  t.after(() => { profile.resolve(null); runtime.stop(); db.close(); });
  await runtime.reconnect();
  return {
    runtime, db, settingsStore, account, provider, rows, cooldown, profile, profileEntered,
    setAccount(uid) {
      if (account.uid !== uid) account.identityRevision += 1;
      account.uid = uid;
      account.loggedIn = Boolean(uid);
    },
    setRoom(roomId) { settingsStore.setSetting('roomId', normalizeRoomInput(roomId)); runtime.configure(); },
  };
}
