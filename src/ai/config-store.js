'use strict';

const crypto = require('node:crypto');
const {
  AI_CONFIG_DEFAULTS,
  AI_SECRET_KEYS,
  MODEL_PROVIDER_PRESETS,
  assertSavedModelKeyOrigin,
  normalizeAiConfig,
  usesAccountModel,
} = require('./config');
const { GENERAL_PROMPT, normalizePersonaPack, listPersonas, exportPersona } = require('./personas');
const { describeModelEndpoint } = require('./model-endpoint');

const SECRET_SET = new Set(AI_SECRET_KEYS);
const EXPIRED_PRUNE_INTERVAL_MS = 60 * 1000;

function createAiConfigStore(persistence, secretCodec, options = {}) {
  const now = options.now || Date.now;
  let cached = null;
  let lastPrunedAt = null;

  function getConfig() {
    if (!cached) cached = decodeConfiguration(persistence.readConfiguration());
    return structuredClone(cached.config);
  }

  function decodeConfiguration(rows) {
    const stored = {};
    for (const row of rows) {
      if (!(row.key in AI_CONFIG_DEFAULTS)) continue;
      try {
        const raw = row.isSecret ? secretCodec.decrypt(row.value) : row.value;
        stored[row.key] = parseStoredValue(row.key, raw);
      } catch (error) {
        console.warn(`[AI][Config] unable to read ${row.key}: ${redactError(error.message)}`);
        stored[row.key] = '';
      }
    }
    if (!Object.hasOwn(stored, 'personaId') && Object.keys(stored).length) {
      stored.personaId = stored.systemPrompt ? 'custom' : 'cat';
      // Preserve the previous tool defaults when reading an existing installation.
      for (const key of ['webSearchEnabled', 'functionCallingEnabled', 'weatherEnabled', 'placesEnabled', 'routesEnabled']) {
        if (!Object.hasOwn(stored, key)) stored[key] = true;
      }
    }
    return {
      config: normalizeAiConfig(stored, AI_CONFIG_DEFAULTS),
      previousKeyOrigin: rows.find(row => row.key === 'doubaoPreviousKeyOrigin')?.value || '',
      providerPersonaIds: safeJsonParse(rows.find(row => row.key === 'providerPersonaIds')?.value) || {},
    };
  }

  function getPublicConfig() {
    const config = getConfig();
    const result = {};
    for (const key of Object.keys(config)) {
      if (SECRET_SET.has(key)) {
        result[`${key}Preview`] = config[key] ? `${config[key].length > 12 ? config[key].slice(0, 6) : ''}********` : '';
      } else if (!['personaPacks', 'builtinPersonaOverrides'].includes(key)) {
        result[key] = config[key];
      }
    }
    result.hasDeepSeekApiKey = Boolean(config.deepseekApiKey);
    result.hasQWeatherApiKey = Boolean(config.qweatherApiKey);
    result.hasAmapApiKey = Boolean(config.amapApiKey);
    result.secretEncryptionAvailable = Boolean(secretCodec?.isAvailable?.());
    result.personas = listPersonas(config);
    result.providerPersonaIds = { ...cached.providerPersonaIds, [config.modelProvider]: config.personaId };
    result.hasCustomPersona = config.personaId === 'custom' || config.systemPrompt !== GENERAL_PROMPT;
    result.modelEndpoint = describeModelEndpoint(
      config.deepseekResponsesUrl,
      config.modelApiProtocol,
      config.modelProvider,
    );
    return result;
  }

  function updateConfig(changes = {}) {
    const current = getConfig();
    const accountKeyOrigin = cached.previousKeyOrigin;
    const normalized = normalizeAiConfig(changes, current);
    const personaIds = new Set(['custom', ...listPersonas(normalized).map(persona => persona.id)]);
    const nextProviderPersonaIds = Object.fromEntries(Object.entries({
      ...cached.providerPersonaIds,
      [current.modelProvider]: current.personaId,
      [normalized.modelProvider]: normalized.personaId,
    }).map(([provider, id]) => [provider, personaIds.has(id) ? id : 'general']));
    const updatedAt = new Date(now()).toISOString();
    const entries = [];
    const keys = new Set([...Object.keys(changes), 'modelAuthMode', 'personaId', 'webSearchEnabled', 'functionCallingEnabled', 'weatherEnabled', 'placesEnabled', 'routesEnabled']);
    for (const key of keys) {
      if (!(key in AI_CONFIG_DEFAULTS)) continue;
      if (
        MODEL_PROVIDER_PRESETS[normalized.modelProvider] &&
        ['deepseekResponsesUrl', 'modelApiProtocol'].includes(key)
      )
        continue;
      const isSecret = SECRET_SET.has(key);
      const value = normalized[key];
      entries.push({ key, value: isSecret && value ? secretCodec.encrypt(value) : serializeValue(value), isSecret });
    }
    entries.push({ key: 'providerPersonaIds', value: JSON.stringify(nextProviderPersonaIds), isSecret: false });
    // Account modes do not overwrite a previously saved manual endpoint.
    // Retain only the API key's origin so returning to its preset can safely
    // reuse the key even when that preset had no stored manual URL.
    if (!usesAccountModel(current) && usesAccountModel(normalized)) {
      const origin = current.deepseekApiKey && current.deepseekResponsesUrl ? new URL(current.deepseekResponsesUrl).origin : '';
      entries.push({ key: 'doubaoPreviousKeyOrigin', value: origin, isSecret: false });
    }
    if (usesAccountModel(current) && !usesAccountModel(normalized)) {
      entries.push({ key: 'doubaoPreviousKeyOrigin', value: '', isSecret: false });
    }
    let nextConfiguration;
    persistence.updateConfiguration(entries, updatedAt, rows => {
      // Leaving a preset may restore a stored custom URL hidden by the current preset.
      nextConfiguration = decodeConfiguration(rows);
      assertSavedModelKeyOrigin(usesAccountModel(current) ? { ...current, modelProvider: 'custom', deepseekResponsesUrl: accountKeyOrigin } : current,
        nextConfiguration.config, Object.hasOwn(changes, 'deepseekApiKey'));
    });
    cached = nextConfiguration;
    return getPublicConfig();
  }

  function importPersona(input) {
    const pack = normalizePersonaPack(input);
    if (['general', 'cat', 'custom'].includes(pack.id)) pack.id = `imported-${pack.id}`;
    const config = getConfig();
    if (config.personaPacks.some((entry) => entry.id === pack.id)) throw new Error('此角色包已存在，请先删除旧包或更换文件中的标识。');
    return updateConfig({ personaPacks: [...config.personaPacks, pack], personaId: pack.id });
  }

  function createPersona(input) {
    return importPersona({
      format: 'lira-ai-persona',
      version: 1,
      id: `role-${crypto.randomUUID()}`,
      name: input?.name,
      description: input?.description || '',
      prompt: input?.prompt,
    });
  }

  function deletePersona(id) {
    const config = getConfig();
    if (!config.personaPacks.some((pack) => pack.id === id)) throw new Error('只能删除自建或导入的角色包。');
    return updateConfig({
      personaPacks: config.personaPacks.filter((pack) => pack.id !== id),
      personaId: config.personaId === id ? 'general' : config.personaId,
    });
  }

  function updatePersona(input) {
    const config = getConfig();
    const persona = listPersonas(config).find((entry) => entry.id === input?.id);
    if (!persona) throw new Error('找不到所选预设，请重新选择。');
    const key = persona.builtin ? 'builtinPersonaOverrides' : 'personaPacks';
    const remaining = config[key].filter((entry) => entry.id !== persona.id);
    if (input.reset === true) {
      if (!persona.builtin) throw new Error('只有内置预设可以恢复默认。');
      return updateConfig({ [key]: remaining });
    }
    const pack = normalizePersonaPack({
      format: 'lira-ai-persona', version: 1, id: persona.id,
      name: persona.builtin ? persona.name : input.name,
      description: input.description, prompt: input.prompt,
    });
    const entries = config[key].some((entry) => entry.id === persona.id)
      ? config[key].map((entry) => entry.id === persona.id ? pack : entry)
      : [...remaining, pack];
    return updateConfig({ [key]: entries });
  }

  function logRequest(entry = {}) {
    persistence.appendRequestLog({
      uid: String(entry.uid || ''),
      userName: String(entry.userName || '').slice(0, 80),
      category: String(entry.category || '').slice(0, 40),
      status: String(entry.status || '').slice(0, 24),
      latencyMs: toNonNegativeInteger(entry.latencyMs),
      inputTokens: toNonNegativeInteger(entry.inputTokens),
      outputTokens: toNonNegativeInteger(entry.outputTokens),
      toolCalls: toNonNegativeInteger(entry.toolCalls),
      errorCode: String(entry.errorCode || '').slice(0, 80),
      createdAt: now(),
    });
  }

  function isBlacklisted(uid) {
    if (!uid) return false;
    return persistence.isBlacklisted(String(uid));
  }

  function setBlacklist(uid, blocked, details = {}) {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) throw new Error('UID 不能为空。');
    if (!blocked) {
      persistence.deleteBlacklistEntry(normalizedUid);
      return;
    }
    persistence.upsertBlacklistEntry({
      uid: normalizedUid,
      userName: String(details.userName || '').slice(0, 80),
      reason: String(details.reason || '').slice(0, 200),
      createdAt: now(),
    });
  }

  function getContext(uid, personaScope = '') {
    if (personaScope) uid = `persona:${hashCacheKey(JSON.stringify([String(uid), personaScope]))}`;
    const row = persistence.readContext(String(uid || ''));
    if (!row || row.expiresAt <= now()) {
      if (row) persistence.deleteContext(String(uid || ''));
      return null;
    }
    return safeJsonParse(row.payload);
  }

  function setContext(uid, payload, ttlSeconds, personaScope = '') {
    if (!uid || !payload) return;
    if (personaScope) uid = `persona:${hashCacheKey(JSON.stringify([String(uid), personaScope]))}`;
    persistence.writeContext(String(uid), JSON.stringify(payload), now() + Math.max(1, Number(ttlSeconds) || 1) * 1000);
    pruneExpiredIfDue();
  }

  function clearContext(uid, personaScope = '') {
    if (personaScope) uid = `persona:${hashCacheKey(JSON.stringify([String(uid), personaScope]))}`;
    persistence.deleteContext(String(uid || ''));
  }

  function getCache(key) {
    const cacheKey = hashCacheKey(key);
    const row = persistence.readCache(cacheKey);
    if (!row || row.expiresAt <= now()) {
      if (row) persistence.deleteCache(cacheKey);
      return null;
    }
    return safeJsonParse(row.payload);
  }

  function setCache(key, payload, ttlSeconds) {
    const ttl = Number(ttlSeconds) || 0;
    if (!key || !payload || ttl <= 0) return;
    persistence.writeCache(hashCacheKey(key), JSON.stringify(payload), now() + ttl * 1000);
    pruneExpiredIfDue();
  }

  function pruneExpired() {
    const timestamp = now();
    persistence.pruneExpired(timestamp);
    lastPrunedAt = timestamp;
  }

  function pruneExpiredIfDue() {
    const timestamp = now();
    if (lastPrunedAt === null || timestamp < lastPrunedAt || timestamp - lastPrunedAt >= EXPIRED_PRUNE_INTERVAL_MS) {
      pruneExpired();
    }
  }

  pruneExpired();

  return {
    getConfig,
    getPublicConfig,
    updateConfig,
    importPersona,
    createPersona,
    updatePersona,
    deletePersona,
    exportPersona: () => exportPersona(getConfig()),
    logRequest,
    isBlacklisted,
    setBlacklist,
    getContext,
    setContext,
    clearContext,
    getCache,
    setCache,
    pruneExpired,
  };
}

function parseStoredValue(key, value) {
  const defaultValue = AI_CONFIG_DEFAULTS[key];
  if (Array.isArray(defaultValue)) return JSON.parse(value);
  if (typeof defaultValue === 'boolean') return value === 'true';
  if (typeof defaultValue === 'number') return Number(value);
  return String(value ?? '');
}

function serializeValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value ?? '');
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

module.exports = { createAiConfigStore, hashCacheKey, redactError };
