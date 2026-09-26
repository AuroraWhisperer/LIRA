'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');
const { parseBilibiliPackets, splitJsonObjects } = require('../src/bilibili/parsers/packet-decoder');

test('malformed packet stops parsing and discards later packets in the same buffer', () => {
  const malformed = Buffer.alloc(16);
  malformed.writeUInt32BE(8, 0);
  const valid = createPacket(JSON.stringify({ cmd: 'VALID' }));

  assert.deepEqual(parseBilibiliPackets(Buffer.concat([malformed, valid])), []);
});

test('compressed packets cannot expand an oversized JSON body on the main process', () => {
  const message = createPacket(JSON.stringify({ cmd: 'DANMU_MSG', text: 'x'.repeat(9 * 1024 * 1024) }));
  for (const [version, compress] of [[2, zlib.deflateSync], [3, zlib.brotliCompressSync]]) {
    const packet = createPacket(compress(message), version);
    assert.ok(packet.length < 16 * 1024);
    assert.deepEqual(parseBilibiliPackets(packet), []);
  }
});

test('deeply nested compressed packets are rejected while normal mixed packets still decode', () => {
  const first = { cmd: 'DANMU_MSG', info: ['safe'] };
  const second = { cmd: 'SEND_GIFT' };
  let nested = createPacket(JSON.stringify(first));
  for (let index = 0; index < 32; index += 1) nested = createPacket(zlib.deflateSync(nested), 2);
  assert.deepEqual(parseBilibiliPackets(nested), []);
  const normal = Buffer.concat([
    createPacket(zlib.deflateSync(createPacket(JSON.stringify(first))), 2),
    createPacket(zlib.brotliCompressSync(createPacket(JSON.stringify(second))), 3),
  ]);
  assert.deepEqual(parseBilibiliPackets(normal), [first, second]);
});

test('a frame with excessive tiny messages has a bounded result', () => {
  const packet = createPacket(JSON.stringify({ cmd: 'TINY' }));
  const frame = Buffer.concat(Array(12000).fill(packet));
  assert.equal(parseBilibiliPackets(frame).length, 10000);
});

test('a single JSON body has a bounded splitting result before message objects are allocated', () => {
  assert.equal(splitJsonObjects('{} '.repeat(12000)).length, 10000);
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
