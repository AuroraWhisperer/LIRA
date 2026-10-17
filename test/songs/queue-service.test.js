'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { addQueueItem, handleQueueAction, getQueueSnapshot, ensureUnifiedQueue } = require('../../src/music/queue-service');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { createQueueStore } = require('../../src/storage/queue-store');
const { createSongStore } = require('../../src/storage/song-store');
const { createRequesterTargetStore } = require('../../src/storage/requester-target-store');
const { migrateQueueHistory } = require('../../src/storage/queue-history-store');
const { runMigrations } = require('../../src/storage/schema');

test('queue owner classifies expected request rejections without writing a request', () => {
  for (const [settings, count, duplicate, input, code] of [
    [{}, 0, false, {}, 'SONG_NAME_REQUIRED'],
    [{ queueLimit: '1' }, 1, false, { songName: '歌曲' }, 'QUEUE_FULL'],
    [{ onlyFromLibrary: 'true' }, 0, false, { songName: '歌曲' }, 'SONG_NOT_IN_LIBRARY'],
    [{ allowDuplicate: 'false' }, 0, true, { songName: '歌曲' }, 'SONG_ALREADY_QUEUED'],
  ]) {
    const context = { settings: () => settings, defaults: () => ({}),
      store: { countActive: () => count, findActiveBySongName: () => duplicate,
        insertRequest() { assert.fail('rejected requests must not be persisted'); } } };
    assert.throws(() => addQueueItem(context, input), { code });
  }
});

test('queue rejection codes reach HTTP and the existing optional danmaku reply', async () => {
  const { routes } = require('../../src/server/routes/queue-routes');
  const { handleDanmakuMessage } = require('../../src/bilibili/bilibili-message-handler');
  for (const code of ['QUEUE_FULL', 'SONG_NOT_IN_LIBRARY', 'SONG_ALREADY_QUEUED']) {
    const reject = () => { throw Object.assign(new Error('预期拒绝'), { code }); };
    const context = { queue: { add: reject, requestRandom: reject }, broadcastSnapshot() { assert.fail(); } };
    for (const route of ['POST /api/queue/add', 'POST /api/queue/random']) {
      const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
      await routes[route](context, { body: async () => ({ songName: '歌曲' }) }, response);
      assert.equal(response.status, 400);
      assert.equal(response.body.code, code);
    }
    for (const enabled of ['true', 'false']) {
      const result = handleDanmakuMessage({
        settings: () => ({ enableRandomTagReply: enabled }), settingsStore: { getDefaultSettings: () => ({}) },
        state: { cooldownByUser: new Map() }, addQueueItem: reject,
      }, { message: '点歌歌曲', uid: '1', userName: '观众' });
      assert.equal(result.accepted, false);
      assert.equal(result.code, code);
      assert.equal(Boolean(result.autoReply), enabled === 'true');
    }
  }
});

test('queue and request inserts roll back together when request persistence fails', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-queue-atomic-'));
  const db = createDatabases({ dataDir });
  const defaults = {
    queueLimit: '50',
    allowDuplicate: 'true',
    onlyFromLibrary: 'false',
  };

  try {
    db.songDb.exec(`
      CREATE TRIGGER fail_request_insert
      BEFORE INSERT ON requests
      BEGIN
        SELECT RAISE(ABORT, 'forced request failure');
      END
    `);

    assert.throws(
      () =>
        addQueueItem(
          {
            store: createQueueStore(db.songDb),
            settings: () => defaults,
            defaults: () => defaults,
          },
          {
            songName: 'Atomic Song',
            requesterName: 'Tester',
            message: 'request Atomic Song',
          },
        ),
      /forced request failure/,
    );

    assert.equal(db.songDb.prepare('SELECT COUNT(*) AS count FROM queue').get().count, 0);
    assert.equal(db.songDb.prepare('SELECT COUNT(*) AS count FROM requests').get().count, 0);
    assert.equal(db.songDb.prepare('SELECT COUNT(*) AS count FROM song_cooldowns').get().count, 0);
  } finally {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function historyFixture(t) {
  const scratch = path.join(__dirname, '../../tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(scratch, 'queue-history-'));
  const db = createDatabases({ dataDir });
  t.after(() => {
    closeDatabases(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const defaults = { queueLimit: '50', allowDuplicate: 'true', onlyFromLibrary: 'false' };
  const store = createQueueStore(db.songDb);
  const context = { store, settings: () => defaults, defaults: () => defaults };
  return {
    db,
    dataDir,
    store,
    context,
    settings: defaults,
    add: (input = {}) => addQueueItem(context, { songName: '保留的歌曲', ...input }),
    count: (table) => db.songDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  };
}

function requestFixture(t, settings = {}) {
  const f = historyFixture(t);
  const { createCooldownStore } = require('../../src/storage/cooldown-store');
  const { handleDanmakuMessage } = require('../../src/bilibili/bilibili-message-handler');
  const cooldownStore = createCooldownStore(f.db.songDb);
  const state = { cooldownByUser: new Map() };
  Object.assign(f.settings, { userCooldownSeconds: '0', enableRandomTagReply: 'true', ...settings });
  const messageContext = {
    settings: f.context.settings,
    settingsStore: { getDefaultSettings: f.context.defaults },
    state,
    cooldownStore,
    addQueueItem: (input) => addQueueItem(f.context, input),
    pickRandomSong: () => ({ name: '随机歌曲', artist: '歌手' }),
  };
  return { ...f, state, cooldownStore, request: (input = {}) => handleDanmakuMessage(messageContext, {
    message: '点歌测试歌曲', uid: '42', identityType: 'uid', userName: '观众', ...input,
  }) };
}

test('request controls default to unrestricted and manual library insertion keeps its existing authority', (t) => {
  const f = requestFixture(t);
  assert.equal(f.request({ uid: '', identityType: undefined }).accepted, true);
  for (const requesterGuardLevel of [0, 1, 2, 3]) {
    assert.equal(f.request({ requesterGuardLevel }).accepted, true);
  }
  Object.assign(f.settings, { userQueueLimit: '1', songRequestGuardLevel: '1', songRequestMinMedalLevel: '30',
    songRequestUserBlacklist: JSON.stringify([{ uid: '42', expiresAt: 0 }]) });
  assert.ok(f.add({ requesterUid: '42', requesterName: '主播手动点入', requesterIdentityType: 'uid' }));
});

test('disabling SC song requests keeps existing songs and ignores new SC commands without consuming cooldowns', (t) => {
  const f = requestFixture(t, { userCooldownSeconds: '60', songCooldownMode: 'hours', songCooldownValue: '1' });
  const existing = f.request({ uid: '7', source: 'superchat', isPinned: true }).queueItem;
  assert.ok(existing.id, 'missing setting preserves the existing SC behavior');
  f.settings.scSongRequestEnabled = 'false';
  const cooldownsBefore = [...f.state.cooldownByUser];
  for (const message of ['点歌另一首', '随机点歌']) {
    const result = f.request({ message, source: 'superchat', isPinned: true });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'SC 点歌已关闭。');
    assert.equal(result.autoReply, undefined, 'text-only SC does not send a song rejection reply');
    assert.equal(result.command, undefined, 'text-only SC is not parsed as a song command');
  }
  for (const table of ['queue', 'requests', 'user_cooldowns', 'song_cooldowns']) {
    assert.equal(f.count(table), 1, table);
  }
  assert.deepEqual([...f.state.cooldownByUser], cooldownsBefore);
  assert.deepEqual(getQueueSnapshot(f.context).waiting.map((item) => item.id), [existing.id]);
  assert.equal(f.request({ message: '点歌另一首', source: 'danmaku' }).accepted, true);
  f.settings.scSongRequestEnabled = 'true';
  assert.equal(f.request({ uid: '43', message: '随机点歌', source: 'superchat' }).accepted, true);
});

test('per-user quota counts LIVE and pinned songs by stable identity, rolls back rejection and frees terminal slots', (t) => {
  const f = requestFixture(t, { userQueueLimit: '2' });
  const first = f.request().queueItem;
  handleQueueAction(f.context, 'live', first.id);
  assert.equal(f.request({ message: '随机点歌', isPinned: true }).accepted, true);
  const cooldownBefore = f.state.cooldownByUser.get('42');
  const songCooldownsBefore = f.db.songDb.prepare('SELECT * FROM song_cooldowns').all();
  const rejected = f.request({ message: '点歌新歌', userName: '改名', source: 'superchat', isPinned: true });
  assert.equal(rejected.code, 'USER_QUEUE_FULL');
  assert.match(rejected.autoReply.message, /最多同时排队 2 首/);
  assert.equal(f.count('queue'), 2);
  assert.equal(f.count('requests'), 2);
  assert.equal(f.state.cooldownByUser.get('42'), cooldownBefore);
  assert.deepEqual(f.db.songDb.prepare('SELECT * FROM song_cooldowns').all(), songCooldownsBefore);
  assert.equal(getQueueSnapshot(f.context).waiting[0].id, first.id, 'a refused SC cannot displace LIVE');
  assert.equal(f.request({ identityType: 'open_id' }).accepted, true, 'open_id and UID do not share a quota');
  assert.equal(f.request({ uid: '43', userName: '改名' }).accepted, true, 'equal nicknames do not share a quota');
  handleQueueAction(f.context, 'done', first.id);
  assert.equal(f.request().accepted, true);
  f.context.store = createQueueStore(f.db.songDb);
  f.state.cooldownByUser.clear();
  f.cooldownStore.loadInto(f.state.cooldownByUser);
  assert.equal(f.request().code, 'USER_QUEUE_FULL', 'recreating the service cannot reset a persisted quota');
  handleQueueAction(f.context, 'clear');
  assert.equal(f.request().accepted, true);
});

test('enabled quotas and cooldowns require stable identity without using display names', (t) => {
  const f = requestFixture(t, { userQueueLimit: '1' });
  for (const identity of [{ uid: '' }, { uid: 'not-a-uid' }, { uid: '123', identityType: 'unknown' }]) {
    assert.equal(f.request(identity).code, 'REQUESTER_IDENTITY_REQUIRED');
  }
  f.settings.userQueueLimit = '0';
  f.settings.userCooldownSeconds = '60';
  assert.equal(f.request({ uid: '', userName: '同名观众' }).code, 'REQUESTER_IDENTITY_REQUIRED');
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('user_cooldowns'), 0);
});

test('UID blacklist applies to ordinary, random and pinned SC requests and expires without consuming cooldown', (t) => {
  const f = requestFixture(t, { userCooldownSeconds: '60', songRequestUserBlacklist: JSON.stringify([
    { uid: '42', name: '旧昵称', expiresAt: 0 }, { uid: '43', expiresAt: Date.now() - 1 },
    { uid: '44', expiresAt: Date.now() + 60000 },
  ]) });
  for (const event of [{}, { message: '随机点歌' }, { source: 'superchat', isPinned: true }]) {
    const result = f.request({ userName: '新昵称', ...event });
    assert.equal(result.code, 'REQUESTER_BLACKLISTED');
    assert.match(result.autoReply.message, /被限制点歌/);
  }
  assert.equal(f.request({ uid: '44' }).code, 'REQUESTER_BLACKLISTED');
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('user_cooldowns'), 0);
  assert.equal(f.count('song_cooldowns'), 0);
  assert.equal(f.request({ uid: '43' }).accepted, true);
  assert.equal(f.request({ identityType: 'open_id' }).code, 'REQUESTER_IDENTITY_REQUIRED');
  f.settings.songRequestUserBlacklist = JSON.stringify([{ uid: '42', expiresAt: Date.now() - 1 }]);
  assert.equal(f.request().accepted, true, 'expired entries need no manual cleanup');
  assert.equal(f.request({ uid: 'opaque', identityType: 'open_id' }).accepted, true, 'an expired-only list no longer requires a numeric UID');
});

test('membership gates use verified current-room evidence, combine requirements and preserve failed cooldowns', (t) => {
  const f = requestFixture(t, { songRequestMinMedalLevel: '10', userCooldownSeconds: '60' });
  for (const input of [{}, { requesterMedalLevel: 30 }, { requesterMedalVerified: true, requesterMedalLevel: 9 },
    { currentRoomVerified: true, requesterMedalVerified: false, requesterMedalLevel: 30 }]) {
    assert.equal(f.request(input).code, 'REQUESTER_MEDAL_REQUIRED');
  }
  assert.equal(f.request({ requesterMedalVerified: true, requesterMedalLevel: 10 }).accepted, true);
  assert.equal(f.count('user_cooldowns'), 1, 'failed qualifications do not consume the successful attempt');
  f.settings.userCooldownSeconds = '0';
  f.settings.songRequestGuardMedalBypass = 'true';
  assert.equal(f.request({ requesterGuardLevel: 1 }).code, 'REQUESTER_MEDAL_REQUIRED', 'an unverified guard cannot waive a medal');
  assert.equal(f.request({ requesterGuardLevel: 3, requesterGuardVerified: true }).accepted, true);
  f.settings.songRequestGuardLevel = '2';
  assert.equal(f.request({ requesterGuardLevel: 3, requesterGuardVerified: true }).code, 'REQUESTER_GUARD_REQUIRED');
  assert.equal(f.request({ requesterGuardLevel: 2, requesterGuardVerified: true }).accepted, true);
  f.settings.songRequestGuardMedalBypass = 'false';
  assert.equal(f.request({ requesterGuardLevel: 1, requesterGuardVerified: true }).code, 'REQUESTER_MEDAL_REQUIRED');
  assert.equal(f.request({ requesterGuardLevel: 1, requesterGuardVerified: true,
    requesterMedalVerified: true, requesterMedalLevel: 10 }).accepted, true);
});

test('all guard thresholds accept their tier and stronger tiers only', (t) => {
  const f = requestFixture(t);
  for (const threshold of [1, 2, 3]) {
    f.settings.songRequestGuardLevel = String(threshold);
    for (const level of [0, 1, 2, 3]) {
      const result = f.request({ requesterGuardLevel: level, requesterGuardVerified: true });
      assert.equal(result.accepted, level > 0 && level <= threshold, `required ${threshold}, actual ${level}`);
    }
  }
});

test('each verified guard tier has an independent cooldown with empty inheritance and explicit zero', (t) => {
  const f = requestFixture(t, { userCooldownSeconds: '60' });
  const at = Date.now();
  t.mock.method(Date, 'now', () => at);
  for (const [level, key] of [[1, 'userCooldownGovernorSeconds'], [2, 'userCooldownAdmiralSeconds'], [3, 'userCooldownCaptainSeconds']]) {
    const event = { uid: String(level), requesterGuardLevel: level, requesterGuardVerified: true };
    f.settings[key] = '';
    assert.equal(f.request(event).accepted, true);
    assert.match(f.request(event).reason, /还需 60 秒/);
    f.settings[key] = '10';
    assert.match(f.request(event).reason, /还需 10 秒/);
    f.settings[key] = '0';
    assert.equal(f.request(event).accepted, true);
    assert.match(f.request({ ...event, requesterGuardVerified: false }).reason, /还需 60 秒/,
      'an unverified tier falls back to the general interval');
  }
  const event = { uid: '4' };
  assert.equal(f.request(event).accepted, true);
  assert.equal(f.request({ ...event, identityType: 'open_id' }).accepted, true);
  assert.match(f.request({ ...event, userName: '改名' }).reason, /冷却中/);
  f.state.cooldownByUser.clear();
  f.cooldownStore.loadInto(f.state.cooldownByUser);
  assert.match(f.request(event).reason, /还需 60 秒/);
  assert.match(f.request({ ...event, identityType: 'open_id' }).reason, /还需 60 秒/);
});

test('guard priority orders all four identities stably and can be disabled for the existing queue', (t) => {
  const f = historyFixture(t);
  const levels = [0, 3, 2, 1, 1, 3, 2, 0];
  const items = levels.map((requesterGuardLevel, i) => f.add({ songName: `歌曲 ${i}`, requesterGuardLevel }));
  const ids = () => getQueueSnapshot(f.context).waiting.map((item) => item.id);
  assert.deepEqual(ids(), items.map((item) => item.id));
  f.settings.guardPriorityEnabled = 'true';
  assert.deepEqual(ids(), [3, 4, 2, 6, 1, 5, 0, 7].map((i) => items[i].id));
  handleQueueAction(f.context, 'next');
  assert.equal(ids()[0], items[4].id, 'completion uses the same order as the snapshot');
  f.settings.guardPriorityEnabled = 'false';
  assert.deepEqual(ids(), items.filter((_, i) => i !== 3).map((item) => item.id));
});

test('LIVE protects the first song from identity priority and every manual pin', (t) => {
  const f = historyFixture(t);
  f.settings.guardPriorityEnabled = 'true';
  const live = f.add();
  handleQueueAction(f.context, 'live', live.id);
  const governor = f.add({ requesterGuardLevel: 1 });
  const manual = f.add();
  const newest = f.add();
  const ids = () => getQueueSnapshot(f.context).waiting.map((item) => item.id);
  handleQueueAction(f.context, 'pin', manual.id);
  handleQueueAction(f.context, 'pin', newest.id);
  assert.deepEqual(ids(), [live.id, newest.id, manual.id, governor.id]);
  assert.equal(getQueueSnapshot(f.context).waiting[0].is_live, true);
  handleQueueAction(f.context, 'unlive', live.id);
  assert.deepEqual(ids(), [newest.id, manual.id, governor.id, live.id]);
  assert.equal(getQueueSnapshot(f.context).waiting.some((item) => item.is_live), false);
  handleQueueAction(f.context, 'unpin', newest.id);
  assert.deepEqual(ids(), [manual.id, governor.id, live.id, newest.id]);
});

test('LIVE rejects a stale or invalid selection without changing the actual head', (t) => {
  const f = historyFixture(t);
  const first = f.add();
  const second = f.add();
  const before = getQueueSnapshot(f.context);
  for (const id of [second.id, 999, null, [], {}, 'x', 1.5]) {
    assert.throws(() => handleQueueAction(f.context, 'live', id), { code: 'QUEUE_LIVE_NOT_FIRST' });
    assert.deepEqual(getQueueSnapshot(f.context), before);
  }
  handleQueueAction(f.context, 'live', first.id);
  handleQueueAction(f.context, 'live', first.id);
  assert.equal(getQueueSnapshot(f.context).waiting.filter((item) => item.is_live).length, 1);
});

test('a stale LIVE HTTP action returns a conflict without broadcasting a mutation', async () => {
  const { routes } = require('../../src/server/routes/queue-routes');
  const context = {
    queue: { handleAction() { throw Object.assign(new Error('队首已变化'), { code: 'QUEUE_LIVE_NOT_FIRST' }); } },
    broadcastSnapshot() { assert.fail('a rejected action must not broadcast'); },
  };
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  await routes['POST /api/queue/action'](context, { body: async () => ({ action: 'live', id: 99 }) }, res);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'QUEUE_LIVE_NOT_FIRST');
});

test('LIVE survives reopening and terminal actions never transfer it to the next song', (t) => {
  const f = historyFixture(t);
  const first = f.add();
  f.add();
  handleQueueAction(f.context, 'live', first.id);
  const reopened = createDatabases({ dataDir: f.dataDir });
  try {
    const context = { ...f.context, store: createQueueStore(reopened.songDb) };
    ensureUnifiedQueue(context);
    assert.equal(getQueueSnapshot(context).waiting[0].is_live, true);
  } finally {
    closeDatabases(reopened);
  }
  for (const action of ['next', 'done', 'skip', 'delete', 'clear']) {
    const head = getQueueSnapshot(f.context).waiting[0] || f.add();
    f.add();
    handleQueueAction(f.context, 'live', head.id);
    handleQueueAction(f.context, action, head.id);
    assert.equal(getQueueSnapshot(f.context).waiting.some((item) => item.is_live), false, action);
  }
});

test('terminal queue actions remove raw rows immediately while active requests remain available', (t) => {
  const f = historyFixture(t);
  const first = f.add({ message: '第一条点歌弹幕' });
  const second = f.add({ songName: '正在排队', message: '第二条点歌弹幕' });
  f.store.setStatus(second.id, 'current', '2026-10-12T00:00:00Z');
  assert.equal(f.count('requests'), 2);
  f.store.setStatus(first.id, 'done', '2026-10-12T00:01:00Z');
  assert.equal(f.count('queue'), 1);
  assert.equal(f.count('requests'), 1);
  assert.equal(f.store.listActive()[0].request_message, '第二条点歌弹幕');
  assert.equal(f.store.clearActive('2026-10-12T00:02:00Z'), 1);
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('requests'), 0);
  assert.equal(f.store.clearActive('2026-10-12T00:03:00Z'), 0);
  assert.equal(f.store.completeNext('2026-10-12T00:03:00Z'), false);
});

test('a failed queue deletion rolls back removal of its request row', (t) => {
  const f = historyFixture(t);
  f.add();
  const before = f.store.listActive();
  f.db.songDb.exec(`CREATE TRIGGER fail_queue_delete BEFORE DELETE ON queue BEGIN
    SELECT RAISE(ABORT, 'forced queue deletion failure');
  END`);
  assert.throws(() => f.store.completeNext('2026-10-12T00:00:00Z'), /forced queue deletion failure/);
  assert.deepEqual(f.store.listActive(), before);
  assert.equal(f.count('requests'), 1);
  f.db.songDb.exec('DROP TRIGGER fail_queue_delete');
  assert.equal(f.store.completeNext('2026-10-12T00:00:00Z'), true);
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('requests'), 0);
});

test('random avoidance and mention target survive clearing with a bounded restart-safe history', (t) => {
  const f = historyFixture(t);
  for (let i = 0; i < 12; i++) {
    f.add({
      songName: `随机歌曲 ${i}`,
      source: i % 2 ? 'random:国语' : 'random',
      requesterUid: String(100 + i),
      requesterName: `观众 ${i}`,
      createdAt: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    });
    f.store.clearActive('2026-10-12T01:00:00Z');
  }
  f.add({ songName: '普通点歌', requesterUid: '999', requesterName: '普通点歌人' });
  f.store.clearActive('2026-10-12T02:00:00Z');
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('requests'), 0);
  assert.equal(f.count('random_request_history'), 10);
  const reopened = createDatabases({ dataDir: f.dataDir });
  try {
    assert.deepEqual(createSongStore(reopened.songDb).listRecentRandomSongNames(),
      Array.from({ length: 10 }, (_, i) => `随机歌曲 ${11 - i}`));
    assert.deepEqual(createRequesterTargetStore(reopened.songDb).getLatestRandomRequester(), {
      uid: '111', name: '观众 11', source: 'random:国语', createdAt: '2026-10-12T00:00:00.000Z',
    });
  } finally {
    closeDatabases(reopened);
  }
});

test('failed random history persistence rolls back the accepted queue and request', (t) => {
  const f = historyFixture(t);
  f.db.songDb.exec(`CREATE TRIGGER fail_random_history BEFORE INSERT ON random_request_history BEGIN
    SELECT RAISE(ABORT, 'forced random history failure');
  END`);
  assert.throws(() => f.add({ source: 'random' }), /forced random history failure/);
  for (const table of ['queue', 'requests', 'random_request_history', 'song_cooldowns']) {
    assert.equal(f.count(table), 0, table);
  }
});

test('queue history migration preserves active requests and only the required bounded random state', (t) => {
  const f = historyFixture(t);
  const active = f.add({ songName: '仍在排队', message: '保留上下文' });
  const current = f.add({ songName: '正在处理' });
  f.store.setStatus(current.id, 'current', '2026-10-12T00:00:00Z');
  const completed = f.add({ songName: '过去的普通点歌' });
  f.db.songDb.prepare("UPDATE queue SET status = 'done' WHERE id = ?").run(completed.id);
  const insert = f.db.songDb.prepare(`INSERT INTO requests
    (song_name, requester_uid, requester_name, source, created_at) VALUES (?, ?, ?, ?, ?)`);
  for (let i = 0; i < 15; i++) {
    insert.run(`旧随机 ${i}`, i === 0 ? '123' : '', i === 0 ? '旧点歌人' : '',
      'random:流行', `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`);
  }
  insert.run('没有队列的旧普通点歌', '', '', 'admin', '2026-09-01T00:00:00Z');
  migrateQueueHistory(f.db.songDb);
  assert.deepEqual(f.store.listActive().map((row) => row.id), [active.id, current.id]);
  assert.equal(f.count('queue'), 2);
  assert.equal(f.count('requests'), 2);
  assert.equal(f.count('random_request_history'), 11);
  assert.deepEqual(createSongStore(f.db.songDb).listRecentRandomSongNames(),
    Array.from({ length: 10 }, (_, i) => `旧随机 ${14 - i}`));
  assert.equal(createRequesterTargetStore(f.db.songDb).getLatestRandomRequester().uid, '123');
  const before = f.db.songDb.prepare('SELECT * FROM random_request_history ORDER BY request_id').all();
  migrateQueueHistory(f.db.songDb);
  assert.deepEqual(f.db.songDb.prepare('SELECT * FROM random_request_history ORDER BY request_id').all(), before);
  assert.equal(f.count('requests'), 2);
});

test('queue history migration rolls back the compact state and removals if cleanup fails', (t) => {
  const f = historyFixture(t);
  const old = f.add();
  f.db.songDb.prepare("UPDATE queue SET status = 'deleted' WHERE id = ?").run(old.id);
  f.db.songDb.prepare("UPDATE requests SET source = 'random', requester_uid = '123' WHERE queue_id = ?")
    .run(old.id);
  f.db.songDb.exec(`DROP TABLE IF EXISTS random_request_history;
    CREATE TRIGGER fail_queue_delete BEFORE DELETE ON queue BEGIN
      SELECT RAISE(ABORT, 'forced queue deletion failure');
    END`);
  assert.throws(() => runMigrations(f.db.songDb, 'queue_cleanup_test', [migrateQueueHistory]),
    /forced queue deletion failure/);
  assert.equal(f.count('requests'), 1);
  assert.equal(f.count('queue'), 1);
  assert.equal(f.db.songDb.prepare("SELECT name FROM sqlite_master WHERE name = 'random_request_history'").get(), undefined);
  f.db.songDb.exec('DROP TRIGGER fail_queue_delete');
  runMigrations(f.db.songDb, 'queue_cleanup_test', [migrateQueueHistory]);
  assert.equal(f.count('requests'), 0);
  assert.equal(f.count('queue'), 0);
  assert.equal(f.count('random_request_history'), 1);
});
