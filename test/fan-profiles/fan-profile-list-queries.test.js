'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fanFixture, interval, SCOPE, NOW } = require('../helpers/fan-profile-fixture');
const { recordData } = require('../../src/fans/validation');
const { buildReminders } = require('../../src/fans/reminders');

// Records SELECT statements so the list path can be checked for N+1 record reads.
function observe(db) {
  const queries = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    for (const method of ['all', 'get']) {
      const execute = statement[method].bind(statement);
      statement[method] = (...params) => {
        const result = execute(...params);
        if (/^\s*SELECT/iu.test(sql)) queries.push({ sql, params, result });
        return result;
      };
    }
    return statement;
  };
  return { queries };
}

test('fan list and backup batch record reads without changing record order or scope', (t) => {
  const f = fanFixture(t);
  const ids = [];
  f.store.transaction(() => {
    for (let i = 0; i < 503; i += 1) {
      const p = f.store.save(
        SCOPE,
        {
          alias: `观众-${i}`,
          tags: ['中文'],
          favorite: i === 502,
          archived: false,
          summary: '',
          milestoneReminders: false,
        },
        null,
        '2026-09-18T04:00:00.000Z',
      );
      ids.push(p.id);
      for (const id of ['z', 'a'])
        f.store.records.insert(SCOPE, p.id, {
          id: `${p.id}-${id}`,
          kind: 'note',
          occurredAt: '2026-09-17T04:00:00.000Z',
          data: { text: id },
        });
      f.store.saveState(SCOPE, p.id, 'handled', { status: 'handled' });
    }
  });
  const { queries } = observe(f.db.songDb);
  const selected = f.run('list', { query: '观众-502' }).profiles;
  assert.equal(selected.length, 1);
  const recordsQueries = () => queries.filter(({ sql }) => /FROM fan_records/u.test(sql));
  assert.equal(recordsQueries().length, 1);
  assert.ok(recordsQueries()[0].params.includes(ids[502]));
  assert.ok(!recordsQueries()[0].params.includes(ids[0]));
  queries.length = 0;
  assert.equal(f.run('list', { filters: ['favorite'] }).profiles.length, 1);
  assert.equal(recordsQueries().length, 1);
  queries.length = 0;
  assert.equal(f.run('list', { query: '找不到' }).profiles.length, 0);
  assert.equal(recordsQueries().length, 0);
  queries.length = 0;
  assert.equal(f.run('list').profiles.length, 503);
  assert.equal(recordsQueries().length, 2);
  assert.equal(queries.filter(({ sql }) => /FROM fan_reminder_states/u.test(sql)).length, 2);
  queries.length = 0;
  assert.equal(f.run('backup').profiles.length, 503);
  assert.equal(recordsQueries().length, 3, 'backup also prunes expired song-count buckets once');
  assert.equal(queries.filter(({ sql }) => /FROM fan_reminder_states/u.test(sql)).length, 2);
  const batch = f.store.records.listForProfiles(SCOPE, ids);
  assert.deepEqual(batch.get(ids[0]), f.store.records.list(SCOPE, ids[0]));
  assert.equal(f.store.records.listForProfiles('other', ids).size, 0);
  const projected = f.store.records.listProjectionInputs(SCOPE, ids);
  assert.equal(projected.size, ids.length);
  assert.deepEqual(projected.get(ids[0]).map((record) => record.id), batch.get(ids[0]).map((record) => record.id));
  assert.equal(f.store.records.listProjectionInputs('other', ids).size, 0);
  assert.deepEqual(f.store.statesForProfiles(SCOPE, ids).get(ids[0]), f.store.states(SCOPE, ids[0]));
  assert.equal(f.store.statesForProfiles('other', ids).size, 0);
});

test('list projections omit private history while preserving reminder inputs and imported roster evidence', (t) => {
  const f = fanFixture(t);
  const p = f.create({ birthday: { monthDay: '09-20' }, milestoneReminders: false });
  f.record(p.id, 'membership', interval('2026-09-01', '2026-09-30'));
  f.record(p.id, 'anniversary', { name: '相识纪念', date: '2026-09-19' });
  f.record(p.id, 'followup', { body: '跟进事项', reviewDate: '2026-09-20' });
  f.record(p.id, 'caution', { body: '复查事项', reviewDate: '2026-09-21' });
  f.record(p.id, 'song', { songName: '海边' }, { occurredAt: '2026-09-17T04:00:00.000Z' });
  const body = '仅供详情读取的手记'.repeat(100);
  const note = f.store.records.insert(SCOPE, p.id, {
    kind: 'note', occurredAt: NOW, data: recordData('note', { body }),
    original: { body, evidence: 'guard-roster', identity: p.identity, observedAt: NOW, roomId: '1234', ownerUid: '99', level: 2, medalLevel: 23 },
  });
  const edited = f.record(p.id, 'note', { body: `${body}第一次修改` }, { id: note.id, revision: note.revision });
  const full = f.detail(p.id);
  const expected = buildReminders(full, full.records, [], Date.parse(NOW), f.store.getScope(SCOPE), { daysAhead: 7 });
  const { queries } = observe(f.db.songDb);
  const listed = f.run('list').profiles[0];
  assert.deepEqual(listed.membership, full.membership);
  assert.deepEqual(listed.guardRoster, full.guardRoster);
  assert.equal(listed.currentGuardLevel, 2);
  assert.equal(listed.medalLevel, 23);
  assert.equal(listed.lastInteraction, NOW);
  assert.deepEqual(f.run('reminders'), expected);
  assert.deepEqual(f.run('calendar').map((item) => item.key), expected.map((item) => item.key));
  const reads = queries.filter(({ sql }) => /FROM fan_records/u.test(sql));
  assert.equal(reads.length, 3);
  for (const { result } of reads) {
    const row = result.find((record) => record.id === note.id);
    assert.equal(JSON.parse(row.data).body, undefined);
    assert.equal(JSON.parse(row.original).body, undefined);
    assert.ok(!Object.hasOwn(row, 'revisions'), 'unused history must not cross the SQLite read boundary');
  }
  assert.deepEqual(f.detail(p.id).records.find((record) => record.id === note.id), edited);
  assert.deepEqual(f.run('backup').profiles[0].records.find((record) => record.id === note.id), edited);
  const updated = f.record(p.id, 'note', { body: '第二次修改' }, { id: note.id, revision: edited.revision });
  assert.equal(updated.original.body, body);
  assert.equal(updated.revisions.length, 2);
  assert.equal(updated.revisions[1].before.data.body, edited.data.body);
});
