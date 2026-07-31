// 编写人：Aurora
// 原始弹幕消息缓冲区 —— 用于调试礼物解析问题。
// 环形缓冲，记录最近 N 条消息的原始 CMD + 数据 + 解析结果。
'use strict';

const { cleanText, now, safeJsonStringify, safeParseJson } = require('../../shared/utils');

const DEFAULT_MAX_ENTRIES = 300;
const MAX_DATA_LENGTH = 2000; // 每条消息 data 字段最大字符数

function createMessageBuffer(maxEntries = DEFAULT_MAX_ENTRIES) {
  const buffer = [];
  let cursor = 0;

  /**
   * @typedef {'parsed-ok'|'parse-failed'|'unrecognized-cmd'|'raw-packet'} EntryCategory
   *
   * @param {Object} opts
   * @param {string} opts.cmd
   * @param {EntryCategory} opts.category
   * @param {*} opts.rawData - 原始消息 data
   * @param {Object} [opts.parsed] - 解析后的礼物对象（如果成功）
   * @param {string} [opts.detail] - 额外的诊断信息
   */
  function record(opts) {
    const entry = {
      index: cursor++,
      timestamp: now(),
      cmd: cleanText(opts && opts.cmd),
      category: opts && opts.category || 'raw-packet',
      rawData: truncateData(opts && opts.rawData),
      parsed: opts && opts.parsed ? summarizeParsed(opts.parsed) : null,
      detail: cleanText(opts && opts.detail)
    };

    if (buffer.length >= maxEntries) {
      buffer.shift();
    }
    buffer.push(entry);
  }

  function getAll() {
    return buffer.slice();
  }

  function getStats() {
    const entries = buffer;
    const total = entries.length;
    const parsedOk = entries.filter(e => e.category === 'parsed-ok').length;
    const parseFailed = entries.filter(e => e.category === 'parse-failed').length;
    const unrecognized = entries.filter(e => e.category === 'unrecognized-cmd').length;
    const rawPacket = entries.filter(e => e.category === 'raw-packet').length;

    // 按 CMD 分组统计
    const byCmd = {};
    for (const entry of entries) {
      const cmd = entry.cmd || '(unknown)';
      if (!byCmd[cmd]) {
        byCmd[cmd] = { total: 0, parsedOk: 0, parseFailed: 0, unrecognized: 0 };
      }
      byCmd[cmd].total += 1;
      if (entry.category === 'parsed-ok') byCmd[cmd].parsedOk += 1;
      if (entry.category === 'parse-failed') byCmd[cmd].parseFailed += 1;
      if (entry.category === 'unrecognized-cmd') byCmd[cmd].unrecognized += 1;
    }

    return {
      total,
      parsedOk,
      parseFailed,
      unrecognized,
      rawPacket,
      byCmd,
      maxEntries,
      oldestTimestamp: entries.length > 0 ? entries[0].timestamp : null,
      newestTimestamp: entries.length > 0 ? entries[entries.length - 1].timestamp : null
    };
  }

  function clear() {
    buffer.length = 0;
    cursor = 0;
  }

  return { record, getAll, getStats, clear };
}

function truncateData(data) {
  try {
    const text = typeof data === 'string' ? data : safeJsonStringify(data);
    if (text.length <= MAX_DATA_LENGTH) return text;
    return text.slice(0, MAX_DATA_LENGTH) + `...[truncated, total ${text.length} chars]`;
  } catch (_) {
    return `[unserializable: ${typeof data}]`;
  }
}

function summarizeParsed(parsed) {
  if (!parsed) return null;
  return {
    giftId: parsed.giftId || '',
    giftName: parsed.giftName || '',
    userName: parsed.userName || '',
    uid: parsed.uid || '',
    num: parsed.num || 1,
    totalPrice: parsed.totalPrice || 0,
    coinType: parsed.coinType || '',
    isBlindBox: parsed.isBlindBox || false,
    cmd: parsed.cmd || '',
    platformId: (parsed.platformId || '').slice(0, 20)
  };
}

module.exports = { createMessageBuffer };
