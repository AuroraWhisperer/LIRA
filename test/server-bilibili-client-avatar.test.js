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
    bilibiliAuthCache: { cookieHeader: '', uid: 0 },
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

test('server Bilibili client has no raw gift writer and preserves identity, danmaku and SC', (t) => {
  let gifts = 0;
  let danmaku = 0;
  let superChats = 0;
  const hints = [];
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args));
  const client = createBilibiliClient('123', {
    isShuttingDown: () => false,
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
      superChats: { add: () => (superChats += 1) },
      gifts: { add: () => (gifts += 1) },
    },
    aiAssistant: { handleDanmaku() {} },
    danmakuSender: { send: async () => {} },
    broadcastSnapshot() {},
    updateLiveStatus() {},
    bilibiliDiagnostics: { parsedGiftCount: 0 },
    bilibiliAuthCache: { cookieHeader: '', uid: 0 },
  });

  try {
    assert.equal(client.handlers.onGift, undefined);
    t.mock.method(client.messageHandlers, 'ingestIdentity', (hint) => {
      hints.push(hint);
      return { uid: hint.uid, userName: hint.name };
    });
    client.messageHandlers.handleIdentityMessage({
      cmd: 'SEND_GIFT',
      data: {
        uid: 42,
        uname: 'Alice',
        giftId: 1,
        giftName: '礼物',
        num: 1,
        price: 1000,
        total_coin: 1000,
        coin_type: 'gold',
      },
    });
    client.messageHandlers.handleIdentityMessage({
      cmd: 'SEND_GIFT',
      data: {},
    });
    client.handlers.onMessage({
      uid: '42',
      userName: 'Alice',
      message: '点歌 测试',
      source: 'danmaku',
    });
    client.handlers.onSuperChat({
      id: 'sc-1',
      uid: '42',
      userName: 'Alice',
      message: '支持',
      price: 30,
    });
    assert.equal(gifts, 0);
    assert.equal(danmaku, 1);
    assert.equal(superChats, 1);
    assert.equal(hints.length, 1);
    assert.equal(hints[0].name, 'Alice');
    assert.equal(client.diagnostics.parsedGiftCount, 0);
    assert.deepEqual(logs, []);
    assert.equal(client.messageHandlers.messageBuffer, undefined);
  } finally {
    client.stop();
  }
});
