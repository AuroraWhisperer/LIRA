'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBilibiliClient } = require('../src/server/bilibili-client');

test('server Bilibili client explicitly requests and applies avatar hydration only for draw guess', async () => {
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
    client.apiClient.fetchUserProfile = async () => ({
      name: 'Alice',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg'
    });
    assert.equal(client.handlers.onMessage({
      uid: '42',
      userName: 'Alice',
      message: '苹果',
      source: 'danmaku'
    }), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(hydrated, [{
      uid: '42',
      userName: 'Alice',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/alice.jpg'
    }]);
  } finally {
    client.stop();
  }
});
