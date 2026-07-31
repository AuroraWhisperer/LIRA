'use strict';

const crypto = require('node:crypto');
const {
  cleanText,
  readObjectValue,
  safeJsonStringify
} = require('../../shared/utils');

// ---------------------------------------------------------------------------
// Gift-related normalization utilities
// ---------------------------------------------------------------------------

function normalizeBilibiliGiftCoin(value) {
  if (typeof value === 'string') {
    const match = value.match(/[\d.]+/);
    return match ? Number(match[0]) : 0;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeBilibiliCoinRmb(value) {
  const amount = normalizeBilibiliGiftCoin(value);
  return amount > 0 ? (amount / 1000) : 0;
}

function guardLevelName(level) {
  if (Number(level) === 3) return '舰长';
  if (Number(level) === 2) return '提督';
  if (Number(level) === 1) return '总督';
  return '';
}

function buildBilibiliFallbackGiftId(packet, data) {
  return crypto.createHash('sha1')
    .update([
      cleanText(packet && packet.cmd),
      cleanText(readObjectValue(data, ['uid', 'mid', 'username', 'uname'])),
      cleanText(readObjectValue(data, ['gift_name', 'giftName', 'role_name', 'roleName'])),
      cleanText(readObjectValue(data, ['price', 'gift_price', 'giftPrice', 'total_price', 'totalPrice'])),
      cleanText(readObjectValue(data, ['timestamp', 'ts', 'time', 'start_time', 'startTime'])) || Math.floor(Date.now() / 1000)
    ].join('|'))
    .digest('hex');
}

function logUnparsedGiftLikeCommand(message, reason) {
  const cmd = cleanText(message && message.cmd);
  const data = message && message.data && typeof message.data === 'object' ? message.data : {};
  const keys = Object.keys(data).slice(0, 30).join(',');
  const preview = safeJsonStringify(data).slice(0, 260);
  console.warn(`[Bilibili] unparsed gift-like command: reason=${reason} cmd=${cmd} dataKeys=${keys} data=${preview}`);
}

module.exports = {
  normalizeBilibiliGiftCoin,
  normalizeBilibiliCoinRmb,
  guardLevelName,
  buildBilibiliFallbackGiftId,
  logUnparsedGiftLikeCommand
};
