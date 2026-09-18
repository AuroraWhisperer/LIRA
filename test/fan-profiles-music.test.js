'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { addQueueItem, handleQueueAction, getQueueSnapshot } = require('../src/music/queue-service');
const { createQueueStore } = require('../src/storage/queue-store');
const { clearSongDataInTransaction } = require('../src/storage/database-clear-operations');
const { fanFixture, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');

function music(f, options = {}) {
  const settings = { queueLimit: '50', allowDuplicate: 'true', onlyFromLibrary: 'false', ...options.settings };
  const store = createQueueStore(f.db.songDb, { getFanScope: () => options.scope ?? SCOPE,
    archiveAccepted: options.archiveAccepted || f.service.archiveAccepted,
    archiveQueueState: options.archiveQueueState || f.service.archiveQueueState });
  const context = { store, settings: () => settings, defaults: () => settings, findSong: options.findSong };
  return { context, settings, add: (input = {}) => addQueueItem(context, { songName: '虚构曲目 A',
    artist: '虚构歌手', categoryName: '粤语', requesterUid: IDENTITY.value,
    requesterIdentityType: 'uid', requesterName: '海边听歌', createdAt: NOW, ...input }) };
}

function acceptedSnapshot(f, requestId) {
  const row = f.db.songDb.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  return { stableId: row.stable_id, requestId: row.id, queueId: row.queue_id,
    songName: row.song_name, artist: row.artist, categoryName: row.category_name,
    requesterUid: row.requester_uid, identityType: row.identity_type,
    requesterName: row.requester_name, createdAt: row.created_at, source: row.source };
}

test('A04: duplicate callbacks archive once, while the next real request gets a new stable source', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  const first = queue.add();
  const snapshot = acceptedSnapshot(f, first.id);
  f.service.archiveAccepted(SCOPE, snapshot);
  f.service.archiveAccepted(SCOPE, snapshot);
  assert.equal(f.detail(p.id).songs.length, 1);
  queue.add({ createdAt: '2026-09-19T04:00:00Z' });
  const songs = f.detail(p.id).songs;
  assert.equal(songs.length, 2);
  assert.equal(new Set(songs.map((r) => r.sourceKey)).size, 2);
  assert.equal(songs.every((r) => r.data.songName === '虚构曲目 A'), true);
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
});

test('A06/A26/A27: restart and normal source clearing retain snapshots when request numbers are reused', (t) => {
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
  const second = music(f).add({ createdAt: '2026-09-19T04:00:00Z' });
  assert.equal(second.id, first.id, 'the SQL autoincrement number really was reused');
  assert.equal(f.detail(p.id).songs.length, 2);
  f.service.archiveAccepted(SCOPE, snapshot);
  assert.equal(f.detail(p.id).songs.length, 2, 'old replay still matches the original stable UUID');
  f.restart();
  assert.equal(f.detail(p.id).songs.length, 2);
});

test('A07: manual preferences never increment request statistics or get overwritten by accepted requests', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'preference', { sentiment: 'like', label: '粤语', reason: '本人确认' });
  assert.equal(f.detail(p.id).musicStats.count, 0);
  music(f).add();
  music(f).add({ source: 'random', songName: '随机曲目' });
  const actual = f.detail(p.id);
  assert.equal(actual.songs.length, 2);
  assert.equal(actual.musicStats.count, 1);
  assert.equal(actual.musicStats.categories['粤语'], 1);
  assert.equal(actual.preferences[0].data.reason, '本人确认');
  assert.equal(actual.musicSummary, '喜欢粤语');
});

test('A23: manual song correction keeps one request, original evidence and an independent revision', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  const accepted = queue.add();
  const initial = f.detail(p.id).songs[0];
  f.record(p.id, 'song', { songName: '修正歌名', artist: '修正歌手', category: '粤语' },
    { id: initial.id, revision: initial.revision, occurredAt: '2026-09-17T04:00:00Z' });
  let actual = f.detail(p.id);
  assert.equal(actual.songs.length, 1);
  assert.equal(actual.records.find((r) => r.id === initial.id).data.songName, '修正歌名');
  assert.equal(actual.songs[0].sourceKey, initial.sourceKey);
  assert.equal(actual.songs[0].original.songName, '虚构曲目 A');
  assert.equal(actual.songs[0].revisions.length, 1);
  assert.equal(actual.musicStats.count, 1);
  f.service.archiveAccepted(SCOPE, acceptedSnapshot(f, accepted.id));
  actual = f.detail(p.id);
  assert.equal(actual.songs.length, 1);
  assert.equal(actual.songs[0].data.songName, '修正歌名');
  const corrected = actual.songs[0];
  f.record(p.id, 'song', { ...corrected.data, excluded: true }, { id: corrected.id, revision: corrected.revision });
  f.service.archiveAccepted(SCOPE, acceptedSnapshot(f, accepted.id));
  assert.equal(f.detail(p.id).songs.length, 0, 'replay cannot resurrect a manually excluded association');
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
  assert.equal(song.data.state, '队列已处理');
  assert.notEqual(song.data.state, '已唱');
  assert.equal(f.detail(p.id).songs.length, 1);
});

test('queue completion preserves stable song evidence and manual corrections with distinct queue revisions', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  queue.add();
  const initial = f.detail(p.id).songs[0];
  assert.equal(initial.data.state, '已加入队列');
  const corrected = f.record(p.id, 'song', { songName: '人工修正歌名', artist: '人工修正歌手',
    category: '国语', note: '保留的人工说明', state: '已唱' },
    { id: initial.id, revision: initial.revision, occurredAt: '2026-09-17T04:00:00Z' });
  assert.equal(corrected.data.state, '已加入队列', 'manual corrections cannot replace the queue state');
  assert.equal(corrected.revisions[0].source, 'manual');
  const changedAt = '2026-09-18T05:00:00.000Z';
  assert.equal(queue.context.store.completeNext(changedAt), true);
  const processed = f.detail(p.id).songs[0];
  assert.equal(processed.id, initial.id);
  assert.equal(processed.sourceKey, initial.sourceKey);
  assert.deepEqual(processed.original, initial.original);
  assert.equal(processed.occurredAt, corrected.occurredAt);
  assert.deepEqual(processed.data, { ...corrected.data, state: '队列已处理' });
  assert.deepEqual(processed.revisions.slice(0, 1), corrected.revisions);
  assert.deepEqual(processed.revisions[1], { changedAt, source: 'queue',
    before: { data: corrected.data, occurredAt: corrected.occurredAt },
    after: { data: processed.data, occurredAt: processed.occurredAt } });
  assert.equal(processed.revision, corrected.revision + 1);
  assert.equal(queue.context.store.completeNext(changedAt), false);
  const editedAfterProcessing = f.record(p.id, 'song', { songName: '处理后再次修正', artist: '歌手' },
    { id: processed.id, revision: processed.revision });
  assert.equal(editedAfterProcessing.data.state, '队列已处理');
  assert.deepEqual(editedAfterProcessing.original, initial.original);
  assert.deepEqual(editedAfterProcessing.revisions.slice(0, 2), processed.revisions);
  assert.equal(editedAfterProcessing.revisions[2].source, 'manual');
  f.restart();
  assert.equal(f.detail(p.id).songs[0].id, initial.id);
  assert.equal(f.detail(p.id).songs[0].data.state, '队列已处理');
});

test('setStatus tracks queue-only outcomes idempotently without resurrecting a manually excluded song', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const queue = music(f);
  const item = queue.add();
  const initial = f.detail(p.id).songs[0];
  for (const [status, state] of [['skipped', '已跳过'], ['waiting', '已加入队列'],
    ['done', '队列已处理'], ['deleted', '已撤销／移除']]) {
    queue.context.store.setStatus(item.id, status, NOW);
    const record = f.detail(p.id).songs[0];
    assert.equal(record.data.state, state);
    assert.equal(record.id, initial.id);
    assert.deepEqual(record.original, initial.original);
    assert.equal(record.revisions.at(-1).source, 'queue');
    queue.context.store.setStatus(item.id, status, NOW);
    assert.deepEqual(f.detail(p.id).songs[0], record, 'repeating a queue state adds no duplicate revision');
  }
  const removed = f.detail(p.id).songs[0];
  const excluded = f.record(p.id, 'song', { ...removed.data, excluded: true },
    { id: removed.id, revision: removed.revision });
  queue.context.store.setStatus(item.id, 'done', NOW);
  const detail = f.detail(p.id);
  assert.equal(detail.songs.length, 0);
  const record = detail.records.find((value) => value.id === excluded.id);
  assert.equal(record.data.excluded, true);
  assert.equal(record.data.state, '队列已处理');
  assert.deepEqual(record.original, initial.original);
  assert.deepEqual(record.revisions.slice(0, -1), excluded.revisions);
});

test('clearActive archives removals for every active request while retaining completed records and statistics', (t) => {
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
  for (const record of after.songs) {
    const prior = before.songs.find((value) => value.id === record.id);
    assert.equal(record.sourceKey, prior.sourceKey);
    assert.deepEqual(record.original, prior.original);
    if (record.data.songName === '已处理的曲目') assert.deepEqual(record, prior);
    else {
      assert.equal(record.data.state, '已撤销／移除');
      assert.equal(record.revisions.at(-1).source, 'queue');
    }
  }
  assert.equal(queue.context.store.clearActive(NOW), 0);
  assert.deepEqual(f.detail(p.id).songs, after.songs);
});

for (const action of ['completeNext', 'setStatus', 'clearActive']) {
  test(`${action} rolls back queue rows and all private revisions when a state callback fails`, (t) => {
    const f = fanFixture(t);
    const p = f.create();
    let calls = 0;
    let shouldFail = true;
    const queue = music(f, { archiveQueueState: (...args) => {
      calls++;
      f.service.archiveQueueState(...args);
      if (shouldFail && calls === (action === 'clearActive' ? 2 : 1)) throw new Error('forced state archive failure');
    } });
    const first = queue.add();
    queue.add({ songName: '第二首事务内曲目' });
    const rows = () => f.db.songDb.prepare('SELECT * FROM queue ORDER BY id').all();
    const beforeQueue = rows();
    const beforeSongs = f.detail(p.id).songs;
    const apply = () => action === 'setStatus'
      ? queue.context.store.setStatus(first.id, 'done', '2026-09-18T05:00:00Z')
      : queue.context.store[action]('2026-09-18T05:00:00Z');
    assert.throws(apply, /forced state archive failure/);
    assert.equal(calls, action === 'clearActive' ? 2 : 1);
    assert.deepEqual(rows(), beforeQueue);
    assert.deepEqual(f.detail(p.id).songs, beforeSongs);
    assert.doesNotThrow(() => f.db.songDb.exec('BEGIN; ROLLBACK;'), 'failed status savepoint is released');
    shouldFail = false;
    apply();
    assert.ok(f.detail(p.id).songs.some((record) => record.data.state !== '已加入队列'));
  });
}

test('queue state changes update only requests owned by the current streamer scope', (t) => {
  const f = fanFixture(t);
  const a = f.create();
  const bScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  f.run('configure', { autoCreate: true, autoUpdate: true }, bScope);
  const b = f.create({}, bScope);
  music(f).add({ songName: '甲账号点歌' });
  const beforeA = f.detail(a.id).songs;
  const calls = [];
  const queueB = music(f, { scope: bScope, archiveQueueState: (...args) => {
    calls.push(args);
    f.service.archiveQueueState(...args);
  } });
  queueB.add({ songName: '乙账号点歌' });
  queueB.add({ songName: '归属不匹配的延迟请求', fanScope: SCOPE });
  const bSong = f.detail(b.id, bScope).songs[0];
  assert.equal(queueB.context.store.clearActive(NOW), 3);
  assert.deepEqual(f.detail(a.id).songs, beforeA);
  assert.equal(f.detail(b.id, bScope).songs.length, 1);
  assert.equal(f.detail(b.id, bScope).songs[0].data.state, '已撤销／移除');
  assert.deepEqual(calls, [[bScope, bSong.original.stableId, 'deleted', NOW]]);
});
