'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fanFixture, interval, SCOPE, IDENTITY, NOW } = require('./helpers/fan-profile-fixture');

function pair(f, source = {}, target = {}) {
  return {
    source: f.create({ identity: null, alias: '未绑定的小海', ...source }),
    target: f.create({ alias: '已有身份小海', ...target }),
  };
}

function mergeInput(source, target, extra = {}) {
  return {
    id: source.id,
    revision: source.revision,
    targetId: target.id,
    targetRevision: target.revision,
    prefer: 'target',
    ...extra,
  };
}

function sortedExport(f, scope = SCOPE) {
  const result = f.store.exportScope(scope);
  result.profiles.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

test('draft former names follow the merge preference and omit the current platform name', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f, { formerNames: ['草稿旧名'] }, { formerNames: ['目标旧名'] });
  f.consume([{ name: '当前名字' }]);
  const result = f.run(
    'merge',
    mergeInput(source, f.detail(target.id), {
      prefer: 'source',
      patch: { formerNames: ['修订旧名', '当前名字'] },
    }),
  );
  assert.deepEqual(result.profile.formerNames, ['修订旧名']);
  assert.equal(result.profile.platformName, '当前名字');
});

test('merge preview is read-only and permits only an unbound draft into an existing bound profile', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f);
  f.record(source.id, 'note', { body: '草稿里的手记' });
  const before = sortedExport(f);
  const plan = f.run(
    'preview-merge',
    mergeInput(source, target, { patch: { alias: '待采用称呼', identity: IDENTITY } }),
  );
  assert.equal(plan.source.alias, '待采用称呼');
  assert.equal(plan.source.identity, null);
  assert.equal(plan.target.id, target.id);
  assert.equal(plan.recordCount, 1);
  assert.deepEqual(sortedExport(f), before);
  assert.deepEqual(f.run('snapshots'), []);
  for (const input of [
    mergeInput(source, source),
    mergeInput(target, source),
    mergeInput(target, target),
    mergeInput(source, target, { patch: { identity: { ...IDENTITY, value: '900000002' } } }),
  ])
    assert.throws(() => f.run('preview-merge', input), /未绑定|不一致/);
});

test('merge rejects cross-account or cross-server source/target references', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f);
  const otherScope = JSON.stringify(['https://lira.example', 'streamer-b']);
  const otherServer = JSON.stringify(['https://other.example', 'streamer-a']);
  const peer = f.create({ alias: '另一个账号' }, otherScope);
  const remote = f.create({ alias: '另一个服务器' }, otherServer);
  for (const other of [peer, remote]) {
    assert.throws(() => f.run('preview-merge', mergeInput(source, other)), /不属于当前账号/);
    assert.throws(() => f.run('merge', mergeInput(source, other)), /不属于当前账号/);
  }
  assert.throws(() => f.run('merge', mergeInput(source, target), otherScope), /不属于当前账号/);
  assert.equal(f.detail(source.id).alias, source.alias);
  assert.equal(f.detail(peer.id, otherScope).alias, peer.alias);
  assert.equal(f.detail(remote.id, otherServer).alias, remote.alias);
  assert.equal(f.run('snapshots').length, 0);
});

test('merge rejects stale source/target revisions and missing choices without changing either profile', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f);
  const input = mergeInput(source, target);
  f.run('preview-merge', input);
  const updatedSource = f.run('save', { id: source.id, revision: source.revision, notes: '新草稿内容' });
  assert.throws(() => f.run('merge', input), /已更新/);
  const freshInput = mergeInput(updatedSource, target);
  f.run('preview-merge', freshInput);
  const updatedTarget = f.run('save', { id: target.id, revision: target.revision, notes: '目标的新内容' });
  assert.throws(() => f.run('merge', freshInput), /已更新/);
  assert.throws(() => f.run('preview-merge', freshInput), /已更新/);
  const current = mergeInput(updatedSource, updatedTarget);
  for (const input of [
    { ...current, targetRevision: undefined },
    { ...current, prefer: undefined },
    { ...current, prefer: 'unknown' },
  ])
    assert.throws(() => f.run('merge', input), /确认|已更新/);
  assert.equal(f.detail(source.id).notes, '新草稿内容');
  assert.equal(f.detail(target.id).notes, '目标的新内容');
  assert.equal(f.run('snapshots').length, 0);
});

test('prefer source adopts nonempty manual fields while empty values and platform identity preserve the target', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(
    f,
    { alias: '草稿称呼', summary: '草稿摘要', notes: '', tags: [], birthday: null },
    {
      alias: '目标称呼',
      summary: '目标摘要',
      notes: '目标私密备注',
      tags: ['目标标签'],
      birthday: { monthDay: '09-19' },
    },
  );
  f.consume([{ name: '最新平台昵称' }]);
  const currentTarget = f.detail(target.id);
  const result = f.run(
    'merge',
    mergeInput(source, currentTarget, { prefer: 'source', patch: { nextTopic: '待保存的话题' } }),
  );
  assert.equal(result.profile.alias, '草稿称呼');
  assert.equal(result.profile.summary, '草稿摘要');
  assert.equal(result.profile.notes, '目标私密备注');
  assert.deepEqual(result.profile.tags, ['目标标签']);
  assert.equal(result.profile.birthday.monthDay, '09-19');
  assert.equal(result.profile.nextTopic, '待保存的话题');
  assert.equal(result.profile.platformName, '最新平台昵称');
  assert.deepEqual(result.profile.identity, IDENTITY);
  assert.ok(result.snapshotId);
  assert.throws(() => f.detail(source.id), /不存在/);
});

test('prefer target preserves existing manual fields but fills its empty fields from the draft', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(
    f,
    { summary: '可补充摘要', notes: '草稿私密备注', tags: ['草稿标签'], birthday: { monthDay: '09-18' } },
    { summary: '', notes: '目标私密备注', tags: [], birthday: null },
  );
  const result = f.run('merge', mergeInput(source, target));
  assert.equal(result.profile.alias, target.alias);
  assert.equal(result.profile.notes, '目标私密备注');
  assert.equal(result.profile.summary, '可补充摘要');
  assert.deepEqual(result.profile.tags, ['草稿标签']);
  assert.equal(result.profile.birthday.monthDay, '09-18');
  assert.equal(result.profile.merges[0].sourceId, source.id);
  assert.equal(result.profile.merges[0].snapshotId, result.snapshotId);
});

test('merge moves stable record identities with original evidence and full revision history', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f);
  const original = f.record(
    source.id,
    'song',
    { songName: '原始曲名', artist: '原始歌手' },
    { occurredAt: '2026-09-17T04:00:00Z' },
  );
  const corrected = f.record(
    source.id,
    'song',
    { songName: '修订曲名', artist: '修订歌手' },
    { id: original.id, revision: original.revision, occurredAt: NOW },
  );
  const note = f.record(source.id, 'note', { body: '草稿里的经历' });
  const targetNote = f.record(target.id, 'note', { body: '目标原有经历' });
  const result = f.run('merge', mergeInput(source, target));
  assert.equal(result.profile.records.length, 3);
  const moved = result.profile.records.find((record) => record.id === corrected.id);
  assert.equal(moved.profileId, target.id);
  assert.deepEqual(moved.original, corrected.original);
  assert.deepEqual(moved.revisions, corrected.revisions);
  assert.deepEqual(moved.data, corrected.data);
  assert.equal(moved.revision, corrected.revision);
  assert.equal(moved.occurredAt, corrected.occurredAt);
  assert.equal(
    result.profile.records.some((record) => record.id === note.id),
    true,
  );
  assert.equal(
    result.profile.records.some((record) => record.id === targetNote.id),
    true,
  );
  f.restart();
  assert.equal(f.detail(target.id).songs[0].id, original.id);
  assert.equal(f.detail(target.id).songs[0].original.songName, '原始曲名');
});

test('merge preserves handled birthdays, stable anniversary records and continuous milestone state', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f, { birthday: { monthDay: '09-18' } }, { birthday: { monthDay: '09-18' } });
  const anniversary = f.record(source.id, 'anniversary', { name: '已处理纪念日', date: '2026-09-18', annual: true });
  f.record(source.id, 'membership', { type: 'baseline', totalDays: 100, continuousDays: 100, asOf: '2026-09-18' });
  const reminders = f.detail(source.id).reminders;
  for (const item of reminders.filter((r) => r.actionable)) {
    f.run('reminder-state', { profileId: source.id, key: item.key, status: 'handled' });
  }
  const currentSource = f.detail(source.id);
  const result = f.run('merge', mergeInput(currentSource, target, { prefer: 'source' }));
  for (const item of reminders.filter((r) => r.actionable)) {
    const merged = result.profile.reminders.find((r) => r.key === item.key);
    assert.ok(merged, item.key);
    assert.equal(merged.status, 'handled', item.key);
    assert.equal(merged.actionable, false, item.key);
    assert.equal(merged.profileId, target.id);
  }
  assert.equal(result.profile.records.find((r) => r.id === anniversary.id).profileId, target.id);
  assert.equal(
    f.run('reminders').some((r) => r.profileId === source.id),
    false,
  );
});

test('an already handled target reminder takes precedence over a draft snooze', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f, { birthday: { monthDay: '09-18' } }, { birthday: { monthDay: '09-18' } });
  f.run('reminder-state', { profileId: target.id, key: 'birthday:2026', status: 'handled' });
  f.run('reminder-state', { profileId: source.id, key: 'birthday:2026', status: 'snoozed' });
  const result = f.run('merge', mergeInput(source, target));
  const birthday = result.profile.reminders.find((item) => item.key === 'birthday:2026');
  assert.equal(birthday.status, 'handled');
  assert.equal(birthday.actionable, false);
});

test('merge failure rolls back target fields, moved records, source deletion and the recovery snapshot', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f, { notes: '将被采用的内容' });
  f.record(source.id, 'note', { body: '需要原子搬迁' });
  const before = sortedExport(f);
  f.db.songDb.exec(`CREATE TRIGGER fail_fan_record_move BEFORE UPDATE OF profile_id ON fan_records
    BEGIN SELECT RAISE(ABORT, 'forced merge failure'); END;`);
  assert.throws(() => f.run('merge', mergeInput(source, target, { prefer: 'source' })), /forced merge failure/);
  assert.deepEqual(sortedExport(f), before);
  assert.equal(f.run('snapshots').length, 0);
});

test('previewing and restoring the merge snapshot restores both original profiles and all moved relations', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f, { notes: '原草稿', birthday: { monthDay: '09-18' } }, { notes: '原目标' });
  const note = f.record(source.id, 'note', { body: '原始手记' });
  f.record(source.id, 'note', { body: '修订手记' }, { id: note.id, revision: note.revision });
  f.record(target.id, 'membership', interval('2026-09-01', '2026-12-31'));
  f.run('reminder-state', { profileId: source.id, key: 'birthday:2026', status: 'handled' });
  const before = sortedExport(f);
  const merge = f.run('merge', mergeInput(f.detail(source.id), f.detail(target.id), { prefer: 'source' }));
  const afterMerge = sortedExport(f);
  assert.equal(afterMerge.profiles.length, 1);
  const snapshots = f.run('snapshots');
  assert.equal(snapshots[0].id, merge.snapshotId);
  assert.match(snapshots[0].reason, /合并/);
  assert.equal(
    Object.hasOwn(snapshots[0], 'profiles'),
    false,
    'snapshot listing contains metadata, not full private content',
  );
  const plan = f.run('preview-snapshot', { snapshotId: merge.snapshotId });
  assert.equal(plan.added, 1);
  assert.equal(plan.updated, 1);
  assert.deepEqual(sortedExport(f), afterMerge, 'preview itself cannot restore or rewrite anything');
  const restored = f.run('restore-snapshot', {
    snapshotId: merge.snapshotId,
    digest: plan.digest,
    currentDigest: plan.currentDigest,
    confirm: true,
  });
  assert.ok(restored.snapshotId);
  assert.notEqual(restored.snapshotId, merge.snapshotId);
  assert.deepEqual(sortedExport(f), before);
  f.restart();
  assert.equal(f.detail(source.id).records[0].id, note.id);
  assert.equal(f.detail(source.id).records[0].revisions.length, 1);
  assert.equal(f.detail(source.id).reminders.find((r) => r.key === 'birthday:2026').status, 'handled');
  assert.equal(f.detail(target.id).notes, '原目标');
  const redoPlan = f.run('preview-snapshot', { snapshotId: restored.snapshotId });
  f.run('restore-snapshot', {
    snapshotId: restored.snapshotId,
    digest: redoPlan.digest,
    currentDigest: redoPlan.currentDigest,
    confirm: true,
  });
  assert.deepEqual(sortedExport(f), afterMerge);
});

test('snapshot access and restoration cannot cross streamer or server scope', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f);
  const merged = f.run('merge', mergeInput(source, target));
  for (const scope of [
    JSON.stringify(['https://lira.example', 'streamer-b']),
    JSON.stringify(['https://other.example', 'streamer-a']),
  ]) {
    assert.deepEqual(f.run('snapshots', {}, scope), []);
    assert.throws(() => f.run('preview-snapshot', { snapshotId: merged.snapshotId }, scope), /不属于当前账号/);
    assert.throws(
      () => f.run('restore-snapshot', { snapshotId: merged.snapshotId, confirm: true }, scope),
      /不属于当前账号/,
    );
  }
  assert.equal(f.run('list').profiles.length, 1);
});

test('snapshot restore rejects missing confirmation and stale preview after record or reminder edits', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f, {}, { birthday: { monthDay: '09-18' } });
  const merged = f.run('merge', mergeInput(source, target));
  const first = f.run('preview-snapshot', { snapshotId: merged.snapshotId });
  assert.throws(
    () =>
      f.run('restore-snapshot', {
        snapshotId: merged.snapshotId,
        digest: first.digest,
        currentDigest: first.currentDigest,
      }),
    /确认/,
  );
  f.record(target.id, 'note', { body: '预览后新增的手记' });
  assert.throws(
    () =>
      f.run('restore-snapshot', {
        snapshotId: merged.snapshotId,
        digest: first.digest,
        currentDigest: first.currentDigest,
        confirm: true,
      }),
    /预览已变化/,
  );
  const second = f.run('preview-snapshot', { snapshotId: merged.snapshotId });
  f.run('reminder-state', { profileId: target.id, key: 'birthday:2026', status: 'handled' });
  assert.throws(
    () =>
      f.run('restore-snapshot', {
        snapshotId: merged.snapshotId,
        digest: second.digest,
        currentDigest: second.currentDigest,
        confirm: true,
      }),
    /预览已变化/,
  );
  assert.equal(f.detail(target.id).records[0].data.body, '预览后新增的手记');
  assert.equal(f.run('snapshots').length, 1, 'rejected restoration creates no recovery point');
});

test('snapshot restore is atomic on persistence failure and resets replay cursor after success', (t) => {
  const f = fanFixture(t);
  const { source, target } = pair(f);
  f.record(source.id, 'note', { body: '不得丢失的手记' });
  f.consume([{ name: '快照中的平台昵称' }]);
  const merged = f.run('merge', mergeInput(f.detail(source.id), f.detail(target.id)));
  f.consume([{ name: '合并后的平台昵称', observedAt: '2026-09-19T04:00:00Z' }]);
  const plan = f.run('preview-snapshot', { snapshotId: merged.snapshotId });
  const before = sortedExport(f);
  f.db.songDb.exec(`CREATE TRIGGER fail_fan_snapshot_restore BEFORE INSERT ON fan_records
    BEGIN SELECT RAISE(ABORT, 'forced snapshot restore failure'); END;`);
  const input = {
    snapshotId: merged.snapshotId,
    digest: plan.digest,
    currentDigest: plan.currentDigest,
    confirm: true,
  };
  assert.throws(() => f.run('restore-snapshot', input), /forced snapshot restore failure/);
  assert.deepEqual(sortedExport(f), before);
  assert.equal(f.run('snapshots').length, 1);
  f.db.songDb.exec('DROP TRIGGER fail_fan_snapshot_restore');
  f.run('restore-snapshot', input);
  assert.equal(f.run('settings').cursor, 0);
  assert.equal(f.run('settings').epoch, null);
  assert.equal(f.detail(source.id).records.length, 1);
  assert.equal(f.detail(target.id).platformName, '快照中的平台昵称');
});
