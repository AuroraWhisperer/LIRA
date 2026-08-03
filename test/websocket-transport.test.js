'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  broadcastSnapshot,
  createWebSocketHub,
  handleWebSocketUpgrade
} = require('../src/server/ws');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.ended = false;
    this.destroyed = false;
  }

  write(chunk) {
    this.writes.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : String(chunk));
    return true;
  }

  end() {
    this.ended = true;
  }

  destroy() {
    this.destroyed = true;
  }
}

function maskedFrame(payload, { opcode, fin }) {
  const body = Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | body.length;
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  header[0] = (fin ? 0x80 : 0) | opcode;

  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.from(body);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % mask.length];
  }
  return Buffer.concat([header, mask, masked]);
}

test('fragmented WebSocket messages are capped across frames', () => {
  const socket = new FakeSocket();
  const context = {
    sessionToken: '',
    state: { sockets: new Set() },
    getState: () => ({ ok: true })
  };

  handleWebSocketUpgrade(context, {
    url: '/ws',
    headers: {
      host: '127.0.0.1:3000',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='
    }
  }, socket);

  socket.emit('data', maskedFrame(Buffer.alloc(200 * 1024, 0x61), { opcode: 0x1, fin: false }));
  socket.emit('data', maskedFrame(Buffer.alloc(100 * 1024, 0x62), { opcode: 0x0, fin: true }));

  const binaryWrites = socket.writes.filter(Buffer.isBuffer);
  const closeFrame = binaryWrites.at(-1);
  assert.equal(closeFrame[0] & 0x0f, 0x8);
  assert.equal(closeFrame.readUInt16BE(2), 1009);
  assert.equal(socket.ended, true);
  assert.equal(context.state.sockets.has(socket), false);
});

test('WebSocket hub starts heartbeat on upgrade and releases resources on stop', async () => {
  const hub = createWebSocketHub({ heartbeatIntervalMs: 5 });
  const socket = new FakeSocket();
  const context = {
    sessionToken: '',
    getState: () => ({ ok: true })
  };

  hub.handleUpgrade(context, {
    url: '/ws',
    headers: {
      host: '127.0.0.1:3000',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='
    }
  }, socket);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const heartbeatCount = socket.writes.filter((write) => (
    Buffer.isBuffer(write) && (write[0] & 0x0f) === 0x9
  )).length;
  assert.ok(heartbeatCount > 0, 'heartbeat should begin after a successful upgrade');

  hub.stop();
  assert.equal(socket.ended, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stoppedHeartbeatCount = socket.writes.filter((write) => (
    Buffer.isBuffer(write) && (write[0] & 0x0f) === 0x9
  )).length;
  assert.equal(stoppedHeartbeatCount, heartbeatCount);
});

test('compatibility broadcasts remain isolated to their context sockets', () => {
  const firstSocket = new FakeSocket();
  const secondSocket = new FakeSocket();
  const firstContext = {
    sessionToken: '',
    state: { sockets: new Set() },
    getState: () => ({ runtime: 'first' })
  };
  const secondContext = {
    sessionToken: '',
    state: { sockets: new Set() },
    getState: () => ({ runtime: 'second' })
  };
  const request = {
    url: '/ws',
    headers: {
      host: '127.0.0.1:3000',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='
    }
  };

  handleWebSocketUpgrade(firstContext, request, firstSocket);
  handleWebSocketUpgrade(secondContext, request, secondSocket);
  firstSocket.writes = [];
  secondSocket.writes = [];

  broadcastSnapshot(firstContext, 'first:update');

  assert.equal(firstSocket.writes.length, 1);
  assert.equal(secondSocket.writes.length, 0);
  firstSocket.emit('close');
  secondSocket.emit('close');
});
