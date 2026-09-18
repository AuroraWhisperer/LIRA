'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fanFixture, SCOPE } = require('./helpers/fan-profile-fixture');
// Same synthetic v1 fixture as Server docs/protocol/fixtures/fan-facts-v1.json.
const fixture = require('./fixtures/fan-facts-v1.json');

test('the published Server fan facts fixture creates one unknown-term profile with its latest name', (t) => {
  const f = fanFixture(t);
  const scope = JSON.stringify([
    'https://lira.example',
    fixture.page.streamerId,
  ]);
  f.run('configure', { autoUpdate: true, autoCreate: true }, scope);
  f.service.consumeFacts(scope, fixture.page);
  const list = f.run('list', {}, scope).profiles;
  assert.equal(list.length, 1);
  assert.equal(list[0].platformName, '测试观众新名');
  assert.equal(list[0].membership.status, 'unknown');
  assert.equal(list[0].membership.expiry, null);
  assert.equal(list[0].membership.totalDays, null);
  f.service.consumeFacts(scope, { ...fixture.page, reset: true });
  assert.equal(f.detail(list[0].id, scope).records.length, 1);
  assert.equal(f.run('settings', {}, scope).cursor, fixture.page.nextCursor);
});

test('an empty response cannot advance past uncommitted facts or claim another page', (t) => {
  const f = fanFixture(t);
  for (const fields of [{ nextCursor: 100 }, { hasMore: true }]) {
    assert.throws(
      () =>
        f.service.consumeFacts(SCOPE, {
          version: 1,
          streamerId: 'streamer-a',
          epoch: 'test',
          after: 0,
          nextCursor: 0,
          events: [],
          ...fields,
        }),
      /空的档案同步页/,
    );
    assert.equal(f.run('settings').cursor, 0);
  }
});
