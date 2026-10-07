'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fanFixture, SCOPE } = require('../helpers/fan-profile-fixture');

// Records SELECT statements so the list path can be checked for N+1 record reads.
function observe(db) {
  const queries = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    for (const method of ['all', 'get']) {
      const execute = statement[method].bind(statement);
      statement[method] = (...params) => {
        if (/^\s*SELECT/iu.test(sql)) queries.push({ sql, params });
        return execute(...params);
      };
    }
    return statement;
  };
  return { queries };
}

test('fan list loads only candidates and batches full lists without changing record order or scope', (t) => {
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
  const batch = f.store.records.listForProfiles(SCOPE, ids);
  assert.deepEqual(batch.get(ids[0]), f.store.records.list(SCOPE, ids[0]));
  assert.equal(f.store.records.listForProfiles('other', ids).size, 0);
  assert.deepEqual(f.store.statesForProfiles(SCOPE, ids).get(ids[0]), f.store.states(SCOPE, ids[0]));
  assert.equal(f.store.statesForProfiles('other', ids).size, 0);
});
