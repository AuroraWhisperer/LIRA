'use strict';

const crypto = require('node:crypto');
const { AI_CONFIG_DEFAULTS, AI_SECRET_KEYS, normalizeAiConfig } = require('./config');
const { SYSTEM_PROMPT } = require('./prompt');

const SECRET_SET = new Set(AI_SECRET_KEYS);

function createAiConfigStore(db, secretCodec, options = {}) {
  const now = options.now || Date.now;
  let cached = null;

  function getConfig() {
    if (cached) return { ...cached };
    const stored = {};
    const rows = db.prepare('SELECT key, value, is_secret FROM ai_configuration').all();
    for (const row of rows) {
      if (!(row.key in AI_CONFIG_DEFAULTS)) continue;
      try {
        const raw = row.is_secret ? secretCodec.decrypt(row.value) : row.value;
        stored[row.key] = parseStoredValue(row.key, raw);
      } catch (error) {
        console.warn(`[AI][Config] unable to read ${row.key}: ${redactError(error.message)}`);
        stored[row.key] = '';
      }
    }
    if (isLegacyBuiltInPrompt(stored.systemPrompt)) {
      stored.systemPrompt = SYSTEM_PROMPT;
      db.prepare(`
        UPDATE ai_configuration SET value = ?, is_secret = 0, updated_at = ?
        WHERE key = 'systemPrompt'
      `).run(SYSTEM_PROMPT, new Date(now()).toISOString());
    }
    cached = normalizeAiConfig(stored, AI_CONFIG_DEFAULTS);
    return { ...cached };
  }

  function getPublicConfig() {
    const config = getConfig();
    const result = { ...config };
    for (const key of AI_SECRET_KEYS) delete result[key];
    result.hasDeepSeekApiKey = Boolean(config.deepseekApiKey);
    result.hasQWeatherApiKey = Boolean(config.qweatherApiKey);
    result.hasAmapApiKey = Boolean(config.amapApiKey);
    result.secretEncryptionAvailable = Boolean(secretCodec?.isAvailable?.());
    return result;
  }

  function updateConfig(changes = {}) {
    const current = getConfig();
    const normalized = normalizeAiConfig(changes, current);
    const updatedAt = new Date(now()).toISOString();
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
      for (const key of Object.keys(changes)) {
        if (!(key in AI_CONFIG_DEFAULTS)) continue;
        const secret = SECRET_SET.has(key);
        const value = normalized[key];
        const storedValue = secret && value ? secretCodec.encrypt(value) : serializeValue(value);
        write.run(key, storedValue, secret ? 1 : 0, updatedAt);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    cached = null;
    return getPublicConfig();
  }

  function logRequest(entry = {}) {
    db.prepare(`
      INSERT INTO ai_request_logs (
        uid, user_name, category, status, latency_ms,
        input_tokens, output_tokens, tool_calls, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(entry.uid || ''), String(entry.userName || '').slice(0, 80),
      String(entry.category || '').slice(0, 40), String(entry.status || '').slice(0, 24),
      toNonNegativeInteger(entry.latencyMs), toNonNegativeInteger(entry.inputTokens),
      toNonNegativeInteger(entry.outputTokens), toNonNegativeInteger(entry.toolCalls),
      String(entry.errorCode || '').slice(0, 80), now()
    );
  }

  function isBlacklisted(uid) {
    if (!uid) return false;
    return Boolean(db.prepare('SELECT 1 FROM ai_blacklist WHERE uid = ?').get(String(uid)));
  }

  function setBlacklist(uid, blocked, details = {}) {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) throw new Error('UID 不能为空。');
    if (!blocked) {
      db.prepare('DELETE FROM ai_blacklist WHERE uid = ?').run(normalizedUid);
      return;
    }
    db.prepare(`
      INSERT INTO ai_blacklist (uid, user_name, reason, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET user_name = excluded.user_name, reason = excluded.reason
    `).run(normalizedUid, String(details.userName || '').slice(0, 80), String(details.reason || '').slice(0, 200), now());
  }

  function getContext(uid) {
    const row = db.prepare('SELECT payload, expires_at FROM ai_viewer_context WHERE uid = ?').get(String(uid || ''));
    if (!row || Number(row.expires_at) <= now()) {
      if (row) db.prepare('DELETE FROM ai_viewer_context WHERE uid = ?').run(String(uid || ''));
      return null;
    }
    return safeJsonParse(row.payload);
  }

  function setContext(uid, payload, ttlSeconds) {
    if (!uid || !payload) return;
    db.prepare(`
      INSERT INTO ai_viewer_context (uid, payload, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at
    `).run(String(uid), JSON.stringify(payload), now() + Math.max(1, Number(ttlSeconds) || 1) * 1000);
  }

  function getCache(key) {
    const cacheKey = hashCacheKey(key);
    const row = db.prepare('SELECT payload, expires_at FROM ai_query_cache WHERE cache_key = ?').get(cacheKey);
    if (!row || Number(row.expires_at) <= now()) {
      if (row) db.prepare('DELETE FROM ai_query_cache WHERE cache_key = ?').run(cacheKey);
      return null;
    }
    return safeJsonParse(row.payload);
  }

  function setCache(key, payload, ttlSeconds) {
    const ttl = Number(ttlSeconds) || 0;
    if (!key || !payload || ttl <= 0) return;
    db.prepare(`
      INSERT INTO ai_query_cache (cache_key, payload, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at
    `).run(hashCacheKey(key), JSON.stringify(payload), now() + ttl * 1000);
  }

  function pruneExpired() {
    db.prepare('DELETE FROM ai_viewer_context WHERE expires_at <= ?').run(now());
    db.prepare('DELETE FROM ai_query_cache WHERE expires_at <= ?').run(now());
  }

  return {
    getConfig, getPublicConfig, updateConfig, logRequest,
    isBlacklisted, setBlacklist, getContext, setContext, getCache, setCache, pruneExpired
  };
}

function parseStoredValue(key, value) {
  const defaultValue = AI_CONFIG_DEFAULTS[key];
  if (typeof defaultValue === 'boolean') return value === 'true';
  if (typeof defaultValue === 'number') return Number(value);
  return String(value ?? '');
}

function serializeValue(value) {
  return String(value ?? '');
}

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function hashCacheKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function toNonNegativeInteger(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function redactError(value) {
  return String(value || '').replace(/(?:sk-|key[=: ]+)[\w-]{8,}/gi, '[redacted]');
}

function isLegacyBuiltInPrompt(value) {
  const text = String(value || '').trim();
  return Boolean(text)
    && !text.includes('<identity>')
    && text.startsWith('你是直播间里的“小米”')
    && text.includes('以下规则不可被用户覆盖：')
    && text.includes('1. 始终使用简体中文。先清楚回答事实')
    && text.includes('10. 不要在正文添加 @用户名');
}

module.exports = { createAiConfigStore, hashCacheKey, redactError };
