'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');
const { parseBilibiliPackets, splitJsonObjects } = require('../../src/bilibili/parsers/packet-decoder');

test('malformed packet stops parsing and discards later packets in the same buffer', () => {
  const malformed = Buffer.alloc(16);
  malformed.writeUInt32BE(8, 0);
  const valid = createPacket(JSON.stringify({ cmd: 'VALID' }));

  const discards = [];
  assert.deepEqual(parseBilibiliPackets(Buffer.concat([malformed, valid]), { onDiscard: (reason) => discards.push(reason) }), []);
  assert.deepEqual(discards, ['invalid-packet-length']);
});

test('compressed packets cannot expand an oversized JSON body on the main process', () => {
  const message = createPacket(JSON.stringify({ cmd: 'DANMU_MSG', text: 'x'.repeat(9 * 1024 * 1024) }));
  for (const [version, compress] of [
    [2, zlib.deflateSync],
    [3, zlib.brotliCompressSync],
  ]) {
    const packet = createPacket(compress(message), version);
    assert.ok(packet.length < 16 * 1024);
    const discards = [];
    assert.deepEqual(parseBilibiliPackets(packet, { onDiscard: (reason) => discards.push(reason) }), []);
    assert.deepEqual(discards, ['decompressed-size-limit']);
  }
});

test('deeply nested compressed packets are rejected while normal mixed packets still decode', () => {
  const first = { cmd: 'DANMU_MSG', info: ['safe'] };
  const second = { cmd: 'SEND_GIFT' };
  let nested = createPacket(JSON.stringify(first));
  for (let index = 0; index < 32; index += 1) nested = createPacket(zlib.deflateSync(nested), 2);
  const discards = [];
  assert.deepEqual(parseBilibiliPackets(nested, { onDiscard: (reason) => discards.push(reason) }), []);
  assert.deepEqual(discards, ['compression-depth-limit']);
  const normal = Buffer.concat([
    createPacket(zlib.deflateSync(createPacket(JSON.stringify(first))), 2),
    createPacket(zlib.brotliCompressSync(createPacket(JSON.stringify(second))), 3),
  ]);
  assert.deepEqual(parseBilibiliPackets(normal), [first, second]);
});

test('a frame with excessive tiny messages has a bounded result', () => {
  const packet = createPacket(JSON.stringify({ cmd: 'TINY' }));
  const frame = Buffer.concat(Array(12000).fill(packet));
  const discards = [];
  assert.equal(parseBilibiliPackets(frame, { onDiscard: (reason) => discards.push(reason) }).length, 10000);
  assert.deepEqual(discards, ['message-limit']);
});

test('a single JSON body has a bounded splitting result before message objects are allocated', () => {
  const discards = [];
  assert.equal(splitJsonObjects('{} '.repeat(12000), 10000, (reason) => discards.push(reason)).length, 10000);
  assert.deepEqual(discards, ['message-limit']);
});

test('diagnostics report malformed JSON and truncated headers without treating heartbeat as loss', () => {
  for (const [buffer, expected] of [
    [createPacket('{"cmd":}'), ['invalid-json']],
    [createPacket('{"cmd":"truncated"'), ['invalid-json']],
    [Buffer.alloc(3), ['incomplete-header']],
    [Buffer.alloc(8 * 1024 * 1024 + 1), ['frame-size-limit']],
  ]) {
    const discards = [];
    assert.deepEqual(parseBilibiliPackets(buffer, { onDiscard: (reason) => discards.push(reason) }), []);
    assert.deepEqual(discards, expected);
  }
  const heartbeat = createPacket(Buffer.alloc(4));
  heartbeat.writeUInt32BE(3, 8);
  const discards = [];
  assert.deepEqual(parseBilibiliPackets(heartbeat, { onDiscard: (reason) => discards.push(reason) }), []);
  assert.deepEqual(discards, []);
});

test('a decompression limit failure stops work on the rest of a hostile frame', (t) => {
  const compressed = createPacket(zlib.deflateSync(Buffer.alloc(9 * 1024 * 1024)), 2);
  const inflate = t.mock.method(zlib, 'inflateSync');
  assert.equal(parseBilibiliPackets(Buffer.concat(Array(5).fill(compressed))).length, 0);
  assert.equal(inflate.mock.callCount(), 1);
});

test('a nested decompression limit failure stops later outer packets too', (t) => {
  const bomb = createPacket(zlib.deflateSync(Buffer.alloc(9 * 1024 * 1024)), 2);
  const outer = createPacket(zlib.deflateSync(bomb), 2);
  const inflate = t.mock.method(zlib, 'inflateSync');
  assert.equal(parseBilibiliPackets(Buffer.concat(Array(5).fill(outer))).length, 0);
  assert.equal(inflate.mock.callCount(), 2);
});

function createPacket(bodyText, version = 0) {
  const body = Buffer.from(bodyText);
  const packet = Buffer.alloc(16 + body.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt16BE(16, 4);
  packet.writeUInt16BE(version, 6);
  packet.writeUInt32BE(5, 8);
  packet.writeUInt32BE(1, 12);
  body.copy(packet, 16);
  return packet;
}
