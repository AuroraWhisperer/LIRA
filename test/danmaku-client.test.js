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
  return Promise.resolve(new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }));
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
  return packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength);
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
    recentGiftLikeCommands: []
  };
  const runtimeGiftCommandPrefixes = new Set();
  let client;

  global.WebSocket = FakeWebSocket;
  global.fetch = (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.endsWith('/room_init')) {
      return jsonResponse({
        code: 0,
        data: { room_id: 123, short_id: 0, uid: 456, live_status: 1 }
      });
    }
    if (url.pathname.endsWith('/nav')) {
      return jsonResponse({
        code: 0,
        data: {
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${'a'.repeat(32)}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${'b'.repeat(32)}.png`
          }
        }
      });
    }
    if (url.pathname.endsWith('/getDanmuInfo')) {
      return jsonResponse({
        code: 0,
        data: { token: 'test-token', host_list: [{ host: 'example.test', wss_port: 443 }] }
      });
    }
    if (url.pathname.endsWith('/getOnlineGoldRank')) {
      return jsonResponse({ code: 0, data: { list: [], onlineNum: 0 } });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  };

  try {
    client = new BilibiliDanmakuClient('123', {
      onMessage() {},
      onSuperChat() {},
      onGift() {},
      onStatus(status) {
        statuses.push(status);
      }
    }, {
      diagnostics,
      runtimeGiftCommandPrefixes
    });

    await client.restart();
    assert.equal(client.ws.url, 'wss://example.test:443/sub');
    assert.equal(statuses.some((status) => status.connected === true), true);

    await client.ws.emit('message', {
      data: messagePacket({ cmd: 'TEST_COMMAND', data: {} })
    });
    assert.notEqual(diagnostics.lastPacketAt, '');
    assert.equal(diagnostics.commandCounts.TEST_COMMAND, 1);

    const timestamp = Date.now();
    assert.equal(client.rememberCommandMessage({
      uid: 'viewer',
      message: '点歌 测试',
      timestampMs: timestamp
    }), true);
    assert.equal(client.rememberCommandMessage({
      uid: 'viewer',
      message: '点歌 测试',
      timestampMs: timestamp
    }), false);
  } finally {
    client?.stop();
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
  }
});
