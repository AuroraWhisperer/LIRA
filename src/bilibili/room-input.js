'use strict';

const { cleanText } = require('../shared/utils');

function normalizeRoomInput(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^\d+$/.test(text)) return text;

  let decoded;
  try {
    decoded = decodeURIComponent(text);
  } catch (error) {
    throw Object.assign(new Error('直播间地址包含无效的百分号编码。', { cause: error }), {
      code: 'INVALID_ROOM_INPUT', statusCode: 400,
    });
  }
  const explicitPatterns = [/live\.bilibili\.com\/(?:blanc\/)?(\d+)/i, /[?&](?:room_id|id)=(\d+)/i];
  for (const pattern of explicitPatterns) {
    const match = decoded.match(pattern);
    if (match) return match[1];
  }

  const looseDigits = decoded.match(/\d{3,}/);
  return looseDigits ? looseDigits[0] : '';
}

module.exports = { normalizeRoomInput };
