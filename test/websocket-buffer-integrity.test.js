'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createWebSocketHub } = require('../src/server/ws');

function frame(body, opcode = 9, fin = true) {
  const payload = Buffer.from(body);
  assert.ok(payload.length < 126);
  const result = Buffer.alloc(6 + payload.length);
  result[0] = (fin ? 0x80 : 0) | opcode;
  result[1] = 0x80 | payload.length;
  result.set([0x12, 0x34, 0x56, 0x78], 2);
  for (let index = 0; index < payload.length; index += 1) result[6 + index] = payload[index] ^ result[2 + index % 4];
  return result;
}

function fixture(t) {
  const hub = createWebSocketHub();
  const context = { sessionToken: 'synthetic-integrity-token', state: { sockets: new Set() }, getState: () => ({}) };
  const socket = Object.assign(new EventEmitter(), {
    writes: [],
    writableLength: 0,
    destroyed: false,
    write(bytes) { this.writes.push(bytes); return true; },
    end() { this.destroy(); },
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('close');
    },
  });
  hub.handleUpgrade(context, {
    url: '/ws',
    headers: { authorization: 'Bearer synthetic-integrity-token', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
  }, socket);
  t.after(() => hub.stop());
  return { hub, context, socket };
}

test('WebSocket buffer compaction preserves overlapping leftovers and already-written payloads', (t) => {
  const { hub, context, socket } = fixture(t);
  const payloads = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)];
  const input = Buffer.concat(payloads.map((payload) => frame(payload)));
  const original = Buffer.from(input);
  for (const [start, end] of [[0, 1], [1, 196], [196, 215], [215, input.length]]) {
    socket.emit('data', input.subarray(start, end));
  }
  const pongs = socket.writes.filter((entry) => Buffer.isBuffer(entry) && entry[0] === 0x8a);
  assert.deepEqual(pongs.map((entry) => entry.subarray(2).toString()), payloads);
  assert.deepEqual(input, original);
  assert.equal(socket.destroyed, false);
  assert.equal(socket._wsBuffer.length, 0);
  assert.equal(socket._wsBufferStorage, null);
  hub.stop();
  assert.equal(socket._wsBuffer, null);
  assert.equal(socket._wsBufferStorage, null);
  assert.equal(socket._wsFragment, null);
  assert.equal(socket.listenerCount('data'), 0);
  assert.equal(context.state.sockets.size, 0);
});

test('all small TCP chunk sizes preserve repeated UTF-8 fragments, control frames and binary state', (t) => {
  const text = Buffer.from('数据😀');
  const input = Buffer.concat([
    frame(text.subarray(0, 1), 1, false),
    frame('ping'),
    frame(text.subarray(1, 5), 0, false),
    frame(text.subarray(5), 0),
    frame(Uint8Array.of(0xff), 2, false),
    frame(Uint8Array.of(0xfe), 0),
  ]);
  for (let size = 1; size <= input.length; size += 1) {
    const { hub, socket } = fixture(t);
    for (let repeat = 0; repeat < 8; repeat += 1) {
      for (let offset = 0; offset < input.length; offset += size) socket.emit('data', input.subarray(offset, offset + size));
    }
    assert.equal(socket.destroyed, false, `chunk size ${size}`);
    assert.equal(socket._wsFragment, null);
    assert.equal(socket._wsFragmentBytes, 0);
    assert.equal(socket._wsBufferStorage, null);
    assert.equal(socket.writes.filter((entry) => Buffer.isBuffer(entry) && entry[0] === 0x8a).length, 8);
    hub.stop();
  }
});

for (const bytes of [[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe4]]) {
  test(`fragmented invalid UTF-8 ${bytes.join('-')} closes once and clears all retained data`, (t) => {
    const { socket, context } = fixture(t);
    socket.emit('data', frame(Uint8Array.of(bytes[0]), 1, false));
    for (const byte of bytes.slice(1)) socket.emit('data', frame(Uint8Array.of(byte), 0, false));
    socket.emit('data', frame('', 0));
    const closes = socket.writes.filter((entry) => Buffer.isBuffer(entry) && entry[0] === 0x88);
    assert.equal(closes.length, 1);
    assert.equal(closes[0].readUInt16BE(2), 1007);
    assert.equal(socket._wsBuffer, null);
    assert.equal(socket._wsBufferStorage, null);
    assert.equal(socket._wsFragment, null);
    assert.equal(socket._wsFragmentBytes, 0);
    assert.equal(socket.listenerCount('data'), 0);
    assert.equal(context.state.sockets.size, 0);
  });
}
