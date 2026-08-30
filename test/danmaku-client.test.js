'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BilibiliDanmakuClient } = require('../src/bilibili/danmaku-client');

class FakeWebSocket {
  static OPEN = 1;

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open', {});
    });
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }

  removeEventListener(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }

  async emit(name, event) {
    const listeners = Array.from(this.listeners.get(name) || []);
    await Promise.all(listeners.map((listener) => listener(event)));
  }

  send() {}

  close() {
    this.readyState = 3;
  }
}

function jsonResponse(payload) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function messagePacket(message) {
  const body = Buffer.from(JSON.stringify(message));
  const packet = Buffer.alloc(16 + body.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt16BE(16, 4);
  packet.writeUInt16BE(0, 6);
  packet.writeUInt32BE(5, 8);
  packet.writeUInt32BE(1, 12);
  body.copy(packet, 16);
  return packet.buffer.slice(
    packet.byteOffset,
    packet.byteOffset + packet.byteLength,
  );
}

test('extracted danmaku client keeps runtime dependencies and diagnostics', async () => {
  const originalFetch = global.fetch;
  const originalWebSocket = global.WebSocket;
  const statuses = [];
  const diagnostics = {
    lastPacketAt: '',
    lastCommandAt: '',
    lastGiftAt: '',
    parsedGiftCount: 0,
    unparsedGiftCount: 0,
    commandCounts: {},
    recentCommands: [],
    recentGiftLikeCommands: [],
  };
  const runtimeGiftCommandPrefixes = new Set();
  let client;

  global.WebSocket = FakeWebSocket;
  global.fetch = (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.endsWith('/room_init')) {
      return jsonResponse({
        code: 0,
        data: { room_id: 123, short_id: 0, uid: 456, live_status: 1 },
      });
    }
    if (url.pathname.endsWith('/nav')) {
      return jsonResponse({
        code: 0,
        data: {
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${'a'.repeat(32)}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${'b'.repeat(32)}.png`,
          },
        },
      });
    }
    if (url.pathname.endsWith('/getDanmuInfo')) {
      return jsonResponse({
        code: 0,
        data: {
          token: 'test-token',
          host_list: [{ host: 'example.test', wss_port: 443 }],
        },
      });
    }
    if (url.pathname.endsWith('/getOnlineGoldRank')) {
      return jsonResponse({ code: 0, data: { list: [], onlineNum: 0 } });
    }
    if (url.pathname.endsWith('/getFansMembersRank')) {
      return jsonResponse({ code: 0, data: { item: [], num: 0 } });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  };

  try {
    client = new BilibiliDanmakuClient(
      '123',
      {
        onMessage() {},
        onSuperChat() {},
        onGift() {},
        onStatus(status) {
          statuses.push(status);
        },
      },
      {
        diagnostics,
        runtimeGiftCommandPrefixes,
      },
    );

    await client.restart();
    assert.equal(client.ws.url, 'wss://example.test:443/sub');
    assert.equal(
      statuses.some((status) => status.connected === true),
      true,
    );
    assert.equal(client.historyPoller.timer, null);

    await client.ws.emit('message', {
      data: messagePacket({ cmd: 'TEST_COMMAND', data: {} }),
    });
    assert.notEqual(diagnostics.lastPacketAt, '');
    assert.equal(diagnostics.commandCounts.TEST_COMMAND, 1);

    const timestamp = Date.now();
    assert.equal(
      client.rememberCommandMessage({
        uid: 'viewer',
        message: '点歌 测试',
        timestampMs: timestamp,
      }),
      true,
    );
    assert.equal(
      client.rememberCommandMessage({
        uid: 'viewer',
        message: '点歌 测试',
        timestampMs: timestamp,
      }),
      false,
    );
  } finally {
    client?.stop();
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
  }
});

test('stopped danmaku client does not resume startup after room lookup resolves', async () => {
  let resolveRoomInfo;
  const roomInfoPromise = new Promise((resolve) => {
    resolveRoomInfo = resolve;
  });
  const starts = { history: 0, rank: 0, fans: 0, status: 0, websocket: 0 };
  const client = new BilibiliDanmakuClient('123', {
    onMessage() {},
    onSuperChat() {},
    onGift() {},
    onStatus() {},
  });

  client.apiClient.resolveRoomInfo = () => roomInfoPromise;
  client.historyPoller.start = () => {
    starts.history += 1;
  };
  client.onlineRankPoller.start = () => {
    starts.rank += 1;
  };
  client.fansMedalPoller.start = () => {
    starts.fans += 1;
  };
  client.liveStatusMonitor.start = () => {
    starts.status += 1;
  };
  client.wsConnection.connect = async () => {
    starts.websocket += 1;
  };

  client.start();
  client.stop();
  resolveRoomInfo({ roomId: 123, uid: 456, liveStatus: 0, ownerName: 'owner' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(client.stopped, true);
  assert.deepEqual(starts, {
    history: 0,
    rank: 0,
    fans: 0,
    status: 0,
    websocket: 0,
  });
});

test('socket errors use history only during immediate reconnect recovery', async () => {
  const originalFetch = global.fetch;
  const originalWebSocket = global.WebSocket;
  const history = { starts: 0, stops: 0 };
  let client;

  global.WebSocket = FakeWebSocket;
  global.fetch = (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.endsWith('/room_init')) {
      return jsonResponse({
        code: 0,
        data: { room_id: 123, uid: 456, live_status: 1 },
      });
    }
    if (url.pathname.endsWith('/nav')) {
      return jsonResponse({
        code: 0,
        data: {
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${'a'.repeat(32)}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${'b'.repeat(32)}.png`,
          },
        },
      });
    }
    if (url.pathname.endsWith('/getDanmuInfo')) {
      return jsonResponse({
        code: 0,
        data: {
          token: 'test-token',
          host_list: [{ host: 'example.test', wss_port: 443 }],
        },
      });
    }
    if (url.pathname.endsWith('/getOnlineGoldRank')) {
      return jsonResponse({ code: 0, data: { list: [], onlineNum: 0 } });
    }
    if (url.pathname.endsWith('/getFansMembersRank')) {
      return jsonResponse({ code: 0, data: { item: [], num: 0 } });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  };

  try {
    client = new BilibiliDanmakuClient('123', {
      onMessage() {},
      onSuperChat() {},
      onGift() {},
      onStatus() {},
    });
    await client.restart();
    client.historyPoller.start = () => {
      history.starts += 1;
      client.historyPoller.timer = {};
    };
    client.historyPoller.stop = () => {
      history.stops += 1;
      client.historyPoller.timer = null;
    };

    const failedSocket = client.ws;
    await failedSocket.emit('error', { message: 'socket failed' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(history.starts, 1);
    assert.equal(history.stops, 1);
    assert.equal(client.historyPoller.timer, null);
    assert.notEqual(client.ws, failedSocket);
    assert.equal(client.reconnecting, false);
  } finally {
    client?.stop();
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
  }
});

test('onMessage return values do not fetch profiles and explicit ensure reuses the avatar', async () => {
  const delivered = [];
  const client = new BilibiliDanmakuClient('123', {
    onMessage(message) {
      delivered.push(message);
      return true;
    },
    onSuperChat() {},
    onGift() {},
    onStatus() {},
  });
  let profileRequests = 0;
  client.apiClient.fetchUserProfile = async (uid) => {
    profileRequests += 1;
    assert.equal(uid, '64281213');
    return {
      avatarUrl: 'https://i0.hdslb.com/bfs/face/viewer.jpg',
      name: '叶上泓',
    };
  };
  client.stopped = false;
  client.userInfoService.setRoom({ roomId: '123', ownerUid: '456' });
  client.roomRunContext = client.userInfoService.beginRoomRun();
  client.messageHandlers.updateRoomOwnerUid('456');
  client.messageHandlers.updateRoomRunContext(client.roomRunContext);

  try {
    const metadata = Array(16).fill(null);
    metadata[15] = {
      extra: JSON.stringify({
        emots: {
          '[妙]': {
            url: 'https://i0.hdslb.com/bfs/emote/miao.png',
            width: 64,
            height: 64,
          },
        },
      }),
    };
    client.messageHandlers.handleDanmaku({
      cmd: 'DANMU_MSG',
      info: [metadata, '第一条[妙]', [64281213, '叶上泓']],
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(delivered[0].avatarUrl || '', '');
    assert.deepEqual(delivered[0].emotes, [
      {
        text: '[妙]',
        url: 'https://i0.hdslb.com/bfs/emote/miao.png',
        width: 64,
        height: 64,
      },
    ]);
    assert.equal(profileRequests, 0);

    const profile = await client.ensureUserInfo('64281213', {
      fields: ['name', 'avatarUrl'],
    });
    assert.equal(profile.avatarUrl, 'https://i0.hdslb.com/bfs/face/viewer.jpg');

    client.messageHandlers.handleDanmaku({
      cmd: 'DANMU_MSG',
      info: [Array(16).fill(null), '第二条', [64281213, '叶上泓']],
    });

    assert.equal(
      delivered[1].avatarUrl,
      'https://i0.hdslb.com/bfs/face/viewer.jpg',
    );
    assert.equal(profileRequests, 1);
  } finally {
    client.stop();
  }
});

test('manual viewer refresh delegates to the active online-rank poller', async () => {
  const client = new BilibiliDanmakuClient('123', {
    onMessage() {},
    onSuperChat() {},
    onGift() {},
    onStatus() {},
  });
  const roomRunContext = { roomId: '123', ownerUid: '456', runToken: 1 };
  let receivedContext = null;
  client.roomRunContext = roomRunContext;
  client.onlineRankPoller.pollOnlineRank = async (context) => {
    receivedContext = context;
  };

  try {
    await client.refreshViewerCandidates();
    assert.equal(receivedContext, roomRunContext);
  } finally {
    client.stop();
  }
});
