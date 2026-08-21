'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { IdentityCache } = require('../src/bilibili/danmaku/identity-cache');
const { UserInfoService } = require('../src/bilibili/users/user-info-service');

function createService(options = {}) {
  let nowMs = options.nowMs || 1_000;
  const service = new UserInfoService({
    identityCache: new IdentityCache(),
    profileProvider: options.profileProvider,
    now: () => nowMs,
    diagnostics: options.diagnostics
  });
  return {
    service,
    advance(ms = 1) {
      nowMs += ms;
    }
  };
}

function beginRoom(service, roomId = '100', ownerUid = '999') {
  service.setRoom({ roomId, ownerUid });
  return service.beginRoomRun();
}

test('profile merge preserves a full name and accepts the freshest valid avatar', () => {
  const { service, advance } = createService();
  const run = beginRoom(service);

  service.ingestHint({
    uid: '123',
    name: 'Alice',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/old.jpg'
  }, { ...run, source: 'danmaku' });
  advance();
  service.ingestHint({
    uid: '123',
    name: '**ice',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/new.jpg'
  }, { ...run, source: 'superchat' });

  assert.deepEqual(service.peek('123', { fields: ['name', 'avatarUrl'] }), {
    uid: '123',
    name: 'Alice',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/new.jpg'
  });
});

test('room identity uses verification, target ownership, authority, and verified absence', () => {
  const { service, advance } = createService();
  const run = beginRoom(service);

  service.ingestHint({
    uid: '123',
    roomIdentity: {
      guardKnown: true,
      guardLevel: 3,
      medalKnown: true,
      fansMedal: { name: '本房牌', level: 28, targetUid: '999' }
    }
  }, { ...run, source: 'danmaku', roomIdentityVerified: true });
  advance();
  service.ingestHint({
    uid: '123',
    roomIdentity: {
      guardKnown: true,
      guardLevel: 0,
      medalKnown: true,
      fansMedal: null
    }
  }, { ...run, source: 'fans_rank', roomIdentityVerified: true });
  advance();
  service.ingestHint({
    uid: '123',
    roomIdentity: {
      medalKnown: true,
      fansMedal: { name: '别家牌', level: 30, targetUid: '888' }
    }
  }, { ...run, source: 'danmaku', roomIdentityVerified: true });

  assert.deepEqual(service.peek('123', { fields: ['guard', 'fansMedal'] }), {
    uid: '123',
    room: { roomId: '100', ownerUid: '999' },
    guard: { known: true, level: 3 },
    fansMedal: {
      known: true,
      value: { name: '本房牌', level: 28, targetUid: '999' }
    }
  });

  advance();
  service.ingestHint({
    uid: '123',
    roomIdentity: { guardKnown: true, guardLevel: 0, medalKnown: true, fansMedal: null }
  }, { ...run, source: 'superchat', roomIdentityVerified: true });
  assert.deepEqual(service.peek('123', { fields: ['guard', 'fansMedal'] }), {
    uid: '123',
    room: { roomId: '100', ownerUid: '999' },
    guard: { known: true, level: 0 },
    fansMedal: { known: true, value: null }
  });
});

test('field validation precedes stale-room guards and projections hide internal metadata', async () => {
  const { service } = createService();
  const run = beginRoom(service);
  service.ingestHint({ uid: '123', name: 'Alice' }, { ...run, source: 'danmaku' });

  assert.throws(() => service.peek('123', { roomId: 'old', fields: ['unknown'] }), TypeError);
  await assert.rejects(service.ensure('123', { fields: ['guard'] }), TypeError);
  assert.equal(service.peek('123', { roomId: 'old', fields: ['name'] }), null);
  assert.deepEqual(service.listRecent({ roomId: 'old', fields: ['name'] }), []);
  assert.deepEqual(service.peek('123', { fields: [] }), { uid: '123' });
  assert.deepEqual(Object.keys(service.peek('123', { fields: ['name', 'name'] })), ['uid', 'name']);
});

test('subscriptions report only projected material changes and generic room invalidation', () => {
  const { service, advance } = createService();
  const run = beginRoom(service);
  const nameEvents = [];
  const roomEvents = [];
  const explicitRoomEvents = [];
  service.subscribe(event => nameEvents.push(event), { fields: ['name'] });
  service.subscribe(event => roomEvents.push(event), { fields: ['fansMedal'] });
  service.subscribe(event => explicitRoomEvents.push(event), { roomId: '100', fields: ['fansMedal'] });

  const hint = {
    uid: '123',
    name: 'Alice',
    roomIdentity: {
      medalKnown: true,
      fansMedal: { name: '本房牌', level: 28, targetUid: '999' }
    }
  };
  service.ingestHint(hint, { ...run, source: 'danmaku', roomIdentityVerified: true });
  advance();
  service.ingestHint(hint, { ...run, source: 'danmaku', roomIdentityVerified: true });

  assert.equal(nameEvents.length, 1);
  assert.deepEqual(nameEvents[0].changedFields, ['name']);
  assert.equal(roomEvents.length, 1);
  assert.equal(explicitRoomEvents.length, 1);

  service.setRoom({ roomId: '200', ownerUid: '777' });
  assert.equal(nameEvents.length, 1);
  assert.equal(roomEvents.length, 2);
  assert.deepEqual(roomEvents[1].changedFields, ['fansMedal']);
  assert.deepEqual(roomEvents[1].snapshot.fansMedal, { known: false });
  assert.equal(explicitRoomEvents.length, 1);
});

test('room generation and run token reject stale mixed hints and snapshots', () => {
  const { service } = createService();
  const runA1 = beginRoom(service, '100', '999');
  service.replaceOnlineSnapshot(['123'], runA1);
  assert.deepEqual(service.listOnline().map(item => item.uid), []);

  service.ingestHint({ uid: '123', name: 'Alice' }, { ...runA1, source: 'online_rank' });
  service.replaceOnlineSnapshot(['123'], runA1);
  assert.deepEqual(service.listOnline({ fields: ['name'] }), [{ uid: '123', name: 'Alice' }]);

  service.setRoom({ roomId: '200', ownerUid: '777' });
  beginRoom(service, '100', '999');
  assert.deepEqual(service.ingestHint({ uid: '456', name: 'Stale' }, {
    ...runA1,
    source: 'danmaku'
  }), { snapshot: null, changedFields: [] });
  assert.equal(service.peek('456'), null);

  const currentRun = service.beginRoomRun();
  const staleRunResult = service.ingestHint({ uid: '789', name: 'Old run' }, {
    ...currentRun,
    runToken: currentRun.runToken - 1,
    source: 'history'
  });
  assert.deepEqual(staleRunResult, { snapshot: null, changedFields: [] });
});

test('ensure deduplicates profile requests, negative-caches failures, and protects explicit callers', async () => {
  let calls = 0;
  let resolveProfile;
  const profilePromise = new Promise(resolve => { resolveProfile = resolve; });
  const { service, advance } = createService({
    profileProvider: {
      fetchProfile() {
        calls += 1;
        return profilePromise;
      }
    }
  });
  beginRoom(service);

  const nameRequest = service.ensure('123', { fields: ['name'], roomId: '100' });
  const avatarRequest = service.ensure('123', { fields: ['avatarUrl'] });
  assert.equal(calls, 1);
  service.setRoom({ roomId: '200', ownerUid: '777' });
  resolveProfile({ name: 'Alice', avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg' });

  assert.equal(await nameRequest, null);
  assert.deepEqual(await avatarRequest, {
    uid: '123',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg'
  });
  assert.equal(service.peek('123', { fields: ['name'] }).name, 'Alice');

  let failureCalls = 0;
  const failing = createService({
    profileProvider: {
      async fetchProfile() {
        failureCalls += 1;
        throw new Error('upstream unavailable');
      }
    }
  });
  await failing.service.ensure('9');
  await failing.service.ensure('9');
  assert.equal(failureCalls, 1);
  failing.advance(30_001);
  await failing.service.ensure('9');
  assert.equal(failureCalls, 2);
  advance();
});

test('begin/end/dispose own room-run and service lifecycle', async () => {
  let resolveProfile;
  const { service } = createService({
    profileProvider: {
      fetchProfile: () => new Promise(resolve => { resolveProfile = resolve; })
    }
  });
  assert.throws(() => service.beginRoomRun(), /room scope/i);
  const run = beginRoom(service);
  service.ingestHint({ uid: '123', name: 'Alice' }, { ...run, source: 'online_rank' });
  service.replaceOnlineSnapshot(['123'], run);
  assert.equal(service.listOnline().length, 1);
  service.endRoomRun(run);
  service.endRoomRun(run);
  assert.deepEqual(service.listOnline(), []);

  const pending = service.ensure('456');
  service.dispose();
  service.dispose();
  resolveProfile({ name: 'Late' });
  assert.equal(await pending, null);
  assert.equal(service.peek('456'), null);
});
