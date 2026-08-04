'use strict';

const crypto = require('node:crypto');
const {
  cleanText,
  readObjectValue
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

// 从礼物名称 / 角色名称中反向检测大航海等级
// 能处理 "舰长"、"提督"、"总督"、"Captain" 等变体
function detectGuardLevelFromName(name) {
  const text = cleanText(name).replace(/\s+/g, '').toLowerCase();
  // 中文精准匹配（避免 "舰长" 误匹配 "开通舰长" 等变体）
  if (text.includes('总督')) return 1;
  if (text.includes('提督')) return 2;
  if (text.includes('舰长')) return 3;
  // 英文回退
  if (text.includes('governor') || text.includes('viceroy')) return 1;
  if (text.includes('admiral') || text.includes('commodore')) return 2;
  if (text.includes('captain') || text.includes('commander')) return 3;
  // 数字回退：Bilibili 有时直接给 "3" 之类
  const numMatch = text.match(/^(\d)$/);
  if (numMatch) {
    const n = Number(numMatch[1]);
    if ([1, 2, 3].includes(n)) return n;
  }
  return 0;
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

module.exports = {
  normalizeBilibiliGiftCoin,
  normalizeBilibiliCoinRmb,
  guardLevelName,
  detectGuardLevelFromName,
  buildBilibiliFallbackGiftId
};
