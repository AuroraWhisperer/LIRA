// 编写人：Aurora
// 用户点歌冷却持久化。原先只有内存 Map，重启后冷却全部清零，观众可借重启绕过。
// 内存仍是读路径（弹幕高频命中），DB 只做落盘与重启恢复。
'use strict';

const { now, cleanText } = require('../shared/utils');

// 超过这个时长的冷却记录没有意义，启动时不加载、定期清理掉
const COOLDOWN_RETENTION_MS = 24 * 60 * 60 * 1000;

function createCooldownStore(db) {
  return {
    /** 启动时把未过期的冷却记录读回内存 Map */
    loadInto(map) {
      const threshold = Date.now() - COOLDOWN_RETENTION_MS;
      const rows = db.prepare(`
        SELECT user_key, last_request_at
        FROM user_cooldowns
        WHERE last_request_at >= ?
      `).all(threshold);
      for (const row of rows) {
        map.set(row.user_key, Number(row.last_request_at) || 0);
      }
      return rows.length;
    },

    touch(userKey, { uid = '', userName = '', at = Date.now() } = {}) {
      const key = cleanText(userKey);
      if (!key) return;
      db.prepare(`
        INSERT INTO user_cooldowns (user_key, uid, user_name, last_request_at, request_count, updated_at)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(user_key) DO UPDATE SET
          uid = CASE WHEN excluded.uid != '' THEN excluded.uid ELSE user_cooldowns.uid END,
          user_name = CASE WHEN excluded.user_name != '' THEN excluded.user_name ELSE user_cooldowns.user_name END,
          last_request_at = excluded.last_request_at,
          request_count = user_cooldowns.request_count + 1,
          updated_at = excluded.updated_at
      `).run(key, cleanText(uid), cleanText(userName), Number(at) || Date.now(), now());
    },

    prune(retentionMs = COOLDOWN_RETENTION_MS) {
      const threshold = Date.now() - Math.max(0, Number(retentionMs) || 0);
      const result = db.prepare('DELETE FROM user_cooldowns WHERE last_request_at < ?').run(threshold);
      return Number(result.changes) || 0;
    },

    clear() {
      const result = db.prepare('DELETE FROM user_cooldowns').run();
      return Number(result.changes) || 0;
    }
  };
}

module.exports = { createCooldownStore, COOLDOWN_RETENTION_MS };
