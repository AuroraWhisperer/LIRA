'use strict';

const { cleanText } = require('../shared/utils');

function normalizeRoomInput(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^\d+$/.test(text)) return text;

  const decoded = decodeURIComponent(text);
  const explicitPatterns = [/live\.bilibili\.com\/(?:blanc\/)?(\d+)/i, /[?&](?:room_id|id)=(\d+)/i];
  for (const pattern of explicitPatterns) {
    const match = decoded.match(pattern);
    if (match) return match[1];
  }

  const looseDigits = decoded.match(/\d{3,}/);
  return looseDigits ? looseDigits[0] : '';
}

module.exports = { normalizeRoomInput };
