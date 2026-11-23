'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { IdentityCache } = require('../../src/bilibili/danmaku/identity-cache');
const { UserInfoService } = require('../../src/bilibili/users/user-info-service');

test('current room identity overrides a higher guard level worn in another room', () => {
  const cache = new IdentityCache();
  cache.remember(
    {
      uid: 123,
      userName: '点歌人',
      guardLevel: 3,
      medalName: '本房间灯牌',
      medalLevel: 25,
    },
    { currentRoom: true },
  );

  const identity = cache.resolve({
    uid: 123,
    userName: '点歌人',
    requesterGuardLevel: 2,
    requesterMedalName: '其他房间灯牌',
    requesterMedalLevel: 30,
  });

  assert.equal(identity.uid, '123');
  assert.equal(identity.userName, '点歌人');
  assert.equal(identity.guardLevel, 3);
  assert.equal(identity.medalName, '本房间灯牌');
  assert.equal(identity.medalLevel, 25);
});

test('verified absence of a current room medal suppresses another room medal', () => {
  const cache = new IdentityCache();
  cache.remember(
    {
      uid: 123,
      userName: '点歌人',
      guardLevel: 0,
      medalName: '',
      medalLevel: 0,
    },
    { currentRoom: true },
  );

  const identity = cache.resolve({
    uid: 123,
    userName: '点歌人',
    requesterGuardLevel: 2,
    requesterMedalName: '其他房间灯牌',
    requesterMedalLevel: 30,
  });

  assert.equal(identity.guardLevel, 0);
  assert.equal(identity.medalName, '');
  assert.equal(identity.medalLevel, 0);
});

test('verified current-room absence does not inherit an unverified cached medal', () => {
  const cache = new IdentityCache();
  cache.remember({
    uid: 123,
    userName: '点歌人',
    guardLevel: 0,
    medalName: '别家牌子',
    medalLevel: 30,
  });

  const identity = cache.resolve({
    uid: 123,
    userName: '点歌人',
    requesterGuardLevel: 0,
    requesterMedalName: '',
    requesterMedalLevel: 0,
    currentRoomVerified: true,
  });

  assert.equal(identity.guardLevel, 0);
  assert.equal(identity.medalName, '');
  assert.equal(identity.medalLevel, 0);
});

test('fans snapshot does not override identity captured from the point-song danmaku', () => {
  const cache = new IdentityCache();
  cache.resolve({
    uid: 123,
    userName: '点歌人',
    requesterGuardLevel: 0,
    requesterMedalName: 'imilly',
    requesterMedalLevel: 28,
    currentRoomVerified: true,
    identitySource: 'danmaku',
  });

  cache.remember(
    {
      uid: 123,
      userName: '点歌人',
      guardLevel: 2,
      medalName: '旧快照',
      medalLevel: 27,
    },
    { currentRoom: true, source: 'fans_rank' },
  );

  const identity = cache.resolve({ uid: 123, userName: '点歌人' });
  assert.equal(identity.guardLevel, 0);
  assert.equal(identity.medalName, 'imilly');
  assert.equal(identity.medalLevel, 28);
});

test('online viewer candidates only include the latest online snapshot', () => {
  const cache = new IdentityCache();
  cache.remember({ uid: '1', userName: 'Online', currentRoom: true }, { currentRoom: true, source: 'online_rank' });
  cache.remember({ uid: '2', userName: 'Recent', currentRoom: true }, { currentRoom: true, source: 'danmaku' });
  cache.markOnlineSnapshot(['1']);
  assert.deepEqual(
    cache.listOnline().map((viewer) => viewer.uid),
    ['1'],
  );
  cache.markOnlineSnapshot([]);
  assert.deepEqual(cache.listOnline(), []);
});

test('cached online viewer avatar is reused by a later danmaku identity', () => {
  const cache = new IdentityCache();
  cache.remember(
    {
      uid: '1',
      userName: 'Online',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/online.jpg',
    },
    { currentRoom: true, source: 'online_rank' },
  );

  assert.equal(cache.resolve({ uid: '1', userName: 'Online' }).avatarUrl, 'https://i0.hdslb.com/bfs/face/online.jpg');
});

test('recent users do not let a masked name overwrite a cached full name', () => {
  const cache = new IdentityCache();
  cache.resolve({ uid: '1', userName: '完整昵称' });
  cache.resolve({ uid: '1', userName: '**昵称' });
  assert.equal(cache.listRecent()[0].userName, '完整昵称');
});

test('legacy calls reuse the service projection across a room change', () => {
  const cache = new IdentityCache();
  const service = new UserInfoService({ identityCache: cache });
  service.setRoom({ roomId: '100', ownerUid: '1' });
  service.ingestHint({ uid: '7', name: '完整昵称', roomIdentity: { guardKnown: true, guardLevel: 3 } }, {
    ...service.beginRoomRun(), source: 'gift', roomIdentityVerified: true,
  });
  cache.remember({ uid: '7', guardLevel: 1 }, { currentRoom: true, source: 'fans_rank' });
  assert.equal(cache.resolve({ uid: '7' }).guardLevel, 3);

  service.setRoom({ roomId: '200', ownerUid: '2' });
  const stale = cache.resolve({ uid: '7', requesterGuardLevel: 3, currentRoomVerified: true });
  assert.equal(stale.guardLevel, 0);
  assert.equal(stale.userName, '完整昵称');
  assert.deepEqual(service.listRecent(), []);
});
