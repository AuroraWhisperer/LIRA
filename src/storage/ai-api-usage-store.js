'use strict';

function createAiApiUsageStore(db) {
  const consumeStatement = db.prepare(`
    INSERT INTO ai_api_usage (category, month_key, request_count, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(category, month_key) DO UPDATE SET
      request_count = request_count + 1,
      updated_at = excluded.updated_at
    WHERE request_count < ?
    RETURNING request_count
  `);
  const readStatement = db.prepare(`
    SELECT request_count FROM ai_api_usage WHERE category = ? AND month_key = ?
  `);
  const releaseStatement = db.prepare(`
    UPDATE ai_api_usage
    SET request_count = request_count - 1, updated_at = ?
    WHERE category = ? AND month_key = ? AND request_count > 0
  `);
  const pruneStatement = db.prepare('DELETE FROM ai_api_usage WHERE month_key < ?');

  return {
    consume(category, monthKey, timestamp, limit) {
      const row = consumeStatement.get(category, monthKey, timestamp, limit);
      return row ? Number(row.request_count) : null;
    },
    read(category, monthKey) {
      return Number(readStatement.get(category, monthKey)?.request_count) || 0;
    },
    release(category, monthKey, timestamp) {
      releaseStatement.run(timestamp, category, monthKey);
    },
    pruneBefore(monthKey) {
      return Number(pruneStatement.run(monthKey).changes) || 0;
    },
  };
}

module.exports = { createAiApiUsageStore };
