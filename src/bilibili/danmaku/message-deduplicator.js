// 编写人：Aurora
// 消息去重器 — 防止重复处理相同的命令消息。
'use strict';

const bilibiliHelpers = require('../helpers');

class MessageDeduplicator {
  constructor() {
    this.seenCommandKeys = new Map();
  }

  remember(uid, message, timestampMs) {
    const key = bilibiliHelpers.buildBilibiliCommandKey(uid, message, timestampMs);
    if (!key) return false;
    if (this.seenCommandKeys.has(key)) return false;

    const receivedAt = Date.now();
    this.seenCommandKeys.set(key, receivedAt);
    if (this.seenCommandKeys.size > 1000) {
      const cutoff = receivedAt - 30 * 60 * 1000;
      for (const [seenKey, seenAt] of this.seenCommandKeys) {
        if (seenAt < cutoff || this.seenCommandKeys.size > 500) {
          this.seenCommandKeys.delete(seenKey);
        }
      }
    }
    return true;
  }

  has(uid, message, timestampMs) {
    const key = bilibiliHelpers.buildBilibiliCommandKey(uid, message, timestampMs);
    return key && this.seenCommandKeys.has(key);
  }
}

module.exports = { MessageDeduplicator };
