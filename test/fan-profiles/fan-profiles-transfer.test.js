'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createQueueStore } = require('../../src/storage/queue-store');
const { pruneFanRestoreSnapshots } = require('../../src/storage/fan-snapshot-retention');
const { addQueueItem } = require('../../src/music/queue-service');
const { fanFixture, interval, SCOPE, IDENTITY, NOW } = require('../helpers/fan-profile-fixture');
const { createDatabases, closeDatabases, getSchemaVersions } = require('../../src/storage/database');
const { createLegacyDatabases } = require('../helpers/legacy-databases');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

function oldRequest(f, input = {}, scope = null) {
  const defaults = { queueLimit: '50', allowDuplicate: 'true', onlyFromLibrary: 'false' };
  return addQueueItem(
    {
      store: createQueueStore(f.db.songDb, { getFanScope: () => scope }),
      settings: () => defaults,
      defaults: () => defaults,
    },
    {
      songName: '旧点歌曲目',
      artist: '旧歌手',
      requesterUid: IDENTITY.value,
      requesterIdentityType: 'uid',
      requesterName: '旧昵称',
      createdAt: NOW,
      ...input,
    },
  );
}

test('an empty fact sync preserves restore confirmation while a real edit invalidates it', t => {
  const f = fanFixture(t);
  const p = f.create();
  f.consume([]);
  const backup = f.run('backup');
  const plan = f.run('preview-restore', { backup });
  f.setNow('2026-09-18T05:00:00Z');
  f.consume([]);
  f.run('restore', { backup, ...plan, conflicts: 'keep' });
  const stale = f.run('preview-restore', { backup });
  f.record(p.id, 'note', { body: '预览后新增' });
  assert.throws(() => f.run('restore', { backup, ...stale, conflicts: 'replace' }));
  assert.equal(f.detail(p.id).records[0].data.body, '预览后新增');
});

test('suppression-only file restore previews its effect and keep preserves a local profile and calendar', t => {
  const f = fanFixture(t);
  const p = f.create({ birthday: { monthDay: '09-18' } });
  const backup = { ...f.run('backup'), profiles: [], suppressions: [JSON.stringify(['bilibili', 'uid', IDENTITY.value])] };
  const plan = f.run('preview-restore', { backup });
  assert.equal(plan.suppressionConflicts[0].existingId, p.id);
  f.run('restore', { backup, ...plan, conflicts: 'keep' });
  assert.equal(f.run('list').profiles[0].id, p.id);
  assert.equal(f.run('calendar')[0].profileId, p.id);
  f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'replace' });
  assert.equal(f.run('list').profiles.length, 0);
  assert.equal(f.run('calendar').length, 0);
  const suppressed = f.run('backup');
  f.run('delete', { id: p.id, confirm: true, suppress: false });
  f.run('unsuppress', { identity: IDENTITY, confirm: true });
  f.run('restore', { backup: suppressed, ...f.run('preview-restore', { backup: suppressed }), conflicts: 'keep' });
  assert.equal(f.store.list(SCOPE, { includeSuppressed: true }).length, 1);
  assert.equal(f.run('list').profiles.length, 0, 'a restored profile still receives its own backup suppression');
});

test('birthday CSV retains solar, lunar and leap-month identity', t => {
  const f = fanFixture(t);
  for (const birthday of [{ calendar: 'solar' }, { calendar: 'lunar' }, { calendar: 'lunar', leapMonth: true }])
    f.create({ identity: null, birthday: { ...birthday, monthDay: '06-06' } });
  const rows = f.run('export-list', { fields: ['birthday'] }).split('\r\n').slice(1);
  assert.equal(new Set(rows).size, 3);
  assert.ok(rows.every(row => row.includes('06-06')));
});

test('merge recovery points exceed manual file profile and byte limits and remain reversible', t => {
  const f = fanFixture(t);
  const target = f.create();
  const source = f.create({ identity: null });
  f.store.transaction(() => {
    for (let index = 0; index < 9999; index++) f.store.restoreProfile(SCOPE,
      { ...source, id: `large-snapshot-${index}`, notes: index < 300 ? '档'.repeat(20000) : '' }, null, NOW);
  });
  const merged = f.run('merge', { id: source.id, revision: source.revision,
    targetId: target.id, targetRevision: target.revision, prefer: 'target' });
  const snapshot = f.store.getSnapshot(SCOPE, merged.snapshotId);
  assert.equal(snapshot.profiles.length, 10001);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 16 * 1024 * 1024);
  const plan = f.run('preview-snapshot', { snapshotId: merged.snapshotId });
  const undone = f.run('restore-snapshot', { snapshotId: merged.snapshotId, ...plan, confirm: true });
  assert.equal(f.detail(source.id).id, source.id);
  assert.equal(f.store.list(SCOPE).length, 10001);
  const redo = f.run('preview-snapshot', { snapshotId: undone.snapshotId });
  f.run('restore-snapshot', { snapshotId: undone.snapshotId, ...redo, confirm: true });
  assert.throws(() => f.detail(source.id));
  assert.equal(f.store.list(SCOPE).length, 10000);
});

test('complete backup export admits restorable UTF-8 files and rejects over-budget data', (t) => {
  const f = fanFixture(t);
  const notes = '档'.repeat(20000);
  for (let index = 0; index < 260; index++) f.create({ identity: null, notes });
  const backup = f.run('backup');
  assert.ok(Buffer.byteLength(JSON.stringify(backup, null, 2), 'utf8') < 16 * 1024 * 1024);
  const plan = f.run('preview-restore', { backup });
  const restored = f.run('restore', {
    backup, digest: plan.digest, currentDigest: plan.currentDigest, conflicts: 'replace',
  });
  assert.equal(restored.updated, 260);
  for (let index = 0; index < 40; index++) f.create({ identity: null, notes });
  assert.throws(() => f.run('backup'), /备份.*16/);
});

test('complete export rejects profile counts which restore cannot accept', t => {
  const f = fanFixture(t);
  const profile = f.create({ identity: null });
  const exported = f.store.exportScope(SCOPE);
  f.store.exportScope = () => ({ ...exported, profiles: Array(10001).fill(profile) });
  assert.throws(() => f.run('backup'), /备份.*10000/);
});

test('replacing a complete backup restores swapped identities without depending on profile order', (t) => {
  const f = fanFixture(t);
  const a = f.create({ notes: '原始甲' });
  const b = f.create({ identity: { ...IDENTITY, value: '900000002' }, alias: '乙' });
  const backup = f.run('backup');
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  f.service.execute(otherScope, 'create', { identity: IDENTITY, alias: '其它账号' });
  const otherBefore = f.store.exportScope(otherScope);
  const change = (id, identity) => f.run('save', { id, revision: f.detail(id).revision, identity });
  for (const reverse of [false, true]) {
    change(a.id, null);
    change(b.id, IDENTITY);
    change(a.id, { ...IDENTITY, value: '900000002' });
    const incoming = structuredClone(backup);
    if (reverse) incoming.profiles.reverse();
    const plan = f.run('preview-restore', { backup: incoming });
    assert.equal(plan.updated, 2);
    f.run('restore', { backup: incoming, ...plan, conflicts: 'replace' });
    assert.deepEqual(f.detail(a.id).identity, IDENTITY);
    assert.equal(f.detail(b.id).identity.value, '900000002');
    assert.deepEqual(f.store.exportScope(otherScope), otherBefore);
  }
});

for (const version of [1, 2]) test(`version ${version} pre-merge backups keep song ownership across repeat restore, reorder and new requests`, t => {
  const f = fanFixture(t);
  const source = f.create({ identity: null });
  const target = f.create();
  const song = { songName: '重逢', artist: '歌手', category: '民谣' };
  f.record(target.id, 'song', song);
  f.record(source.id, 'song', song);
  f.record(source.id, 'song', song);
  const backup = f.run('backup');
  if (version === 1) {
    backup.version = 1;
    for (const profile of backup.profiles) profile.records = Array.from({ length: profile.id === source.id ? 2 : 1 }, (_, index) => ({
      id: `v1-${profile.id}-${index}`, kind: 'song', profileId: profile.id, sourceKey: `request:v1-${profile.id}-${index}`,
      occurredAt: NOW, data: song, original: { ...song, source: 'manual' }, revisions: [], revision: 1,
    }));
    f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'replace' });
  }
  const merge = () => f.run('merge', { id: source.id, revision: f.detail(source.id).revision,
    targetId: target.id, targetRevision: f.detail(target.id).revision, prefer: 'target' });
  assert.equal(merge().profile.songs[0].data.count, 3);
  for (let attempt = 0; attempt < 3; attempt++) {
    f.restart();
    backup.profiles.reverse();
    for (const profile of backup.profiles) profile.records.reverse();
    f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'keep' });
    assert.equal(f.detail(source.id).songs.length, 0);
    assert.equal(merge().profile.songs[0].data.count, 3);
  }
  f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'keep' });
  f.record(source.id, 'song', song);
  assert.equal(merge().profile.songs[0].data.count, 4, 'a fresh summary UUID still contributes');
  f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'replace' });
  assert.equal(merge().profile.songs[0].data.count, 3, 'explicit replacement restores the original ownership');
  const partial = { ...backup, profiles: backup.profiles.filter(profile => profile.id === source.id) };
  f.run('restore', { backup: partial, ...f.run('preview-restore', { backup: partial }), conflicts: 'replace' });
  const snapshots = f.run('snapshots');
  assert.throws(merge, undefined, 'restoring only one side cannot safely re-add an absorbed summary');
  assert.equal(f.detail(target.id).songs[0].data.count, 3);
  assert.equal(f.detail(source.id).songs[0].data.count, 2);
  assert.deepEqual(f.run('snapshots'), snapshots);
});

test('an older v1 file with a different representative keeps the absorbed request after restart', t => {
  const f = fanFixture(t);
  const source = f.create({ identity: null });
  const target = f.create();
  const legacy = f.run('backup');
  legacy.version = 1;
  const track = { songName: '同一首歌', artist: '同一人' };
  const event = (id, seconds) => ({ id, kind: 'song', sourceKey: `request:${id}`, data: track,
    original: { source: 'manual' }, revisions: [], occurredAt: new Date(Date.parse(NOW) + seconds * 1000).toISOString() });
  const draft = legacy.profiles.find(p => p.id === source.id);
  legacy.profiles.find(p => p.id === target.id).records = [event('target', 0)];
  draft.records = [event('old', 0)];
  const early = structuredClone(legacy);
  draft.records.push(event('new', 2));
  legacy.exportedAt = '2026-09-18T04:00:02Z';
  const restore = (backup, conflicts) => f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts });
  const merge = () => f.run('merge', { id: source.id, revision: f.detail(source.id).revision,
    targetId: target.id, targetRevision: f.detail(target.id).revision, prefer: 'target' });
  restore(legacy, 'replace');
  merge();
  f.restart();
  restore(early, 'keep');
  assert.equal(f.detail(source.id).songs.length, 0);
  merge();
  f.restart();
  assert.equal(f.detail(target.id).songs[0].data.count, 3);

  // Same endpoints need not mean the same set. Compacted v1 evidence stays bounded.
  draft.records.splice(1, 0, ...Array.from({ length: 40 }, (_, i) => event(`middle-${i}`, 1)));
  restore(legacy, 'replace');
  merge();
  f.restart();
  assert.ok(f.detail(target.id).songs[0].data.mergedRecordIds.length < 10);
  draft.records.reverse();
  restore(legacy, 'keep');
  assert.equal(f.detail(source.id).songs.length, 0);
  merge();
  draft.records[1] = event('only-in-other-file', 1);
  const snapshots = f.run('snapshots');
  assert.throws(() => restore(legacy, 'keep'), error => Boolean(error.publicMessage));
  f.restart();
  assert.equal(f.detail(target.id).songs[0].data.count, 43);
  assert.equal(f.run('list').profiles.length, 1);
  assert.deepEqual(f.run('snapshots'), snapshots);
});

test('a tracked merge with only the old representative refuses uncertain v1 ownership but restores another song', t => {
  const f = fanFixture(t);
  const draft = f.create({ identity: null });
  const target = f.create();
  const song = { songName: '旧汇总', artist: '甲' };
  for (const id of [target.id, draft.id, draft.id]) f.record(id, 'song', song);
  // The old v1 compactor kept one representative ID, just like this plain v2 summary.
  const originals = f.run('backup');
  const representative = originals.profiles.find(p => p.id === draft.id).records[0].id;
  const row = (id, data) => ({ id, kind: 'song', data, occurredAt: NOW, original: { source: 'manual' }, revisions: [] });
  const oldDraft = { ...originals.profiles.find(p => p.id === draft.id), records: [row('older', song)] };
  const older = { ...originals, version: 1, profiles: [oldDraft] };
  const restore = (backup, conflicts) => f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts });
  restore(older, 'replace');
  const converted = f.run('backup');
  restore(originals, 'replace');
  f.run('merge', { id: draft.id, revision: f.detail(draft.id).revision, targetId: target.id,
    targetRevision: f.detail(target.id).revision, prefer: 'target' });
  f.restart();
  const points = f.run('snapshots');
  for (const file of [older, converted]) {
    assert.throws(() => restore(file, 'keep'), error => Boolean(error.publicMessage));
    f.restart();
    assert.equal(f.store.get(SCOPE, draft.id), null);
    assert.equal(f.detail(target.id).songs[0].data.count, 3);
    assert.deepEqual(f.run('snapshots'), points);
  }

  oldDraft.records = [row(representative, song), row('different-artist', { ...song, artist: '乙' })];
  restore(older, 'keep');
  assert.deepEqual(f.detail(draft.id).songs.map(r => [r.data.artist, r.data.count]), [['乙', 1]]);
});

test('pre-upgrade merges recover song ownership from retained history even after snapshots have been pruned', t => {
  const f = fanFixture(t);
  const source = f.create({ identity: null });
  const target = f.create();
  for (const id of [target.id, source.id, source.id]) f.record(id, 'song', { songName: '旧汇总' });
  const backup = f.run('backup');
  f.setNow('2026-09-18T05:00:00Z');
  const result = f.run('merge', { id: source.id, revision: source.revision,
    targetId: target.id, targetRevision: target.revision, prefer: 'target' });
  // Reproduce the persisted shape written before merge lineage was retained.
  f.db.songDb.prepare("UPDATE fan_records SET data = json_remove(data, '$.mergedRecordIds') WHERE scope = ?").run(SCOPE);
  const legacy = f.store.get(SCOPE, target.id);
  legacy.merges = legacy.merges.map(({ songsTracked, ...merge }) => merge);
  f.store.save(SCOPE, legacy, JSON.stringify(['bilibili', 'uid', IDENTITY.value]), NOW);
  for (let index = 0; index < 2; index++) f.store.snapshot(SCOPE, f.run('backup'), '2026-09-18T06:00:00Z');
  assert.equal(f.run('snapshots').some(snapshot => snapshot.id === result.snapshotId), false);
  f.restart();
  f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'keep' });
  assert.equal(f.detail(source.id).songs.length, 0);
  assert.equal(f.run('merge', { id: source.id, revision: f.detail(source.id).revision,
    targetId: target.id, targetRevision: f.detail(target.id).revision, prefer: 'target' }).profile.songs[0].data.count, 3);
  const ambiguous = { ...backup, exportedAt: '2026-09-18T06:00:00Z' };
  const before = f.store.exportScope(SCOPE);
  const snapshots = f.run('snapshots');
  assert.throws(() => f.run('restore', { backup: ambiguous, ...f.run('preview-restore', { backup: ambiguous }), conflicts: 'keep' }));
  assert.deepEqual(f.store.exportScope(SCOPE), before);
  assert.deepEqual(f.run('snapshots'), snapshots);
});

test('merged song identities survive a second merge and reject partial overlap atomically', t => {
  const f = fanFixture(t);
  const a = f.create();
  const b = f.create({ identity: { ...IDENTITY, value: '900000002' } });
  const c = f.create({ identity: null });
  for (const p of [a, b, c]) f.record(p.id, 'song', { songName: '共同曲目' });
  const backup = f.run('backup');
  const merge = (source, target) => f.run('merge', { id: source.id, revision: f.detail(source.id).revision,
    targetId: target.id, targetRevision: f.detail(target.id).revision, prefer: 'target' });
  merge(c, b);
  f.run('save', { id: b.id, revision: f.detail(b.id).revision, identity: null });
  const intermediate = f.run('backup');
  assert.equal(merge(b, a).profile.songs[0].data.count, 3);
  f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'keep' });
  assert.equal(f.detail(b.id).songs.length, 0);
  assert.equal(f.detail(c.id).songs.length, 0);
  assert.equal(f.detail(a.id).songs[0].data.count, 3);
  f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'replace' });
  const overlap = { ...intermediate, profiles: intermediate.profiles.filter(p => p.id === b.id) };
  f.run('delete', { id: b.id, confirm: true, suppress: false });
  const before = f.store.exportScope(SCOPE);
  const snapshots = f.run('snapshots');
  assert.throws(() => f.run('restore', { backup: overlap, ...f.run('preview-restore', { backup: overlap }), conflicts: 'keep' }));
  assert.deepEqual(f.store.exportScope(SCOPE), before);
  assert.deepEqual(f.run('snapshots'), snapshots);

  // Reverse the overlap: B is already part of A+B, while C only exists in incoming B+C.
  f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'replace' });
  f.run('save', { id: b.id, revision: f.detail(b.id).revision, identity: null });
  merge(b, a);
  f.run('delete', { id: c.id, confirm: true, suppress: false });
  const plan = f.run('preview-restore', { backup: intermediate });
  assert.equal(plan.added, 1);
  const points = f.run('snapshots');
  assert.throws(() => f.run('restore', { backup: intermediate, ...plan, conflicts: 'keep' }),
    error => Boolean(error.publicMessage));
  f.restart();
  assert.deepEqual(f.run('list').profiles.map(p => p.id), [a.id]);
  assert.equal(f.detail(a.id).songs[0].data.count, 2);
  assert.deepEqual(f.run('snapshots'), points);
});

test('restoring a pre-merge backup keeps the local owner of a moved note or replaces it explicitly', t => {
  const f = fanFixture(t);
  const draft = f.create({ identity: null });
  const bound = f.create();
  const note = f.record(draft.id, 'note', { body: '合并前的手记' });
  const backup = f.run('backup');
  f.run('merge', { id: draft.id, revision: draft.revision, targetId: bound.id, targetRevision: bound.revision, prefer: 'target' });
  f.record(bound.id, 'note', { body: '合并后的修订' }, { id: note.id, revision: note.revision });
  const preview = f.run('preview-restore', { backup });
  assert.deepEqual([preview.added, preview.updated], [1, 1]);
  f.run('restore', { backup, ...preview, conflicts: 'keep' });
  f.restart();
  assert.equal(f.detail(draft.id).records.length, 0);
  const [local] = f.detail(bound.id).records;
  assert.equal(local.id, note.id);
  assert.equal(local.data.body, '合并后的修订');
  f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: 'replace' });
  assert.equal(f.detail(bound.id).records.length, 0);
  assert.equal(f.detail(draft.id).records[0].data.body, '合并前的手记');
  assert.equal(f.detail(draft.id).records[0].id, note.id);
});

test('keep restores a draft without duplicating the handled anniversary of its moved record', t => {
  const f = fanFixture(t);
  const draft = f.create({ identity: null, birthday: { monthDay: '09-18' } });
  const bound = f.create({ birthday: { monthDay: '09-18' } });
  const anniversary = f.record(draft.id, 'anniversary', { name: '相识', date: '2025-09-18', annual: true });
  const key = `anniversary:${anniversary.id}:2026`;
  f.run('reminder-state', { profileId: draft.id, key, status: 'handled' });
  f.run('reminder-state', { profileId: draft.id, key: 'birthday:2026', status: 'ignored' });
  f.run('reminder-state', { profileId: bound.id, key: 'birthday:2026', status: 'handled' });
  const backup = f.run('backup');
  f.run('merge', { id: draft.id, revision: draft.revision, targetId: bound.id, targetRevision: bound.revision, prefer: 'target' });
  for (const [choice, owner] of [['keep', bound.id], ['replace', draft.id]]) {
    f.run('restore', { backup, ...f.run('preview-restore', { backup }), conflicts: choice });
    f.restart();
    assert.ok(f.detail(owner).records.some(record => record.id === anniversary.id));
    const history = f.run('reminders').filter(item => item.group === 'history');
    assert.deepEqual(history.filter(item => item.key === key).map(item => [item.profileId, item.status]), [[owner, 'handled']]);
    assert.equal(history.find(item => item.profileId === draft.id && item.key === 'birthday:2026')?.status, 'ignored');
    assert.equal(history.find(item => item.profileId === bound.id && item.key === 'birthday:2026')?.status, 'handled');
  }
});

test('restore rejects a final identity collision with a retained profile before creating a recovery point', (t) => {
  const f = fanFixture(t);
  const a = f.create();
  const b = f.create({ identity: { ...IDENTITY, value: '900000002' }, alias: '乙' });
  const backup = f.run('backup');
  backup.profiles = backup.profiles.filter((profile) => profile.id === a.id);
  backup.profiles[0].identity = b.identity;
  const plan = f.run('preview-restore', { backup });
  const before = f.store.exportScope(SCOPE);
  const snapshots = f.run('snapshots');
  assert.throws(() => f.run('restore', { backup, ...plan, conflicts: 'replace' }), /身份.*冲突/);
  assert.deepEqual(f.store.exportScope(SCOPE), before);
  assert.deepEqual(f.run('snapshots'), snapshots);
});

test('restore normalizes identities and rejects malformed suppression keys before writing a snapshot', (t) => {
  const f = fanFixture(t);
  const profile = f.create();
  const original = f.run('backup');
  const snapshots = () => f.db.songDb.prepare('SELECT COUNT(*) AS count FROM fan_restore_snapshots').get().count;
  const before = snapshots();
  const identityBackup = structuredClone(original);
  identityBackup.profiles[0].identity.value = ` ${IDENTITY.value} `;
  const identityPlan = f.run('preview-restore', { backup: identityBackup });
  assert.equal(identityPlan.added, 0);
  assert.equal(identityPlan.updated, 1);
  for (const key of ['invalid-json', 'null', '{}', '["bilibili","uid"]', '["bilibili","uid","00123"]', '["bilibili","uid","123","extra"]']) {
    const backup = { ...original, suppressions: [key] };
    assert.throws(() => f.run('preview-restore', { backup }), /抑制标记无效/);
    assert.throws(() => f.run('restore', { backup, conflicts: 'replace' }), /抑制标记无效/);
  }
  assert.equal(snapshots(), before);
  assert.deepEqual(f.detail(profile.id).identity, IDENTITY);
  assert.deepEqual(f.run('suppression-list'), []);
  f.run('restore', { backup: identityBackup, ...identityPlan, conflicts: 'replace' });
  assert.deepEqual(f.detail(profile.id).identity, IDENTITY);
  assert.equal(f.run('backup').profiles.length, 1);
  const backup = { ...original, suppressions: [JSON.stringify(['bilibili', 'uid', ' 123 '])] };
  const plan = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...plan, conflicts: 'keep' });
  assert.deepEqual(f.run('suppression-list')[0].identity, ['bilibili', 'uid', '123']);
});

test('restoring a legacy local snapshot uses the same normalized identities as its preview', t => {
  const f = fanFixture(t);
  const profile = f.create();
  const backup = f.run('backup');
  backup.profiles[0].identity.value = ` ${IDENTITY.value} `;
  backup.suppressions = [JSON.stringify(['bilibili', 'uid', ' 999 '])];
  const snapshotId = f.store.snapshot(SCOPE, backup, NOW);
  const plan = f.run('preview-snapshot', { snapshotId });
  f.run('restore-snapshot', { snapshotId, confirm: true, ...plan });
  assert.deepEqual(f.detail(profile.id).identity, IDENTITY);
  assert.deepEqual(f.run('suppression-list')[0].identity, ['bilibili', 'uid', '999']);
  f.restart();
  assert.deepEqual(f.detail(profile.id).identity, IDENTITY);
  assert.equal(f.run('backup').profiles.length, 1);
  const malformed = { ...f.run('backup'), suppressions: ['invalid-json'] };
  const badSnapshotId = f.store.snapshot(SCOPE, malformed, NOW);
  const before = f.run('snapshots').length;
  assert.throws(() => f.run('restore-snapshot', { snapshotId: badSnapshotId, confirm: true }), /抑制标记无效/);
  assert.deepEqual(f.detail(profile.id).identity, IDENTITY);
  assert.equal(f.run('snapshots').length, before);
});

test('A29: complete restore preserves song summaries, other record evidence and handled reminder state', (t) => {
  const f = fanFixture(t);
  const p = f.create({ notes: '私密备份备注', birthday: { monthDay: '09-18' } });
  const note = f.record(p.id, 'note', { body: '原始内容' });
  f.record(p.id, 'note', { body: '修订后内容' }, { id: note.id, revision: note.revision });
  f.record(p.id, 'membership', interval('2026-09-01', '2026-12-31'));
  f.record(p.id, 'song', { songName: '备份曲目', artist: '备份歌手', category: '粤语', note: '喜欢现场版' });
  f.record(p.id, 'song', { songName: '备份曲目', artist: '备份歌手', category: '粤语' }, { occurredAt: '2026-09-17T04:00:00Z' });
  f.run('reminder-state', { profileId: p.id, key: 'birthday:2026', status: 'handled' });
  const backup = f.run('backup');
  assert.equal(backup.version, 2);
  const membership = backup.profiles[0].records.find(record => record.kind === 'membership');
  delete membership.data.startAt;
  delete membership.data.endAt;
  const song = backup.profiles[0].records.find((record) => record.kind === 'song');
  f.run('delete', { id: p.id, confirm: true, suppress: false });
  f.consume([{ cursor: 5, name: '未建档的身份快照' }], { nextCursor: 5 });
  const plan = f.run('preview-restore', { backup });
  assert.equal(plan.added, 1);
  assert.equal(plan.updated, 0);
  const result = f.run('restore', {
    backup,
    digest: plan.digest,
    currentDigest: plan.currentDigest,
    conflicts: 'keep',
  });
  assert.ok(result.snapshotId);
  const savedSnapshot = f.db.songDb
    .prepare('SELECT data FROM fan_restore_snapshots WHERE id = ?')
    .get(result.snapshotId);
  assert.equal(JSON.parse(savedSnapshot.data).profiles.length, 0);
  assert.equal(f.run('settings').cursor, 5, 'restore must not claim the backup cursor as current coverage');
  f.restart();
  const restored = f.detail(p.id);
  assert.deepEqual(restored.identity, IDENTITY);
  assert.equal(restored.notes, '私密备份备注');
  assert.equal(restored.records.find((r) => r.id === note.id).data.body, '修订后内容');
  assert.equal(restored.records.find((r) => r.id === note.id).original.body, '原始内容');
  assert.equal(restored.records.find((r) => r.id === note.id).revisions.length, 1);
  assert.deepEqual(restored.songs[0].data, song.data);
  assert.deepEqual(restored.songs[0].original, {});
  assert.deepEqual(restored.songs[0].revisions, []);
  assert.equal(restored.membership.totalDays, 18);
  assert.equal(restored.reminders.find((r) => r.key === 'birthday:2026').status, 'handled');
  assert.equal(restored.reminders.find((r) => r.key === 'birthday:2026').actionable, false);
});

test('version 1 backups combine individual songs while preserving exclusion rules and other record revisions', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  const note = f.record(p.id, 'note', { body: '原来的手记' });
  const corrected = f.record(p.id, 'note', { body: '修订手记' }, { id: note.id, revision: note.revision });
  const queued = oldRequest(f, { songName: '雨爱', artist: '测试歌手', categoryName: '流行' }, SCOPE);
  const activeRequest = f.db.songDb.prepare('SELECT * FROM requests WHERE queue_id = ?').get(queued.id);
  assert.equal(activeRequest.fan_recorded, 0);
  const backup = f.run('backup');
  backup.version = 1;
  const requests = [
    { at: '2026-09-18T04:00:00Z', data: { note: '喜欢现场版' } },
    { at: '2026-09-17T17:00:00Z' },
    { at: '2026-09-17T04:00:00Z', data: { excludeFromStats: true } },
    { at: '2026-09-16T04:00:00Z' },
    { at: '2026-08-01T04:00:00Z' },
    { at: '2026-09-18T01:00:00Z', data: { excluded: true } },
    { at: '2026-09-18T02:00:00Z', source: 'random:danmaku' },
  ];
  backup.profiles[0].records.push(...requests.map((request, index) => {
    const data = { songName: '雨爱', artist: '测试歌手', category: '流行', ...request.data };
    return {
      id: `legacy-song-${index}`, profileId: p.id, kind: 'song',
      sourceKey: `request:${index === 0 ? activeRequest.stable_id : `legacy-${index}`}`,
      occurredAt: request.at, data, original: { ...data, source: request.source || 'danmaku' },
      revisions: [{ changedAt: NOW, before: { data: { songName: '旧曲名' } }, after: { data } }], revision: 2,
    };
  }));
  const plan = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...plan, conflicts: 'replace' });
  const profile = f.detail(p.id);
  assert.equal(profile.songs.length, 1);
  assert.equal(profile.songs[0].data.count, 5);
  assert.deepEqual(profile.songs[0].data.recentDates, ['2026-09-18', '2026-09-17', '2026-09-16']);
  assert.deepEqual(profile.songs[0].data.dailyCounts, [
    { date: '2026-09-16', category: '流行', count: 1 },
    { date: '2026-09-18', category: '流行', count: 2 },
  ]);
  assert.equal(profile.songs[0].data.note, '喜欢现场版');
  assert.deepEqual(profile.songs[0].original, {});
  assert.deepEqual(profile.songs[0].revisions, []);
  assert.deepEqual(profile.records.find((record) => record.id === note.id), corrected);
  assert.equal(profile.musicStats.days, 30);
  assert.equal(profile.musicStats.count, 3);
  const restoredRequest = f.db.songDb.prepare('SELECT fan_recorded FROM requests WHERE id = ?').get(activeRequest.id);
  assert.equal(restoredRequest.fan_recorded, 1, 'restoring legacy evidence claims its same-account active request');
  assert.equal(f.db.songDb.prepare('SELECT status FROM queue WHERE id = ?').get(queued.id).status, 'waiting');
  f.service.archiveAccepted(SCOPE, {
    stableId: activeRequest.stable_id, requestId: activeRequest.id, queueId: queued.id,
    songName: activeRequest.song_name, artist: activeRequest.artist, categoryName: activeRequest.category_name,
    requesterUid: activeRequest.requester_uid, identityType: activeRequest.identity_type,
    requesterName: activeRequest.requester_name, createdAt: activeRequest.created_at, source: activeRequest.source,
  });
  assert.deepEqual(f.detail(p.id).songs, profile.songs, 'replayed acceptance cannot count the restored song twice');
  const upgraded = f.run('backup');
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.profiles[0].records.filter((record) => record.kind === 'song').length, 1);
  f.run('restore', { backup: upgraded, ...f.run('preview-restore', { backup: upgraded }), conflicts: 'replace' });
  assert.equal(f.detail(p.id).songs[0].data.count, 5, 'replacing from a summary backup must not double the current total');
});

test('restore rejects malformed song totals and dates before changing profiles or snapshots', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  f.record(p.id, 'song', { songName: '校验曲目', category: '流行' });
  f.record(p.id, 'song', { songName: '校验曲目', category: '流行' }, { occurredAt: '2026-09-17T04:00:00Z' });
  const backup = f.run('backup');
  f.store.snapshot(SCOPE, backup, NOW);
  const before = f.store.exportScope(SCOPE);
  const snapshots = f.run('snapshots');
  const invalid = [
    ['negative total', (data) => { data.count = -1; }],
    ['fractional total', (data) => { data.count = 1.5; }],
    ['text total', (data) => { data.count = '2'; }],
    ['missing recent dates', (data) => { data.recentDates = []; }],
    ['duplicate recent dates', (data) => { data.recentDates = ['2026-09-18', '2026-09-18']; }],
    ['ascending recent dates', (data) => { data.recentDates.reverse(); }],
    ['invalid calendar date', (data) => { data.recentDates = ['2026-02-30']; }],
    ['too many recent dates', (data) => { data.recentDates.push('2026-09-16', '2026-09-15'); }],
    ['daily count exceeds total', (data) => { data.dailyCounts[0].count = 3; }],
    ['invalid daily count', (data) => { data.dailyCounts[0].count = 0; }],
    ['invalid statistics date', (data) => { data.dailyCounts[0].date = '2026-02-30'; }],
    ['duplicate daily category', (data) => { data.dailyCounts.push({ ...data.dailyCounts[0] }); }],
    ['daily date newer than last request', (data) => { data.dailyCounts[1].date = '2026-09-19'; }],
  ];
  for (const [label, change] of invalid) {
    const damaged = structuredClone(backup);
    change(damaged.profiles[0].records.find((record) => record.kind === 'song').data);
    assert.throws(() => f.run('preview-restore', { backup: damaged }), /点歌|日期|汇总/, label);
  }
  assert.deepEqual(f.store.exportScope(SCOPE), before);
  assert.deepEqual(f.run('snapshots'), snapshots);
});

test('A29: restore requires matching origin/account, complete format and unchanged conflict preview', (t) => {
  const f = fanFixture(t);
  const p = f.create({ notes: '仍要保留' });
  const backup = f.run('backup');
  assert.throws(
    () =>
      f.run('preview-restore', {
        backup: { ...backup, scope: JSON.stringify(['https://other.example', 'streamer-a']) },
      }),
    /归属不匹配/,
  );
  assert.throws(
    () =>
      f.run('preview-restore', {
        backup: { ...backup, scope: JSON.stringify(['https://lira.example', 'streamer-b']) },
      }),
    /归属不匹配/,
  );
  assert.throws(() => f.run('preview-restore', { backup: f.run('export-list') }), /备份格式无效/);
  const plan = f.run('preview-restore', { backup });
  assert.equal(plan.conflicts[0].existingId, p.id);
  f.run('save', { id: p.id, revision: p.revision, notes: '预览后有了新内容' });
  assert.throws(
    () => f.run('restore', { backup, digest: plan.digest, currentDigest: plan.currentDigest, conflicts: 'replace' }),
    /预览已变化/,
  );
  assert.equal(f.detail(p.id).notes, '预览后有了新内容');
  const currentPlan = f.run('preview-restore', { backup });
  f.run('restore', { backup, ...currentPlan, conflicts: 'keep' });
  assert.equal(f.detail(p.id).notes, '预览后有了新内容');
});

test('A29: restore failures leave both current profiles and pre-restore snapshot table unchanged', (t) => {
  const f = fanFixture(t);
  const a = f.create();
  const b = f.create({ identity: { ...IDENTITY, value: '900000002' }, alias: '阿遥' });
  f.record(a.id, 'note', { body: '甲原来的内容' });
  f.record(b.id, 'note', { body: '乙原来的内容' });
  f.record(a.id, 'song', { songName: '事务里保留的歌', category: '流行' });
  f.record(a.id, 'song', { songName: '事务里保留的歌', category: '流行' });
  const backup = f.run('backup');
  f.store.snapshot(SCOPE, backup, NOW);
  f.store.snapshot(SCOPE, backup, NOW);
  const before = f.store.exportScope(SCOPE);
  const snapshots = f.run('snapshots');
  const plan = f.run('preview-restore', { backup });
  f.db.songDb.exec(`CREATE TRIGGER fail_fan_restore BEFORE INSERT ON fan_records WHEN NEW.kind = 'note'
    BEGIN SELECT RAISE(ABORT, 'forced fan restore failure'); END;`);
  assert.throws(() => f.run('restore', { backup, ...plan, conflicts: 'replace' }), /forced fan restore failure/);
  assert.deepEqual(f.store.exportScope(SCOPE), before);
  assert.deepEqual(f.run('snapshots'), snapshots, 'failed restoration must recover any snapshot pruned by its insert');
});

test('automatic recovery snapshots keep the newest two per account and insert atomically with pruning', (t) => {
  const f = fanFixture(t);
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  const backup = f.run('backup');
  const otherId = f.store.snapshot(otherScope, { ...backup, scope: otherScope }, NOW);
  const first = f.store.snapshot(SCOPE, backup, NOW);
  const second = f.store.snapshot(SCOPE, backup, NOW);
  f.db.songDb.exec(`CREATE TRIGGER fail_fan_snapshot_prune BEFORE DELETE ON fan_restore_snapshots
    BEGIN SELECT RAISE(ABORT, 'forced snapshot prune failure'); END;`);
  assert.throws(() => f.store.snapshot(SCOPE, backup, NOW), /forced snapshot prune failure/);
  assert.deepEqual(f.run('snapshots').map((entry) => entry.id), [second, first]);
  f.db.songDb.exec('DROP TRIGGER fail_fan_snapshot_prune');
  const third = f.store.snapshot(SCOPE, backup, NOW);
  assert.deepEqual(f.run('snapshots').map((entry) => entry.id), [third, second]);
  assert.throws(() => f.store.getSnapshot(SCOPE, first), /恢复点不存在/);
  assert.deepEqual(f.store.getSnapshot(SCOPE, third), backup);
  assert.deepEqual(f.run('snapshots', {}, otherScope).map((entry) => entry.id), [otherId]);
  f.restart();
  assert.deepEqual(f.run('snapshots').map((entry) => entry.id), [third, second]);
});

test('snapshot retention upgrades existing accounts deterministically and is repeatable', (t) => {
  const f = fanFixture(t);
  const scopes = [SCOPE, JSON.stringify(['https://other.example', 'streamer-a'])];
  const insert = f.db.songDb.prepare('INSERT INTO fan_restore_snapshots VALUES (?, ?, ?, ?)');
  for (const scope of scopes) {
    insert.run(`${scope}-latest`, scope, '2026-09-20T04:00:00.000Z', '{}');
    insert.run(`${scope}-tie-earlier`, scope, NOW, '{}');
    insert.run(`${scope}-tie-later`, scope, NOW, '{}');
    insert.run(`${scope}-oldest`, scope, '2026-09-17T04:00:00.000Z', '{}');
  }
  assert.equal(pruneFanRestoreSnapshots(f.db.songDb), 4);
  for (const scope of scopes) {
    assert.deepEqual(f.run('snapshots', {}, scope).map((entry) => entry.id), [`${scope}-latest`, `${scope}-tie-later`]);
  }
  assert.equal(pruneFanRestoreSnapshots(f.db.songDb), 0);
});

test('A19: archived profiles can restore, and deletion suppression survives backup and membership replay', (t) => {
  const f = fanFixture(t);
  let p = f.create();
  p = f.run('save', { id: p.id, revision: p.revision, archived: true });
  assert.equal(f.run('list').profiles.length, 0);
  assert.equal(f.run('list', { archived: true }).profiles[0].id, p.id);
  p = f.run('save', { id: p.id, revision: p.revision, archived: false });
  assert.equal(f.run('list').profiles[0].id, p.id);
  f.run('delete', { id: p.id, confirm: true, suppress: true });
  const backup = f.run('backup');
  assert.equal(backup.suppressions.length, 1);
  f.restart();
  f.consume([{ kind: 'membership', membership: { type: 'observation', level: 3, observedAt: NOW } }]);
  assert.equal(f.run('find', { identity: IDENTITY }), null);
  assert.equal(f.run('backup').suppressions[0], backup.suppressions[0]);
});

test('clearing all profiles requires confirmation and stays within the current account', (t) => {
  const f = fanFixture(t);
  const active = f.create({ birthday: { monthDay: '09-18' } });
  f.record(active.id, 'note', { body: '当前账号手记' });
  f.run('reminder-state', {
    profileId: active.id,
    key: active.reminders[0].key,
    status: 'handled',
  });
  let archived = f.create({
    alias: '已归档粉丝',
    identity: { ...IDENTITY, value: '900000002' },
  });
  archived = f.run('save', {
    id: archived.id,
    revision: archived.revision,
    archived: true,
  });
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  const other = f.create({ alias: '其他账号档案' }, otherScope);
  f.run('save-record', { profileId: other.id, kind: 'note', data: { body: '不得删除' } }, otherScope);
  f.store.suppress(SCOPE, '["bilibili","uid","900000099"]');

  assert.throws(() => f.run('delete-all'), /确认清除全部档案/);
  assert.equal(f.run('list').profiles.length, 1);
  assert.equal(f.run('list', { archived: true }).profiles.length, 1);

  assert.deepEqual(f.run('delete-all', { confirm: true }), {
    deletedCount: 2,
  });
  assert.equal(f.run('list').profiles.length, 0);
  assert.equal(f.run('list', { archived: true }).profiles.length, 0);
  assert.equal(f.db.songDb.prepare('SELECT COUNT(*) AS count FROM fan_records WHERE scope = ?').get(SCOPE).count, 0);
  assert.equal(
    f.db.songDb.prepare('SELECT COUNT(*) AS count FROM fan_reminder_states WHERE scope = ?').get(SCOPE).count,
    0,
  );
  assert.equal(f.run('suppression-list').length, 1);
  assert.equal(f.run('settings').autoCreate, true);
  assert.equal(f.detail(other.id, otherScope).records.length, 1);
});

test('A29: legacy request import previews scope/range, requires confirmation and deduplicates assigned UUIDs', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  oldRequest(f);
  oldRequest(f, { createdAt: '2026-09-17T04:00:00Z' });
  oldRequest(f, {}, JSON.stringify(['https://lira.example', 'streamer-b']));
  oldRequest(f, { requesterIdentityType: 'open_id' });
  f.db.songDb.prepare('UPDATE requests SET stable_id = NULL, identity_type = NULL WHERE id = 1').run();
  const input = { profileId: p.id, from: '2026-09-18', to: '2026-09-18' };
  let plan = f.run('preview-legacy', input);
  assert.equal(plan.count, 1);
  assert.equal(plan.unownedCount, 1);
  assert.equal(f.detail(p.id).songs.length, 0);
  assert.throws(() => f.run('import-legacy', { ...input, digest: plan.digest }), /确认旧点歌记录归属/);
  f.run('import-legacy', { ...input, digest: plan.digest, confirmOwnership: true });
  const first = f.detail(p.id).songs[0];
  assert.equal(first.data.count, 1);
  assert.deepEqual(first.data.recentDates, ['2026-09-18']);
  assert.deepEqual(first.original, {});
  const request = f.db.songDb.prepare('SELECT owner_scope, stable_id, fan_recorded FROM requests WHERE id = 1').get();
  assert.equal(request.owner_scope, SCOPE);
  assert.ok(request.stable_id);
  assert.equal(request.fan_recorded, 1);
  plan = f.run('preview-legacy', input);
  f.run('import-legacy', { ...input, digest: plan.digest, confirmOwnership: true });
  assert.equal(f.detail(p.id).songs.length, 1);
  assert.equal(f.detail(p.id).songs[0].sourceKey, first.sourceKey);
  assert.equal(f.detail(p.id).songs[0].data.count, 1);
});

test('A16/A29: ordinary list export excludes sensitive fields by default and quotes selected CSV cells', (t) => {
  const f = fanFixture(t);
  f.create({ alias: '=SUM(A1)', notes: '私密正文', birthday: { monthDay: '09-19' }, mbti: 'INFP' });
  const standard = f.run('export-list');
  assert.equal(standard.includes('私密正文'), false);
  assert.equal(standard.includes('INFP'), false);
  assert.equal(standard.includes('09-19'), false);
  assert.ok(standard.includes('"\'=SUM(A1)"'));
  const selected = f.run('export-list', { fields: ['alias', 'notes'] });
  assert.ok(selected.includes('私密正文'));
  assert.throws(() => f.run('export-list', { fields: ['rawData'] }), /字段无效/);
});

test('CSV uid cells distinguish a UID from the same digits in an Open ID and an unbound draft', (t) => {
  const f = fanFixture(t);
  const { identity } = f.create({ alias: 'uid-row' });
  f.create({ alias: 'open-row', identity: { ...identity, type: 'open_id' } });
  f.create({ alias: 'draft-row', identity: null });
  for (const input of [{}, { fields: ['alias', 'uid'] }]) {
    const rows = f.run('export-list', input).split('\r\n').slice(1);
    const cell = alias => rows.find(row => row.startsWith(`"${alias}",`)).split(',').at(-1);
    assert.deepEqual(['uid-row', 'open-row', 'draft-row'].map(cell), [`"${identity.value}"`, '""', '""']);
  }
});

test('A29: legacy date ranges use Shanghai business dates at both UTC midnight boundaries', (t) => {
  const f = fanFixture(t);
  const p = f.create();
  oldRequest(f, { songName: '业务日最早一笔', createdAt: '2026-09-17T16:00:00Z' });
  oldRequest(f, { songName: '业务日最后一笔', createdAt: '2026-09-18T15:59:59Z' });
  oldRequest(f, { songName: '已经是次日', createdAt: '2026-09-18T16:00:00Z' });
  const result = f.run('preview-legacy', { profileId: p.id, from: '2026-09-18', to: '2026-09-18' });
  assert.deepEqual(
    result.records.map((r) => r.songName),
    ['业务日最早一笔', '业务日最后一笔'],
  );
});

test('fan schema upgrades existing request history without attributing it and reopens idempotently', (t) => {
  const dataDir = createScratchDirectory('fan-transfer-legacy-');
  let databases = createLegacyDatabases(t, { dataDir }, 5);
  t.after(() => { closeDatabases(databases); removeScratchDirectory(dataDir); });
  assert.equal(getSchemaVersions(databases).songDb, 5);
  databases.songDb.prepare(`INSERT INTO queue (song_name, requester_uid, status, created_at, updated_at)
    VALUES (?, ?, 'waiting', ?, ?)`).run('旧点歌曲目', IDENTITY.value, NOW, NOW);
  databases.songDb.prepare(`INSERT INTO requests (song_name, requester_uid, queue_id, created_at)
    VALUES (?, ?, 1, ?)`).run('旧点歌曲目', IDENTITY.value, NOW);
  closeDatabases(databases);
  databases = createDatabases({ dataDir });
  const currentVersion = getSchemaVersions(databases).songDb;
  const restored = databases.songDb.prepare('SELECT * FROM requests WHERE id = 1').get();
  assert.equal(restored.song_name, '旧点歌曲目');
  assert.equal(restored.requester_uid, IDENTITY.value);
  assert.equal(restored.stable_id, null);
  assert.equal(restored.owner_scope, null);
  assert.equal(restored.identity_type, null);
  assert.equal(databases.songDb.prepare('SELECT COUNT(*) AS n FROM fan_profiles').get().n, 0);
  closeDatabases(databases);
  databases = createDatabases({ dataDir });
  assert.deepEqual(databases.songDb.prepare('SELECT * FROM requests WHERE id = 1').get(), restored);
  assert.equal(getSchemaVersions(databases).songDb, currentVersion);
});
