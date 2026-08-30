'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGameWinnerProfileResolver,
} = require('../src/bilibili/users/game-winner-profile');

test('winner profile resolver uses the recorded viewer uid and shared profile fields', async () => {
  const calls = [];
  const resolver = createGameWinnerProfileResolver({
    ensureProfile: async (uid, options) => {
      calls.push({ uid, options });
      return {
        uid,
        name: 'Alice',
        avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg',
      };
    },
  });

  assert.deepEqual(
    await resolver({ role: 'viewer', uid: '42', name: '弹幕名' }),
    {
      avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg',
      name: 'Alice',
    },
  );
  assert.deepEqual(calls, [
    { uid: '42', options: { fields: ['name', 'avatarUrl'] } },
  ]);
});

test('winner profile resolver prefers the connected host identity', async () => {
  let roomLookupCount = 0;
  const resolver = createGameWinnerProfileResolver({
    getHostIdentity: () => ({ uid: '99', name: '主播' }),
    resolveRoomInfo: async () => {
      roomLookupCount += 1;
      return { uid: '100', ownerName: '旧主播' };
    },
    ensureProfile: async (uid) => ({
      name: uid === '99' ? '主播' : '旧主播',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/host.jpg',
    }),
  });

  assert.deepEqual(await resolver({ role: 'host' }), {
    avatarUrl: 'https://i0.hdslb.com/bfs/face/host.jpg',
    name: '主播',
  });
  assert.equal(roomLookupCount, 0);
});

test('winner profile resolver falls back to room info when host is not connected', async () => {
  const resolver = createGameWinnerProfileResolver({
    resolveRoomInfo: async () => ({ uid: '100', ownerName: '主播' }),
    ensureProfile: async (uid) => {
      assert.equal(uid, '100');
      return { name: '', avatarUrl: 'https://i0.hdslb.com/bfs/face/host.jpg' };
    },
  });

  assert.deepEqual(await resolver({ role: 'host' }), {
    avatarUrl: 'https://i0.hdslb.com/bfs/face/host.jpg',
    name: '主播',
  });
});

test('winner profile resolver returns a text-only fallback after lookup failure', async () => {
  const resolver = createGameWinnerProfileResolver({
    ensureProfile: async () => {
      throw new Error('profile unavailable');
    },
  });

  assert.deepEqual(
    await resolver({ role: 'viewer', uid: '42', name: 'Alice' }),
    {
      avatarUrl: '',
      name: 'Alice',
    },
  );
});
