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
