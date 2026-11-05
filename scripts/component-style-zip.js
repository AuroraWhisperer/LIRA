'use strict';

const { crc32, deflateRawSync } = require('node:zlib');

// Stored ZIP for already compressed artwork: UTF-8 names and a fixed DOS date.
function createStoredStyleZip(entries) {
  return createZip(entries, false);
}

function createDeflatedZip(entries) {
  return createZip(entries, true);
}

function createZip(entries, compress) {
  const local = []; const central = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const packed = compress ? deflateRawSync(bytes, { level: 9 }) : bytes;
    const filename = Buffer.from(name);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt16LE(compress ? 8 : 0, 8);
    header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 30); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, packed); central.push(directory, filename); offset += header.length + filename.length + packed.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

module.exports = { createStoredStyleZip, createDeflatedZip };
