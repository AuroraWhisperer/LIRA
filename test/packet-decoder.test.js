'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseBilibiliPackets,
} = require('../src/bilibili/parsers/packet-decoder');

test('malformed packet stops parsing and discards later packets in the same buffer', () => {
  const malformed = Buffer.alloc(16);
  malformed.writeUInt32BE(8, 0);
  const valid = createPacket(JSON.stringify({ cmd: 'VALID' }));

  assert.deepEqual(parseBilibiliPackets(Buffer.concat([malformed, valid])), []);
});

function createPacket(bodyText) {
  const body = Buffer.from(bodyText);
  const packet = Buffer.alloc(16 + body.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt16BE(16, 4);
  packet.writeUInt16BE(0, 6);
  packet.writeUInt32BE(5, 8);
  packet.writeUInt32BE(1, 12);
  body.copy(packet, 16);
  return packet;
}
