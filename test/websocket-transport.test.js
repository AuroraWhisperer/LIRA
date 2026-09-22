'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { broadcastSnapshot, createWebSocketHub, handleWebSocketUpgrade } = require('../src/server/ws');

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
    this.writes.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : String(chunk));
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

function openTestSocket(t) {
  const hub = createWebSocketHub({ closeTimeoutMs: 100 });
  const socket = new FakeSocket();
  const context = { sessionToken: 'synthetic-token', state: { sockets: new Set() }, getState: () => ({}) };
  hub.handleUpgrade(
    context,
    {
      url: '/ws',
      headers: { authorization: 'Bearer synthetic-token', 'sec-websocket-key': 'test' },
    },
    socket,
  );
  socket.writes = [];
  t.after(() => {
    hub.stop();
    socket.emit('close');
  });
  return { hub, socket, context };
}

const frame = (payload, opcode = 0x1, fin = true) => maskedFrame(payload, { opcode, fin });
const invalidFrames = [
  ['unmasked', Buffer.from([0x81, 0]), 1002],
  ['reserved bits', Buffer.from([0xc1, 0x80]), 1002],
  ['reserved opcode', frame('', 0x3), 1002],
  ['reserved control opcode', frame('', 0xb), 1002],
  ['fragmented ping', frame('', 0x9, false), 1002],
  ['oversized ping', frame(Buffer.alloc(200), 0x9), 1002],
  ['oversized pong', frame(Buffer.alloc(126), 0xa), 1002],
  ['orphan continuation', frame('', 0x0), 1002],
  ['overlapping fragment', Buffer.concat([frame('a', 0x1, false), frame('b', 0x2)]), 1002],
  ['nonminimal 16-bit length', Buffer.from([0x81, 0xfe, 0, 1]), 1002],
  ['nonminimal 64-bit length', Buffer.from([0x81, 0xff, 0, 0, 0, 0, 0, 0, 0xff, 0xff]), 1002],
  ['64-bit high bit', Buffer.from([0x81, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0]), 1002],
  ['frame over limit header', Buffer.from([0x81, 0xff, 0, 0, 0, 0, 0, 4, 0, 1]), 1009],
  ['one-byte close', frame(Buffer.from([0]), 0x8), 1002],
  ['reserved close code', frame(Buffer.from([0x03, 0xed]), 0x8), 1002],
  ['invalid close reason', frame(Buffer.from([0x03, 0xe8, 0xff]), 0x8), 1007],
  ['invalid text', frame(Buffer.from([0xff])), 1007],
  ['incomplete fragmented text', Buffer.concat([frame(Buffer.from([0xe4]), 0x1, false), frame('', 0x0)]), 1007],
];
for (const [name, input, code] of invalidFrames) {
  test(`rejects ${name} and reaps the closing socket`, (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { hub, socket, context } = openTestSocket(t);
    socket.emit('data', input);
    const close = socket.writes.at(-1);
    assert.ok(Buffer.isBuffer(close), 'must respond with a close frame');
    assert.equal(close[0], 0x88);
    assert.equal(close.readUInt16BE(2), code);
    assert.equal(socket.ended, true);
    assert.equal(context.state.sockets.size, 0);
    assert.equal(socket._wsBuffer, null);
    const writes = socket.writes.length;
    hub.broadcast({ type: 'late' });
    socket.emit('data', frame('late'));
    assert.equal(socket.writes.length, writes);
    t.mock.timers.tick(100);
    assert.equal(socket.destroyed, true);
  });
}

test('accepts split UTF-8 fragments, interleaved 125-byte ping and arbitrary binary data', (t) => {
  const { socket, context } = openTestSocket(t);
  const text = Buffer.from('中');
  const ping = Buffer.alloc(125, 0x61);
  const input = Buffer.concat([
    frame(text.subarray(0, 1), 0x1, false),
    frame(ping, 0x9),
    frame(text.subarray(1), 0x0),
    frame(Buffer.from([0xff]), 0x2),
    frame(Buffer.alloc(126), 0x2),
    frame(Buffer.alloc(65536), 0x2),
  ]);
  for (let index = 0; index < input.length; index += 37) {
    socket.emit('data', input.subarray(index, index + 37));
  }
  assert.equal(socket.writes.length, 1);
  assert.deepEqual(socket.writes[0], Buffer.concat([Buffer.from([0x8a, 125]), ping]));
  assert.equal(socket.ended, false);
  assert.equal(context.state.sockets.has(socket), true);
  assert.equal(socket._wsFragment, null);
});

test('valid close is echoed once and removed from broadcasts before peer FIN', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { socket, context } = openTestSocket(t);
  const closeBody = Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from('完成')]);
  socket.emit('data', frame(closeBody, 0x8));
  assert.deepEqual(socket.writes, [Buffer.concat([Buffer.from([0x88, closeBody.length]), closeBody])]);
  assert.equal(context.state.sockets.size, 0);
  t.mock.timers.tick(100);
  assert.equal(socket.destroyed, true);
});

test('fragmented WebSocket messages are capped across frames', () => {
  const socket = new FakeSocket();
  const context = {
    sessionToken: 'synthetic-token',
    state: { sockets: new Set() },
    getState: () => ({ ok: true }),
  };

  handleWebSocketUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        authorization: 'Bearer synthetic-token',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    },
    socket,
  );

  socket.emit('data', maskedFrame(Buffer.alloc(200 * 1024, 0x61), { opcode: 0x1, fin: false }));
  socket.emit('data', maskedFrame(Buffer.alloc(100 * 1024, 0x62), { opcode: 0x0, fin: true }));

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
    sessionToken: 'synthetic-token',
    state: { sockets: new Set() },
    getState: () => ({ ok: true }),
  };

  handleWebSocketUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        authorization: 'Bearer synthetic-token',
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
  assert.doesNotThrow(() => socket.emit('data', maskedFrame('late', { opcode: 0x1, fin: true })));
  assert.equal(socket._wsBuffer, null);
  assert.equal(context.state.sockets.has(socket), false);
  assert.equal(socket.writes.length, 0);
});

test('WebSocket hub starts heartbeat on upgrade and releases resources on stop', async () => {
  const hub = createWebSocketHub({ heartbeatIntervalMs: 5 });
  const socket = new FakeSocket();
  const context = {
    sessionToken: 'synthetic-token',
    getState: () => ({ ok: true }),
  };

  hub.handleUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        authorization: 'Bearer synthetic-token',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    },
    socket,
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  const heartbeatCount = socket.writes.filter((write) => Buffer.isBuffer(write) && (write[0] & 0x0f) === 0x9).length;
  assert.ok(heartbeatCount > 0, 'heartbeat should begin after a successful upgrade');

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
    sessionToken: 'synthetic-token',
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
        authorization: 'Bearer synthetic-token',
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
    sessionToken: 'synthetic-token',
    state: { sockets: new Set() },
    getState: () => ({ ok: true }),
  };
  const headers = {
    host: '127.0.0.1:3000',
    authorization: 'Bearer synthetic-token',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
  };

  hub.handleUpgrade(context, { url: '/ws?topic=danmaku', headers }, topicSocket);
  hub.handleUpgrade(context, { url: '/ws', headers }, ordinarySocket);
  topicSocket.writes = [];
  ordinarySocket.writes = [];

  hub.broadcast({ type: 'danmaku:message', item: { id: 'one' } }, { topic: 'danmaku' });
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
    sessionToken: 'synthetic-token',
    state: { sockets: new Set() },
    getState: () => ({ ok: true }),
  };

  hub.handleUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        authorization: 'Bearer synthetic-token',
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
    sessionToken: 'synthetic-token',
    state: { sockets: new Set() },
    getState: () => ({ runtime: 'first' }),
  };
  const secondContext = {
    sessionToken: 'synthetic-token',
    state: { sockets: new Set() },
    getState: () => ({ runtime: 'second' }),
  };
  const request = {
    url: '/ws',
    headers: {
      host: '127.0.0.1:3000',
      authorization: 'Bearer synthetic-token',
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
    sessionToken: 'synthetic-token',
    allowedOrigins: ['http://127.0.0.1:3000'],
    getState: () => ({ ok: true }),
  };

  handleWebSocketUpgrade(
    context,
    {
      url: '/ws',
      headers: {
        host: '127.0.0.1:3000',
        authorization: 'Bearer synthetic-token',
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
    sessionToken: 'synthetic-token',
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
        authorization: 'Bearer synthetic-token',
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
    sessionToken: 'synthetic-token',
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
        authorization: 'Bearer synthetic-token',
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
