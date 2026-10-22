'use strict';

function createAiStateStore(db) {
  function readConfiguration() {
    return db.prepare('SELECT key, value, is_secret FROM ai_configuration').all().map(row => ({
      key: row.key,
      value: row.value,
      isSecret: Boolean(row.is_secret),
    }));
  }

  function updateConfiguration(entries, updatedAt, validateConfiguration) {
    const write = db.prepare(`
      INSERT INTO ai_configuration (key, value, is_secret, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        is_secret = excluded.is_secret,
        updated_at = excluded.updated_at
    `);
    db.exec('BEGIN');
    try {
      for (const entry of entries) {
        write.run(entry.key, entry.value, entry.isSecret ? 1 : 0, updatedAt);
      }
      // Validate the persisted candidate before committing configuration and metadata together.
      validateConfiguration(readConfiguration());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function appendRequestLog(entry) {
    db.prepare(`
      INSERT INTO ai_request_logs (
        uid, user_name, category, status, latency_ms,
        input_tokens, output_tokens, tool_calls, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.uid,
      entry.userName,
      entry.category,
      entry.status,
      entry.latencyMs,
      entry.inputTokens,
      entry.outputTokens,
      entry.toolCalls,
      entry.errorCode,
      entry.createdAt,
    );
  }

  function isBlacklisted(uid) {
    return Boolean(db.prepare('SELECT 1 FROM ai_blacklist WHERE uid = ?').get(uid));
  }

  function upsertBlacklistEntry(entry) {
    db.prepare(`
      INSERT INTO ai_blacklist (uid, user_name, reason, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET user_name = excluded.user_name, reason = excluded.reason
    `).run(entry.uid, entry.userName, entry.reason, entry.createdAt);
  }

  function deleteBlacklistEntry(uid) {
    db.prepare('DELETE FROM ai_blacklist WHERE uid = ?').run(uid);
  }

  function readContext(uid) {
    return toExpiringRecord(db.prepare('SELECT payload, expires_at FROM ai_viewer_context WHERE uid = ?').get(uid));
  }

  function writeContext(uid, payload, expiresAt) {
    db.prepare(`
      INSERT INTO ai_viewer_context (uid, payload, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at
    `).run(uid, payload, expiresAt);
  }

  function deleteContext(uid) {
    db.prepare('DELETE FROM ai_viewer_context WHERE uid = ?').run(uid);
  }

  function readCache(key) {
    return toExpiringRecord(db.prepare('SELECT payload, expires_at FROM ai_query_cache WHERE cache_key = ?').get(key));
  }

  function writeCache(key, payload, expiresAt) {
    db.prepare(`
      INSERT INTO ai_query_cache (cache_key, payload, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at
    `).run(key, payload, expiresAt);
  }

  function deleteCache(key) {
    db.prepare('DELETE FROM ai_query_cache WHERE cache_key = ?').run(key);
  }

  function pruneExpired(timestamp) {
    db.prepare('DELETE FROM ai_viewer_context WHERE expires_at <= ?').run(timestamp);
    db.prepare('DELETE FROM ai_query_cache WHERE expires_at <= ?').run(timestamp);
  }

  return {
    readConfiguration,
    updateConfiguration,
    appendRequestLog,
    isBlacklisted,
    upsertBlacklistEntry,
    deleteBlacklistEntry,
    readContext,
    writeContext,
    deleteContext,
    readCache,
    writeCache,
    deleteCache,
    pruneExpired,
  };
}

function toExpiringRecord(row) {
  return row ? { payload: row.payload, expiresAt: Number(row.expires_at) } : null;
}

module.exports = { createAiStateStore };
