'use strict';

// ---------------------------------------------------------------------------
// Protocol Buffer decoding utilities
// ---------------------------------------------------------------------------

function firstProtoScalar(values) {
  if (!Array.isArray(values)) return '';
  const value = values.find((item) => item !== null && item !== undefined && typeof item !== 'object');
  return value === undefined ? '' : value;
}

function firstProtoObject(values) {
  if (!Array.isArray(values)) return null;
  return values.find((item) => item && typeof item === 'object' && !Buffer.isBuffer(item)) || null;
}

function readBilibiliProtoVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  let index = offset;

  while (index < buffer.length && shift <= 63n) {
    const byte = BigInt(buffer[index]);
    index += 1;
    value |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) {
      return { value, offset: index };
    }
    shift += 7n;
  }

  return null;
}

function decodeBilibiliProtoFields(buffer, depth = 0) {
  let offset = 0;
  const fields = {};

  while (offset < buffer.length) {
    const keyResult = readBilibiliProtoVarint(buffer, offset);
    if (!keyResult) return null;
    offset = keyResult.offset;

    const key = Number(keyResult.value);
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (!field || ![0, 1, 2, 5].includes(wireType)) return null;

    let value;
    if (wireType === 0) {
      const result = readBilibiliProtoVarint(buffer, offset);
      if (!result) return null;
      value = result.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result.value) : result.value.toString();
      offset = result.offset;
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) return null;
      value = buffer.subarray(offset, offset + 8);
      offset += 8;
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) return null;
      value = buffer.subarray(offset, offset + 4);
      offset += 4;
    } else {
      const lengthResult = readBilibiliProtoVarint(buffer, offset);
      if (!lengthResult) return null;
      const length = Number(lengthResult.value);
      offset = lengthResult.offset;
      if (!Number.isFinite(length) || length < 0 || offset + length > buffer.length) return null;

      const chunk = buffer.subarray(offset, offset + length);
      offset += length;
      const nested = depth < 5 ? decodeBilibiliProtoFields(chunk, depth + 1) : null;
      value = nested && Object.keys(nested).length > 0 ? nested : chunk.toString('utf8');
    }

    if (!fields[field]) fields[field] = [];
    fields[field].push(value);
  }

  return fields;
}

function decodeBilibiliGiftV2Proto(value) {
  const { cleanText } = require('../../shared/utils');
  try {
    const buffer = Buffer.from(cleanText(value), 'base64');
    if (buffer.length === 0) return null;
    return decodeBilibiliProtoFields(buffer, 0);
  } catch (_) {
    return null;
  }
}

module.exports = {
  firstProtoScalar,
  firstProtoObject,
  readBilibiliProtoVarint,
  decodeBilibiliProtoFields,
  decodeBilibiliGiftV2Proto
};
