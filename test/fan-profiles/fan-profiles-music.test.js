'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { addQueueItem, handleQueueAction, getQueueSnapshot } = require('../../src/music/queue-service');
const { createQueueStore } = require('../../src/storage/queue-store');
const { clearSongDataInTransaction } = require('../../src/storage/database-clear-operations');
const { createDomainServices } = require('../../src/server/domain-services');
const { createSettingsStore } = require('../../src/storage/settings-store');
const { migrateFanSongRetention } = require('../../src/storage/fan-song-migration');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('../helpers/fan-profile-fixture');

function music(f, options = {}) {
  const settings = { queueLimit: '50', allowDuplicate: 'true', onlyFromLibrary: 'false', ...options.settings };
  const store = createQueueStore(f.db.songDb, {
    getFanScope: () => options.scope ?? SCOPE,
    archiveAccepted: options.archiveAccepted || f.service.archiveAccepted,
  });
  const context = { store, settings: () => settings, defaults: () => settings, findSong: options.findSong };
  return {
    context,
    settings,
    add: (input = {}) =>
      addQueueItem(context, {
        songName: '虚构曲目 A',
        artist: '虚构歌手',
        categoryName: '粤语',
        requesterUid: IDENTITY.value,
        requesterIdentityType: 'uid',
        requesterName: '海边听歌',
        createdAt: NOW,
        ...input,
      }),
  };
}

function acceptedSnapshot(f, requestId) {
  const row = f.db.songDb.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  return {
    stableId: row.stable_id,
    requestId: row.id,
    queueId: row.queue_id,
    songName: row.song_name,
    artist: row.artist,
    categoryName: row.category_name,
    requesterUid: row.requester_uid,
    identityType: row.identity_type,
    requesterName: row.requester_name,
    createdAt: row.created_at,
    source: row.source,
  };
}

test('ordinary danmaku requests archive library and non-library songs through the same accepted queue path', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const f = fanFixture(t);
  const profile = f.create();
  const settingsStore = createSettingsStore(f.db.songDb);
  for (const [key, value] of Object.entries({ onlyFromLibrary: 'false', allowDuplicate: 'true', userCooldownSeconds: '0' })) {
    settingsStore.setSetting(key, value);
  }
  const services = createDomainServices({ db: f.db, settingsStore, getFanScope: () => SCOPE });
  services.songs.save({ name: '库内歌曲', artist: '测试歌手', categoryName: '国语' });
  for (const songName of ['库内歌曲', '歌库外歌曲', '歌库外歌曲']) {
    const result = services.messages.handleDanmaku({
      message: `点歌 ${songName}`, userName: '海边听歌', uid: IDENTITY.value,
      identityType: 'uid', fanScope: SCOPE, messageTimestamp: NOW,
    });
    assert.equal(result.accepted, true);
  }
  const requests = f.db.songDb.prepare('SELECT song_id, song_name FROM requests ORDER BY id').all();
  assert.ok(requests[0].song_id);
  assert.equal(requests[1].song_id, null);
  assert.equal(requests[2].song_id, null);
  assert.equal(f.detail(profile.id).musicStats.count, 3);
  assert.equal(f.detail(profile.id).songs.find((record) => record.data.songName === '歌库外歌曲').data.count, 2);
  f.restart();
  assert.equal(f.detail(profile.id).songs.length, 2, 'accepted requests are durably grouped without reopening the profile page');
});

test('song category statistics count arbitrary valid names as ordinary keys', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  for (const categoryName of ['__proto__', '__proto__', 'constructor', 'toString', '粤语']) {
    queue.add({ categoryName });
  }
  const stats = f.detail(p.id).musicStats;
  assert.equal(stats.count, 5);
  assert.equal(Object.hasOwn(stats.categories, '__proto__'), true);
  assert.equal(stats.categories.__proto__, 2);
  assert.equal(stats.categories.constructor, 1);
  assert.equal(stats.categories.toString, 1);
  assert.equal(stats.categories['粤语'], 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(stats.categories)),
    JSON.parse('{"__proto__":2,"constructor":1,"toString":1,"粤语":1}'),
  );
});

test('A04: duplicate callbacks count once, while the next real request increments the same song', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  const first = queue.add();
  const snapshot = acceptedSnapshot(f, first.id);
  f.service.archiveAccepted(SCOPE, snapshot);
  f.service.archiveAccepted(SCOPE, snapshot);
  assert.equal(f.detail(p.id).songs.length, 1);
  assert.equal(f.detail(p.id).songs[0].data.count, 1);
  assert.equal(f.db.songDb.prepare('SELECT fan_recorded FROM requests WHERE id = ?').get(first.id).fan_recorded, 1);
  f.setNow('2026-09-19T04:00:00Z');
  queue.add({ createdAt: '2026-09-19T04:00:00Z' });
  const songs = f.detail(p.id).songs;
  assert.equal(songs.length, 1);
  assert.equal(songs[0].data.count, 2);
  assert.deepEqual(songs[0].data.recentDates, ['2026-09-19', '2026-09-18']);
  assert.deepEqual(songs[0].original, {});
  assert.deepEqual(songs[0].revisions, []);
});

test('A05: invalid, rejected duplicate and full-queue requests do not create fan song records', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f, { settings: { allowDuplicate: 'false' } });
  assert.throws(() => queue.add({ songName: '' }), /不能为空/);
  assert.equal(f.detail(p.id).songs.length, 0);
  queue.add();
  assert.throws(() => queue.add(), /已经有这首歌/);
  queue.settings.queueLimit = '1';
  assert.throws(() => queue.add({ songName: '虚构曲目 B' }), /达到上限/);
  assert.equal(f.detail(p.id).songs.length, 1);
  assert.equal(f.detail(p.id).songs[0].data.count, 1);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 1);
});

test('A17/A26: a fan archive failure rolls back request and queue before success can be acknowledged', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.db.songDb.exec(`CREATE TRIGGER fail_fan_song BEFORE INSERT ON fan_records
    WHEN NEW.kind = 'song' BEGIN SELECT RAISE(ABORT, 'forced fan archive failure'); END;`);
  assert.throws(() => music(f).add(), /forced fan archive failure/);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM queue').get().n, 0);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 0);
  assert.equal(f.detail(p.id).songs.length, 0);
  assert.equal(f.detail(p.id).platformName, '');
  f.db.songDb.exec('DROP TRIGGER fail_fan_song');
  music(f).add();
  f.restart();
  assert.equal(f.detail(p.id).songs.length, 1, 'successful requests already contain a durable archive on restart');
  const before = f.detail(p.id);
  f.db.songDb.exec(`CREATE TRIGGER fail_fan_song_update BEFORE UPDATE ON fan_records
    WHEN NEW.kind = 'song' BEGIN SELECT RAISE(ABORT, 'forced aggregate update failure'); END;`);
  assert.throws(() => music(f).add({ requesterName: '不应写入的新昵称' }), /forced aggregate update failure/);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 1);
  assert.deepEqual(f.detail(p.id), before, 'failed increments preserve the count and observed profile fields');
});

test('A06/A26/A27: restart and full source clearing retain counts without reviving old callbacks after ID reuse', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const first = music(f).add();
  const snapshot = acceptedSnapshot(f, first.id);
  f.restart();
  f.db.songDb.exec('BEGIN');
  clearSongDataInTransaction(f.db.songDb, {});
  f.db.songDb.exec('COMMIT');
  assert.equal(f.detail(p.id).songs.length, 1);
  assert.equal(f.detail(p.id).songs[0].data.artist, '虚构歌手');
  f.service.archiveAccepted(SCOPE, snapshot);
  assert.equal(f.detail(p.id).songs[0].data.count, 1, 'a removed receipt cannot contribute again');
  f.setNow('2026-09-19T04:00:00Z');
  const second = music(f).add({ createdAt: '2026-09-19T04:00:00Z' });
  assert.equal(second.id, first.id, 'the SQL autoincrement number really was reused');
  assert.equal(f.detail(p.id).songs[0].data.count, 2);
  f.service.archiveAccepted(SCOPE, snapshot);
  assert.equal(f.detail(p.id).songs[0].data.count, 2, 'an old stable UUID cannot claim the reused request number');
  f.restart();
  assert.equal(f.detail(p.id).songs.length, 1);
  assert.equal(f.detail(p.id).songs[0].data.count, 2);
});

test('A07: manual preferences never increment request statistics or get overwritten by accepted requests', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'preference', { sentiment: 'like', label: '粤语', reason: '本人确认' });
  assert.equal(f.detail(p.id).musicStats.count, 0);
  music(f).add();
  music(f).add({ source: 'random', songName: '随机曲目' });
  const actual = f.detail(p.id);
  assert.equal(actual.songs.length, 1);
  assert.equal(actual.musicStats.count, 1);
  assert.equal(actual.musicStats.categories['粤语'], 1);
  assert.equal(actual.preferences[0].data.reason, '本人确认');
  assert.equal(actual.musicSummary, '喜欢粤语');
});

for (const source of ['random', 'random:粤语+流行']) {
  test(`${source} requests stay in the queue without creating fan song records`, (t) => {
    const f = fanFixture(t);
    const p = f.create();
    const queue = music(f);
    const item = queue.add({ source, songName: '随机曲目' });
    const snapshot = acceptedSnapshot(f, item.id);
    assert.equal(getQueueSnapshot(queue.context).waiting[0].id, item.id);
    assert.equal(item.source, source);
    const actual = f.detail(p.id);
    assert.equal(actual.songs.length, 0);
    assert.equal(actual.records.filter((record) => record.kind === 'song').length, 0);
    assert.equal(actual.musicStats.count, 0);
    assert.equal(actual.musicSummary, '');

    f.service.archiveAccepted(SCOPE, snapshot);
    handleQueueAction(queue.context, 'done', item.id);
    f.restart();
    assert.equal(f.detail(p.id).songs.length, 0);
    assert.equal(f.db.songDb.prepare("SELECT COUNT(*) AS n FROM fan_records WHERE kind = 'song'").get().n, 0);
  });
}

test('A23: a manual supplement increments the summary, preserves its note and cannot edit individual requests', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  const accepted = queue.add();
  const initial = f.detail(p.id).songs[0];
  const supplemented = f.record(
    p.id,
    'song',
    { songName: '虚构曲目 A', artist: '虚构歌手', category: '粤语', note: '之前补记的说明' },
    { occurredAt: '2026-09-17T04:00:00Z' },
  );
  const actual = f.detail(p.id);
  assert.equal(actual.songs.length, 1);
  assert.equal(supplemented.id, initial.id);
  assert.equal(supplemented.data.count, 2);
  assert.equal(supplemented.data.note, '之前补记的说明');
  assert.deepEqual(supplemented.data.recentDates, ['2026-09-18', '2026-09-17']);
  assert.deepEqual(supplemented.original, {});
  assert.deepEqual(supplemented.revisions, []);
  assert.equal(actual.musicStats.count, 2);
  assert.throws(() => f.record(p.id, 'song', { songName: '修正歌名' },
    { id: supplemented.id, revision: supplemented.revision }), /不再保存或编辑逐次记录/);
  f.service.archiveAccepted(SCOPE, acceptedSnapshot(f, accepted.id));
  assert.deepEqual(f.detail(p.id).songs, actual.songs, 'the original queue callback cannot repeat a supplemented count');
  const other = f.record(p.id, 'song', { songName: '虚构曲目 A', artist: '另一位歌手', category: '国语' });
  assert.notEqual(other.id, supplemented.id);
  assert.equal(f.detail(p.id).songs.length, 2, 'the same title by a different artist remains distinct');
});

test('A14/A15: accepted requests bind their captured scope and explicit identity namespace', (t) => {
  const f = fanFixture(t);
  const a = f.create();
  const bScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  f.run('configure', { autoCreate: true, autoUpdate: true }, bScope);
  const b = f.create({}, bScope);
  const openId = f.create({ identity: { ...IDENTITY, type: 'open_id' } });
  const queue = music(f);
  queue.add({ requesterIdentityType: 'open_id' });
  assert.equal(f.detail(openId.id).songs.length, 1);
  assert.equal(f.detail(a.id).songs.length, 0);
  music(f, { scope: bScope }).add();
  assert.equal(f.detail(b.id, bScope).songs.length, 1);
  assert.equal(f.detail(a.id).songs.length, 0);
  queue.add({ requesterIdentityType: undefined });
  assert.equal(f.detail(a.id).songs.length, 0, 'ambiguous UID-shaped values cannot be inferred as UID');
});

test('A16: queue snapshots contain no profile private fields and queue completion is not singing evidence', (t) => {
  const f = fanFixture(t);
  const p = f.create({ notes: '仅主播可见的备注', birthday: { monthDay: '09-19' }, mbti: 'INFP' });
  const queue = music(f);
  const item = queue.add();
  const snapshot = JSON.stringify(getQueueSnapshot(queue.context));
  assert.equal(snapshot.includes('仅主播可见的备注'), false);
  assert.equal(snapshot.includes('birthday'), false);
  assert.equal(snapshot.includes('INFP'), false);
  handleQueueAction(queue.context, 'done', item.id);
  const song = f.detail(p.id).songs[0];
  assert.equal(Object.hasOwn(song.data, 'state'), false);
  assert.equal(song.data.count, 1);
  assert.equal(f.detail(p.id).songs.length, 1);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM queue').get().n, 0);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 0);
});

test('queue completion preserves the aggregate and manual note without saving queue state or revisions', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  f.record(
    p.id,
    'song',
    { songName: '虚构曲目 A', artist: '虚构歌手', category: '国语', note: '保留的人工说明' },
    { occurredAt: '2026-09-17T04:00:00Z' },
  );
  const item = queue.add();
  const callback = acceptedSnapshot(f, item.id);
  const initial = f.detail(p.id).songs[0];
  assert.equal(initial.data.count, 2);
  const changedAt = '2026-09-18T05:00:00.000Z';
  assert.equal(queue.context.store.completeNext(changedAt), true);
  const processed = f.detail(p.id).songs[0];
  assert.deepEqual(processed, initial);
  assert.equal(processed.data.note, '保留的人工说明');
  assert.deepEqual(processed.original, {});
  assert.deepEqual(processed.revisions, []);
  assert.equal(queue.context.store.completeNext(changedAt), false);
  f.service.archiveAccepted(SCOPE, callback);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 0);
  f.restart();
  assert.deepEqual(f.detail(p.id).songs[0], initial);
});

test('terminal queue statuses and repeated callbacks cannot recount or recreate a removed request', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  for (const [index, status] of ['skipped', 'done', 'deleted'].entries()) {
    const item = queue.add();
    const callback = acceptedSnapshot(f, item.id);
    const initial = f.detail(p.id).songs[0];
    queue.context.store.setStatus(item.id, status, NOW);
    queue.context.store.setStatus(item.id, status, NOW);
    queue.context.store.setStatus(item.id, 'waiting', NOW);
    f.service.archiveAccepted(SCOPE, callback);
    assert.deepEqual(f.detail(p.id).songs[0], initial);
    assert.equal(initial.data.count, index + 1);
    assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM queue').get().n, 0);
    assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 0);
  }
});

test('clearActive removes every active request while retaining all song totals and statistics', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  const first = queue.add({ songName: '已处理的曲目' });
  queue.add({ songName: '等待中的曲目 A' });
  queue.add({ songName: '等待中的曲目 B' });
  queue.context.store.setStatus(first.id, 'done', NOW);
  const before = f.detail(p.id);
  assert.equal(queue.context.store.clearActive(NOW), 2);
  const after = f.detail(p.id);
  assert.equal(after.songs.length, 3);
  assert.equal(after.musicStats.count, before.musicStats.count);
  assert.equal(queue.context.store.countActive(), 0);
  assert.deepEqual(after.songs, before.songs);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 0);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM queue').get().n, 0);
  assert.equal(queue.context.store.clearActive(NOW), 0);
  assert.deepEqual(f.detail(p.id).songs, after.songs);
});

for (const action of ['completeNext', 'setStatus', 'clearActive']) {
  test(`${action} rolls back queue and request removal without altering fan counts when deletion fails`, (t) => {
    const f = fanFixture(t);
    const p = f.create();
    const queue = music(f);
    const first = queue.add();
    const second = queue.add({ songName: '第二首事务内曲目' });
    const failedId = action === 'clearActive' ? second.id : first.id;
    f.db.songDb.exec(`CREATE TRIGGER fail_queue_removal BEFORE DELETE ON queue
      WHEN OLD.id = ${failedId} BEGIN SELECT RAISE(ABORT, 'forced queue removal failure'); END;`);
    const rows = () => f.db.songDb.prepare('SELECT * FROM queue ORDER BY id').all();
    const beforeQueue = rows();
    const beforeRequests = f.db.songDb.prepare('SELECT * FROM requests ORDER BY id').all();
    const beforeSongs = f.detail(p.id).songs;
    const apply = () =>
      action === 'setStatus'
        ? queue.context.store.setStatus(first.id, 'done', '2026-09-18T05:00:00Z')
        : queue.context.store[action]('2026-09-18T05:00:00Z');
    assert.throws(apply, /forced queue removal failure/);
    assert.deepEqual(rows(), beforeQueue);
    assert.deepEqual(f.db.songDb.prepare('SELECT * FROM requests ORDER BY id').all(), beforeRequests);
    assert.deepEqual(f.detail(p.id).songs, beforeSongs);
    assert.doesNotThrow(() => f.db.songDb.exec('BEGIN; ROLLBACK;'), 'failed status savepoint is released');
    f.db.songDb.exec('DROP TRIGGER fail_queue_removal');
    apply();
    assert.equal(rows().length, action === 'clearActive' ? 0 : 1);
    assert.deepEqual(f.detail(p.id).songs, beforeSongs);
  });
}

test('clearing shared queue rows leaves each streamer aggregate intact and ignores captured scope mismatches', (t) => {
  const f = fanFixture(t);
  const a = f.create();
  const bScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  f.run('configure', { autoCreate: true, autoUpdate: true }, bScope);
  const b = f.create({}, bScope);
  music(f).add({ songName: '甲账号点歌' });
  const beforeA = f.detail(a.id).songs;
  const queueB = music(f, { scope: bScope });
  queueB.add({ songName: '乙账号点歌' });
  queueB.add({ songName: '归属不匹配的延迟请求', fanScope: SCOPE });
  const beforeB = f.detail(b.id, bScope).songs;
  assert.equal(queueB.context.store.clearActive(NOW), 3);
  assert.deepEqual(f.detail(a.id).songs, beforeA);
  assert.equal(beforeB.length, 1);
  assert.deepEqual(f.detail(b.id, bScope).songs, beforeB);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 0);
});

test('song statistics cover today and the previous 29 Shanghai dates with an exact midnight boundary', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.setNow('2026-10-12T16:00:00.000Z');
  const queue = music(f);
  for (const createdAt of [
    '2026-09-13T15:59:59.999Z', // Shanghai September 13: outside the 30-day window.
    '2026-09-13T16:00:00.000Z', // Shanghai September 14: the first included date.
    '2026-10-12T15:59:59.999Z',
    '2026-10-12T16:00:00.000Z',
  ]) queue.add({ createdAt });
  const detail = f.detail(p.id);
  assert.equal(detail.musicStats.days, 30);
  assert.equal(detail.musicStats.count, 3);
  assert.equal(detail.songs[0].data.count, 4);
  assert.deepEqual(detail.songs[0].data.recentDates, ['2026-10-13', '2026-10-12', '2026-09-14']);
  assert.deepEqual(detail.songs[0].data.dailyCounts, [
    { date: '2026-09-14', category: '粤语', count: 1 },
    { date: '2026-10-12', category: '粤语', count: 1 },
    { date: '2026-10-13', category: '粤语', count: 1 },
  ]);
});

test('expired daily counts are removed while lifetime count, recent dates and manual notes survive', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  for (const day of ['16', '17', '18']) {
    f.record(p.id, 'song', { songName: '往日曲目', artist: '歌手', category: '国语', note: '手工备注' },
      { occurredAt: `2026-09-${day}T04:00:00Z` });
  }
  assert.equal(f.detail(p.id).musicStats.count, 3);
  f.setNow('2026-10-18T04:00:00Z');
  const detail = f.detail(p.id);
  assert.equal(detail.musicStats.count, 0);
  assert.equal(detail.songs[0].data.count, 3);
  assert.deepEqual(detail.songs[0].data.recentDates, ['2026-09-18', '2026-09-17', '2026-09-16']);
  assert.equal(detail.songs[0].data.note, '手工备注');
  assert.deepEqual(detail.songs[0].data.dailyCounts, []);
  const persisted = f.db.songDb.prepare("SELECT data FROM fan_records WHERE kind = 'song'").get();
  assert.deepEqual(JSON.parse(persisted.data).dailyCounts, [], 'expiry compacts persisted state rather than only hiding rows');
  f.restart();
  assert.deepEqual(f.detail(p.id).songs, detail.songs);
});

test('legacy song compaction keeps exclusion decisions and notes while discarding per-request evidence', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const insert = f.db.songDb.prepare(`INSERT INTO fan_records
    (id, scope, profile_id, kind, source_key, occurred_at, data, original, revisions, revision)
    VALUES (?, ?, ?, 'song', ?, ?, ?, ?, ?, 2)`);
  for (const [index, fields] of [
    { category: '粤语' },
    { category: '国语', excludeFromStats: true, note: '保留旧备注' },
    { category: '流行', excluded: true },
    { category: '摇滚', source: 'random:摇滚' },
  ].entries()) {
    const data = { songName: '旧曲目', artist: '旧歌手', note: '', ...fields };
    insert.run(`legacy-song-${index}`, SCOPE, p.id, `request:legacy-${index}`, NOW,
      JSON.stringify(data), JSON.stringify({ source: fields.source || 'danmaku', message: '旧逐次弹幕证据' }),
      JSON.stringify([{ before: { data }, after: { data }, changedAt: NOW, source: 'manual' }]));
  }
  migrateFanSongRetention(f.db.songDb);
  const detail = f.detail(p.id);
  assert.equal(detail.songs.length, 1);
  assert.equal(detail.songs[0].data.count, 2, 'excluded and random entries never contribute to the lifetime total');
  assert.equal(detail.musicStats.count, 1, 'the legacy statistics exclusion still applies');
  assert.deepEqual({ ...detail.musicStats.categories }, { 粤语: 1 });
  assert.equal(detail.songs[0].data.note, '保留旧备注');
  assert.deepEqual(detail.songs[0].original, {});
  assert.deepEqual(detail.songs[0].revisions, []);
  assert.equal(JSON.stringify(detail.songs).includes('旧逐次弹幕证据'), false);
  migrateFanSongRetention(f.db.songDb);
  assert.deepEqual(f.detail(p.id).songs, detail.songs, 'repeated migration preserves the same summary');
});

test('repeated songs keep one fixed-shape aggregate instead of a growing request or revision history', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  const size = () => f.db.songDb.prepare(`SELECT COUNT(*) AS rows,
    SUM(LENGTH(data) + LENGTH(original) + LENGTH(revisions)) AS bytes FROM fan_records WHERE kind = 'song'`).get();
  let baseline;
  for (let i = 0; i < 1000; i++) {
    queue.add();
    queue.context.store.clearActive(NOW);
    if (i === 99) baseline = size();
  }
  const finalSize = size();
  assert.equal(finalSize.rows, 1);
  assert.ok(finalSize.bytes - baseline.bytes <= 12, 'only the counter digits need more storage');
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 0);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS n FROM queue').get().n, 0);
  const song = f.detail(p.id).songs[0];
  assert.equal(song.data.count, 1000);
  assert.deepEqual(song.data.recentDates, ['2026-09-18']);
  assert.deepEqual(song.data.dailyCounts, [{ date: '2026-09-18', category: '粤语', count: 1000 }]);
  assert.deepEqual(song.original, {});
  assert.deepEqual(song.revisions, []);
  assert.equal(Object.hasOwn(song.data, 'state'), false);
});
