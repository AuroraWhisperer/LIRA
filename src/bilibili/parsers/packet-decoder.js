'use strict';

const zlib = require('node:zlib');

// ---------------------------------------------------------------------------
// Binary packet decoding utilities
// ---------------------------------------------------------------------------

function splitJsonObjects(text) {
  if (!text) return [];
  const chunks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        chunks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return chunks;
}

function parseBilibiliPackets(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 16 <= buffer.length) {
    const packetLength = buffer.readUInt32BE(offset);
    const headerLength = buffer.readUInt16BE(offset + 4);
    const protocolVersion = buffer.readUInt16BE(offset + 6);
    const operation = buffer.readUInt32BE(offset + 8);
    const bodyStart = offset + headerLength;
    const bodyEnd = offset + packetLength;
    const body = buffer.subarray(bodyStart, bodyEnd);

    if (operation === 5) {
      if (protocolVersion === 3) {
        try {
          messages.push(...parseBilibiliPackets(zlib.brotliDecompressSync(body)));
        } catch (error) {
          console.warn(`Bilibili brotli decode failed: ${error.message}`);
        }
      } else if (protocolVersion === 2) {
        try {
          messages.push(...parseBilibiliPackets(zlib.inflateSync(body)));
        } catch (error) {
          console.warn(`Bilibili zlib decode failed: ${error.message}`);
        }
      } else {
        const text = body.toString('utf8').trim();
        for (const chunk of splitJsonObjects(text)) {
          try {
            messages.push(JSON.parse(chunk));
          } catch (_) {
            // Ignore non-message packets.
          }
        }
      }
    }

    offset += packetLength > 0 ? packetLength : buffer.length;
  }
  return messages;
}

module.exports = {
  splitJsonObjects,
  parseBilibiliPackets
};
