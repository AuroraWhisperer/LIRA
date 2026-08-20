'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBilibiliClient } = require('../src/server/bilibili-client');

test('server Bilibili client requests and applies avatar hydration only for draw guess', () => {
  const hydrated = [];
  const client = createBilibiliClient('123', {
    isShuttingDown: () => false,
    aiDanmakuDeliveryVerifier: { observe() {} },
    domainServices: {
      messages: {
        handleDanmaku: () => ({ accepted: false }),
        logDanmaku() {}
      },
      customReplies: { isCommandText: () => false },
      superChats: { add() {} },
      gifts: { add() {} }
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
    games: {
      handleDanmaku: () => ({ session: { game: 'draw-guess' } }),
      updateDanmakuAvatar: profile => hydrated.push(profile)
    }
  });

  try {
    assert.equal(client.handlers.onMessage({
      uid: '42',
      userName: 'Alice',
      message: '苹果',
      source: 'danmaku'
    }), true);
    client.handlers.onAvatarResolved({
      uid: '42',
      userName: 'Alice',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg'
    });
    assert.deepEqual(hydrated, [{
      uid: '42',
      userName: 'Alice',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg'
    }]);
  } finally {
    client.stop();
  }
});
