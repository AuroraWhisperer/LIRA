'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { projectGuardExpiry } = require('../../src/fans/guard-expiry');
const { fixture, deferred } = require('../helpers/fan-profile-controller-fixture');
const { fanFixture, IDENTITY, SCOPE } = require('../helpers/fan-profile-fixture');

const NOW = Date.parse('2026-10-12T04:00:00Z');
const profile = { id: 'fan', identity: IDENTITY, currentGuardLevel: 3 };
const warning = { uid: IDENTITY.value, guardLevel: 3, days: 3 };
const snapshot = { state: 'ready', roomId: '42', observedAt: new Date(NOW).toISOString(), expiring: [warning], expired: [] };
const project = (value = snapshot, profiles = [profile], now = NOW) => projectGuardExpiry(value, profiles, '42', now);

test('expiry projection uses only confirmed 0–3 day Bilibili warnings without changing identity', () => {
  for (const level of [1, 2, 3]) {
    for (const days of [0, 1, 2, 3, 4, -1, 1.5]) {
      const result = project({ ...snapshot, expiring: [{ ...warning, guardLevel: level, days }] }, [{ ...profile, currentGuardLevel: level }]);
      assert.deepEqual(result.badges, [0, 1, 2, 3].includes(days) ? [{ profileId: 'fan', level, days }] : []);
    }
  }
  assert.equal(profile.currentGuardLevel, 3);
  assert.equal(project({ ...snapshot, account: { uid: '123' } }, [
    { ...profile, guardRoster: { roomId: '12345', ownerUid: '123', level: 3 } },
  ]).badges.length, 1, 'canonical roster room and configured short room share the verified owner');
  for (const value of [
    { ...snapshot, expiring: [] },
    { ...snapshot, expired: [{ ...warning, days: 0 }] },
    { ...snapshot, expiring: [warning, warning] },
    { ...snapshot, expiring: [warning, { ...warning, guardLevel: 2 }] },
    { ...snapshot, roomId: '99' },
    { ...snapshot, observedAt: 'bad' },
  ]) assert.deepEqual(project(value).badges, []);
  for (const patch of [{ archived: true }, { identity: null }, { currentGuardLevel: null },
    { currentGuardLevel: 2 }, { guardRoster: { roomId: '99', level: 3 } }]) {
    assert.deepEqual(project(snapshot, [{ ...profile, ...patch }]).badges, []);
  }
});

test('expiry never reuses yesterday, future, stale or failed observations', () => {
  for (const state of ['loginRequired', 'ownerMismatch', 'roomNotConfigured', 'sourceChanged', 'unavailable']) {
    assert.deepEqual(project({ ...snapshot, state }), { state, observedAt: null, badges: [] });
  }
  for (const now of [NOW - 1, NOW + 300000]) assert.equal(project(snapshot, [profile], now).state, 'unavailable');
  assert.equal(project({ ...snapshot, observedAt: '2026-10-12T15:59:59Z' }, [profile], Date.parse('2026-10-12T16:00:00Z')).state, 'unavailable');
});

test('expiry IPC merges concurrent reads, projects safe fields, and removes renewed warnings', async (t) => {
  const pending = deferred();
  let calls = 0;
  const f = fixture(t, { now: () => NOW, expiry: () => { calls++; return pending.promise; } });
  const original = f.service.execute;
  f.service.execute = (scope, action, payload) => action === 'list' ? { profiles: [profile] } : original(scope, action, payload);
  const { contextId } = f.invoke({ action: 'open' });
  const request = { action: 'guard-expiry', contextId };
  const first = f.invoke(request);
  const second = f.invoke(request);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  pending.resolve({ ...snapshot, cookie: 'must-not-leak', account: { uid: '123' } });
  assert.deepEqual((await first).data.badges, [{ profileId: 'fan', level: 3, days: 3 }]);
  assert.equal(JSON.stringify(await second).includes('must-not-leak'), false);
  f.licenseManager.getGuardExpiryWarningsInternal = async () => ({ ...snapshot, expiring: [] });
  assert.deepEqual((await f.invoke(request)).data.badges, []);
  assert.equal(profile.currentGuardLevel, 3);
});

test('expiry IPC discards account/room changes and aborts readers on disposal', async (t) => {
  for (const change of ['account', 'room', 'dispose']) {
    const pending = deferred();
    let signal;
    const f = fixture(t, { now: () => NOW, expiry: (input) => { signal = input.signal; return pending.promise; } });
    const { contextId } = f.invoke({ action: 'open' });
    const request = f.invoke({ action: 'guard-expiry', contextId });
    await new Promise(setImmediate);
    if (change === 'account') { f.state.streamerId = 'streamer-b'; f.state.epoch++; f.emit(); }
    if (change === 'room') f.state.roomId = '99';
    if (change === 'dispose') f.controller.dispose();
    pending.resolve(snapshot);
    const result = await request;
    if (change === 'room') assert.deepEqual(result.data.badges, []);
    else { assert.equal(signal.aborted, true); assert.equal(result.ok, false); }
    await f.controller.whenIdle();
  }
});

test('expiry IPC explains old servers without blocking local profiles and requires page context', async (t) => {
  const f = fixture(t, { expiry: async () => { throw Object.assign(new Error('secret'), { code: 'GUARD_EXPIRY_UNSUPPORTED' }); } });
  assert.equal(f.invoke({ action: 'guard-expiry' }).ok, false);
  const opened = f.invoke({ action: 'open' });
  assert.equal(opened.ok, true);
  const result = await f.invoke({ action: 'guard-expiry', contextId: opened.contextId });
  assert.deepEqual(result.data, { state: 'unsupported', observedAt: null, badges: [] });
});

test('blacklisted profiles cannot receive expiry badges through the list owner', (t) => {
  const f = fanFixture(t);
  const created = f.create();
  f.run('suppress', { id: created.id, revision: created.revision });
  assert.deepEqual(project(snapshot, f.service.execute(SCOPE, 'list').profiles).badges, []);
});
