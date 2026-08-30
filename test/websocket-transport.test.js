'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  broadcastSnapshot,
  createWebSocketHub,
  handleWebSocketUpgrade,
} = require('../src/server/ws');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.writableLength = 0;
    this.ended = false;
    this.destroyed = false;
    this.dataHandlerRemovals = 0;
  }

  write(chunk) {
    this.writes.push(
      Buffer.isBuffer(chunk) ? Buffer.from(chunk) : String(chunk),
    );
    return true;
  }

  end() {
    this.ended = true;
  }

  destroy() {
    this.destroyed = true;
  }

  off(eventName, listener) {
    if (eventName === 'data') this.dataHandlerRemovals += 1;
    return super.off(eventName, listener);
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
    getState: () => ({ ok: true }),
  };

  handleWebSocketUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    },
    socket,
  );

  socket.emit(
    'data',
    maskedFrame(Buffer.alloc(200 * 1024, 0x61), { opcode: 0x1, fin: false }),
  );
  socket.emit(
    'data',
    maskedFrame(Buffer.alloc(100 * 1024, 0x62), { opcode: 0x0, fin: true }),
  );

  const binaryWrites = socket.writes.filter(Buffer.isBuffer);
  const closeFrame = binaryWrites.at(-1);
  assert.equal(closeFrame[0] & 0x0f, 0x8);
  assert.equal(closeFrame.readUInt16BE(2), 1009);
  assert.equal(socket.ended, true);
  assert.equal(context.state.sockets.has(socket), false);
});

test('ignores data events that arrive after WebSocket cleanup', () => {
  const socket = new FakeSocket();
  const context = {
    sessionToken: '',
    state: { sockets: new Set() },
    getState: () => ({ ok: true }),
  };

  handleWebSocketUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    },
    socket,
  );
  socket.writes = [];

  socket.emit('close');
  socket.emit('error', new Error('late socket error'));

  assert.equal(socket._wsBuffer, null);
  assert.equal(context.state.sockets.has(socket), false);
  assert.equal(socket.listenerCount('data'), 0);
  assert.equal(socket.dataHandlerRemovals, 1);
  assert.doesNotThrow(() =>
    socket.emit('data', maskedFrame('late', { opcode: 0x1, fin: true })),
  );
  assert.equal(socket._wsBuffer, null);
  assert.equal(context.state.sockets.has(socket), false);
  assert.equal(socket.writes.length, 0);
});

test('WebSocket hub starts heartbeat on upgrade and releases resources on stop', async () => {
  const hub = createWebSocketHub({ heartbeatIntervalMs: 5 });
  const socket = new FakeSocket();
  const context = {
    sessionToken: '',
    getState: () => ({ ok: true }),
  };

  hub.handleUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    },
    socket,
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  const heartbeatCount = socket.writes.filter(
    (write) => Buffer.isBuffer(write) && (write[0] & 0x0f) === 0x9,
  ).length;
  assert.ok(
    heartbeatCount > 0,
    'heartbeat should begin after a successful upgrade',
  );

  hub.stop();
  assert.equal(socket.ended, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stoppedHeartbeatCount = socket.writes.filter(
    (write) => Buffer.isBuffer(write) && (write[0] & 0x0f) === 0x9,
  ).length;
  assert.equal(stoppedHeartbeatCount, heartbeatCount);
});

test('coalesces same-turn hub snapshots and keeps the latest reason', async () => {
  const hub = createWebSocketHub();
  const socket = new FakeSocket();
  let stateReads = 0;
  const context = {
    sessionToken: '',
    getState: () => {
      stateReads += 1;
      return { stateReads };
    },
  };
  hub.handleUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    },
    socket,
  );
  socket.writes = [];
  stateReads = 0;

  hub.broadcastSnapshot(context, 'first:update');
  hub.broadcastSnapshot(context, 'latest:update');
  assert.equal(stateReads, 0);
  await new Promise((resolve) => queueMicrotask(resolve));

  assert.equal(stateReads, 1);
  assert.equal(socket.writes.length, 1);
  assert.match(socket.writes[0].toString('utf8'), /latest:update/);
  hub.stop();
});

test('WebSocket hub filters topic broadcasts without changing ordinary broadcasts', () => {
  const hub = createWebSocketHub();
  const topicSocket = new FakeSocket();
  const ordinarySocket = new FakeSocket();
  const context = {
    sessionToken: '',
    state: { sockets: new Set() },
    getState: () => ({ ok: true }),
  };
  const headers = {
    host: '127.0.0.1:3000',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
  };

  hub.handleUpgrade(
    context,
    { url: '/ws?topic=danmaku', headers },
    topicSocket,
  );
  hub.handleUpgrade(context, { url: '/ws', headers }, ordinarySocket);
  topicSocket.writes = [];
  ordinarySocket.writes = [];

  hub.broadcast(
    { type: 'danmaku:message', item: { id: 'one' } },
    { topic: 'danmaku' },
  );
  assert.equal(topicSocket.writes.length, 1);
  assert.equal(ordinarySocket.writes.length, 0);

  hub.broadcast({ type: 'ordinary:update' });
  assert.equal(topicSocket.writes.length, 2);
  assert.equal(ordinarySocket.writes.length, 1);
  hub.stop();
});

test('WebSocket hub drops a client before its pending write queue exceeds the ceiling', () => {
  const hub = createWebSocketHub({ maxPendingBytes: 128 });
  const socket = new FakeSocket();
  const context = {
    sessionToken: '',
    state: { sockets: new Set() },
    getState: () => ({ ok: true }),
  };

  hub.handleUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    },
    socket,
  );
  socket.writes = [];
  socket.writableLength = 120;

  hub.broadcast({ type: 'ordinary:update', value: 'pending-overflow' });

  assert.equal(socket.destroyed, true);
  assert.equal(context.state.sockets.has(socket), false);
  assert.equal(socket.listenerCount('data'), 0);
  assert.equal(socket.writes.length, 0);
  hub.stop();
});

test('compatibility broadcasts remain isolated to their context sockets', () => {
  const firstSocket = new FakeSocket();
  const secondSocket = new FakeSocket();
  const firstContext = {
    sessionToken: '',
    state: { sockets: new Set() },
    getState: () => ({ runtime: 'first' }),
  };
  const secondContext = {
    sessionToken: '',
    state: { sockets: new Set() },
    getState: () => ({ runtime: 'second' }),
  };
  const request = {
    url: '/ws',
    headers: {
      host: '127.0.0.1:3000',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    },
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

test('WebSocket upgrade rejects requests with wrong Origin', () => {
  const socket = new FakeSocket();
  const context = {
    sessionToken: '',
    allowedOrigins: ['http://127.0.0.1:3000'],
    getState: () => ({ ok: true }),
  };

  handleWebSocketUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        origin: 'http://evil.com',
      },
    },
    socket,
  );

  assert.equal(socket.destroyed, true);
  const responseText = socket.writes.join('');
  assert.match(responseText, /403 Forbidden/);
});

test('WebSocket upgrade accepts requests with correct Origin', () => {
  const socket = new FakeSocket();
  const context = {
    sessionToken: '',
    allowedOrigins: ['http://127.0.0.1:3000'],
    state: { sockets: new Set() },
    getState: () => ({ ok: true }),
  };

  handleWebSocketUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        origin: 'http://127.0.0.1:3000',
      },
    },
    socket,
  );

  assert.equal(socket.destroyed, false);
  const responseText = socket.writes.join('');
  assert.match(responseText, /101 Switching Protocols/);
  socket.emit('close');
});

test('WebSocket upgrade accepts requests without Origin header (non-browser)', () => {
  const socket = new FakeSocket();
  const context = {
    sessionToken: '',
    allowedOrigins: ['http://127.0.0.1:3000'],
    state: { sockets: new Set() },
    getState: () => ({ ok: true }),
  };

  handleWebSocketUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        // No origin header
      },
    },
    socket,
  );

  assert.equal(socket.destroyed, false);
  const responseText = socket.writes.join('');
  assert.match(responseText, /101 Switching Protocols/);
  socket.emit('close');
});
