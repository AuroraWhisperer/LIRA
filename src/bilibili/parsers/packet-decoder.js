'use strict';

const zlib = require('node:zlib');
const MAX_PACKET_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGES = 10000;
const MAX_COMPRESSION_DEPTH = 8;

// ---------------------------------------------------------------------------
// Binary packet decoding utilities
// ---------------------------------------------------------------------------

function splitJsonObjects(text, maxChunks = MAX_MESSAGES, onDiscard) {
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
        if (chunks.length >= maxChunks) {
          if (onDiscard && text.slice(i + 1).trim()) onDiscard('message-limit');
          return chunks;
        }
      }
    }
  }
  if (depth !== 0 || inString || (chunks.length === 0 && text.trim())) onDiscard?.('invalid-json');
  return chunks;
}

function parseBilibiliPackets(buffer, { onDiscard } = {}) {
  const messages = [];
  if (buffer.length > MAX_PACKET_BYTES) {
    onDiscard?.('frame-size-limit');
    return messages;
  }
  decodePackets(buffer, messages, { remainingBytes: MAX_PACKET_BYTES }, 0, onDiscard);
  return messages;
}

function decodePackets(buffer, messages, budget, depth, onDiscard) {
  let offset = 0;
  while (offset + 16 <= buffer.length && messages.length < MAX_MESSAGES) {
    const packetLength = buffer.readUInt32BE(offset);
    const headerLength = buffer.readUInt16BE(offset + 4);
    // 畸形包防护：长度不合法时中止解析，避免 subarray 越界抛 RangeError 中断整个 buffer。
    if (
      packetLength < 16 ||
      headerLength < 16 ||
      headerLength > packetLength ||
      offset + packetLength > buffer.length
    ) {
      onDiscard?.('invalid-packet-length');
      return true;
    }
    const protocolVersion = buffer.readUInt16BE(offset + 6);
    const operation = buffer.readUInt32BE(offset + 8);
    const bodyStart = offset + headerLength;
    const bodyEnd = offset + packetLength;
    const body = buffer.subarray(bodyStart, bodyEnd);

    if (operation === 5) {
      if (protocolVersion === 2 || protocolVersion === 3) {
        if (depth >= MAX_COMPRESSION_DEPTH || budget.remainingBytes <= 0) {
          onDiscard?.(depth >= MAX_COMPRESSION_DEPTH ? 'compression-depth-limit' : 'decompressed-size-limit');
          return false;
        }
        try {
          const decompress = protocolVersion === 3 ? zlib.brotliDecompressSync : zlib.inflateSync;
          const decoded = decompress(body, { maxOutputLength: budget.remainingBytes });
          budget.remainingBytes -= decoded.length;
          if (!decodePackets(decoded, messages, budget, depth + 1, onDiscard)) return false;
        } catch (error) {
          onDiscard?.(error.code === 'ERR_BUFFER_TOO_LARGE' ? 'decompressed-size-limit' : 'decompression-error');
          console.warn(`Bilibili compressed packet decode failed: ${error.message}`);
          return false;
        }
      } else {
        const text = body.toString('utf8').trim();
        for (const chunk of splitJsonObjects(text, MAX_MESSAGES - messages.length, onDiscard)) {
          if (messages.length >= MAX_MESSAGES) return false;
          try {
            messages.push(JSON.parse(chunk));
          } catch (_) {
            onDiscard?.('invalid-json');
          }
        }
      }
    }

    offset += packetLength;
  }
  if (offset < buffer.length) onDiscard?.(messages.length >= MAX_MESSAGES ? 'message-limit' : 'incomplete-header');
  return true;
}

module.exports = {
  splitJsonObjects,
  parseBilibiliPackets,
};
