'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { IdentityCache } = require('../src/bilibili/danmaku/identity-cache');

test('current room identity overrides a higher guard level worn in another room', () => {
  const cache = new IdentityCache();
  cache.remember({
    uid: 123,
    userName: '点歌人',
    guardLevel: 3,
    medalName: '本房间灯牌',
    medalLevel: 25
  }, { currentRoom: true });

  const identity = cache.resolve({
    uid: 123,
    userName: '点歌人',
    requesterGuardLevel: 2,
    requesterMedalName: '其他房间灯牌',
    requesterMedalLevel: 30
  });

  assert.equal(identity.uid, '123');
  assert.equal(identity.userName, '点歌人');
  assert.equal(identity.guardLevel, 3);
  assert.equal(identity.medalName, '本房间灯牌');
  assert.equal(identity.medalLevel, 25);
});

test('verified absence of a current room medal suppresses another room medal', () => {
  const cache = new IdentityCache();
  cache.remember({
    uid: 123,
    userName: '点歌人',
    guardLevel: 0,
    medalName: '',
    medalLevel: 0
  }, { currentRoom: true });

  const identity = cache.resolve({
    uid: 123,
    userName: '点歌人',
    requesterGuardLevel: 2,
    requesterMedalName: '其他房间灯牌',
    requesterMedalLevel: 30
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
    medalLevel: 30
  });

  const identity = cache.resolve({
    uid: 123,
    userName: '点歌人',
    requesterGuardLevel: 0,
    requesterMedalName: '',
    requesterMedalLevel: 0,
    currentRoomVerified: true
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
    identitySource: 'danmaku'
  });

  cache.remember({
    uid: 123,
    userName: '点歌人',
    guardLevel: 2,
    medalName: '旧快照',
    medalLevel: 27
  }, { currentRoom: true, source: 'fans_rank' });

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
  assert.deepEqual(cache.listOnline().map(viewer => viewer.uid), ['1']);
  cache.markOnlineSnapshot([]);
  assert.deepEqual(cache.listOnline(), []);
});

test('cached online viewer avatar is reused by a later danmaku identity', () => {
  const cache = new IdentityCache();
  cache.remember({
    uid: '1',
    userName: 'Online',
    avatarUrl: 'https://i0.hdslb.com/bfs/face/online.jpg'
  }, { currentRoom: true, source: 'online_rank' });

  assert.equal(cache.resolve({ uid: '1', userName: 'Online' }).avatarUrl,
    'https://i0.hdslb.com/bfs/face/online.jpg');
});
