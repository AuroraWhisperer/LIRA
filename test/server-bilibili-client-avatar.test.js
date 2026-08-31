'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBilibiliClient } = require('../src/server/bilibili-client');

test('server Bilibili client explicitly requests and applies avatar hydration only for draw guess', async () => {
  const hydrated = [];
  const published = [];
  const client = createBilibiliClient('123', {
    isShuttingDown: () => false,
    aiDanmakuDeliveryVerifier: { observe() {} },
    domainServices: {
      messages: {
        handleDanmaku: () => ({ accepted: false }),
        logDanmaku() {},
      },
      customReplies: { isCommandText: () => false },
      superChats: { add() {} },
      gifts: { add() {} },
    },
    aiAssistant: { handleDanmaku() {} },
    danmakuSender: { send: async () => {} },
    broadcastSnapshot() {},
    publishDanmaku: (danmaku) => published.push(danmaku),
    updateLiveStatus() {},
    bilibiliDiagnostics: {},
    runtimeGiftCommandPrefixes: new Set(),
    messageBuffer: null,
    bilibiliAuthCache: { cookieHeader: '', uid: 0 },
    logGiftDelivery() {},
    games: {
      handleDanmaku: () => ({ session: { game: 'draw-guess' } }),
      updateDanmakuAvatar: (profile) => hydrated.push(profile),
    },
  });

  try {
    client.apiClient.fetchUserProfile = async () => ({
      name: 'Alice',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg',
    });
    assert.equal(
      client.handlers.onMessage({
        uid: '42',
        userName: 'Alice',
        message: '苹果',
        source: 'danmaku',
      }),
      true,
    );
    client.handlers.onMessage({
      uid: '42',
      userName: 'Alice',
      message: 'SC 命令',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg',
      source: 'superchat',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(published.length, 1);
    assert.equal(published[0].message, '苹果');
    assert.deepEqual(hydrated, [
      {
        uid: '42',
        userName: 'Alice',
        avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg',
      },
    ]);
  } finally {
    client.stop();
  }
});

test('server Bilibili client can suppress gifts without suppressing danmaku', () => {
  let gifts = 0;
  let danmaku = 0;
  const client = createBilibiliClient('123', {
    isShuttingDown: () => false,
    giftDetectionEnabled: false,
    aiDanmakuDeliveryVerifier: { observe() {} },
    domainServices: {
      messages: {
        handleDanmaku: () => {
          danmaku += 1;
          return { accepted: false };
        },
        logDanmaku() {},
      },
      customReplies: { isCommandText: () => false },
      superChats: { add() {} },
      gifts: { add: () => (gifts += 1) },
    },
    aiAssistant: { handleDanmaku() {} },
    danmakuSender: { send: async () => {} },
    broadcastSnapshot() {},
    updateLiveStatus() {},
    bilibiliDiagnostics: {},
    runtimeGiftCommandPrefixes: new Set(),
    messageBuffer: null,
    bilibiliAuthCache: { cookieHeader: '', uid: 0 },
    logGiftDelivery() {},
  });

  try {
    client.handlers.onGift({ giftName: '礼物' });
    client.handlers.onMessage({
      uid: '42',
      userName: 'Alice',
      message: '点歌 测试',
      source: 'danmaku',
    });
    assert.equal(gifts, 0);
    assert.equal(danmaku, 1);
  } finally {
    client.stop();
  }
});
