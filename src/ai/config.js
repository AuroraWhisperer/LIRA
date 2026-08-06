'use strict';

const { SYSTEM_PROMPT } = require('./prompt');

const AI_SECRET_KEYS = Object.freeze([
  'deepseekApiKey',
  'qweatherApiKey',
  'amapApiKey'
]);

const AI_CONFIG_DEFAULTS = Object.freeze({
  enabled: false,
  trigger: '小米',
  deepseekResponsesUrl: '',
  deepseekApiKey: '',
  model: 'deepseek-v4-flash',
  webSearchEnabled: true,
  reasoningEnabled: false,
  qweatherApiHost: '',
  qweatherApiKey: '',
  amapApiHost: '',
  amapApiKey: '',
  weatherEnabled: true,
  placesEnabled: true,
  routesEnabled: true,
  replyMaxChars: 50,
  generationConcurrency: 3,
  queueLimit: 30,
  sendIntervalMs: 3000,
  userCooldownSeconds: 30,
  roomLimitPerMinute: 20,
  requestTimeoutMs: 12000,
  maxToolCalls: 4,
  cacheTtlSeconds: 60,
  contextTtlSeconds: 1200,
  systemPrompt: SYSTEM_PROMPT
});

const BOOLEAN_KEYS = new Set([
  'enabled', 'webSearchEnabled', 'reasoningEnabled',
  'weatherEnabled', 'placesEnabled', 'routesEnabled'
]);

const NUMBER_LIMITS = Object.freeze({
  replyMaxChars: [10, 50],
  generationConcurrency: [1, 5],
  queueLimit: [1, 100],
  sendIntervalMs: [1500, 30000],
  userCooldownSeconds: [5, 3600],
  roomLimitPerMinute: [1, 120],
  requestTimeoutMs: [3000, 60000],
  maxToolCalls: [1, 8],
  cacheTtlSeconds: [0, 3600],
  contextTtlSeconds: [60, 86400]
});

const URL_KEYS = new Set(['deepseekResponsesUrl', 'qweatherApiHost', 'amapApiHost']);

function normalizeAiConfig(input = {}, current = AI_CONFIG_DEFAULTS) {
  const result = { ...AI_CONFIG_DEFAULTS, ...current };
  const allowedKeys = new Set(Object.keys(AI_CONFIG_DEFAULTS));

  for (const [key, rawValue] of Object.entries(input || {})) {
    if (!allowedKeys.has(key)) continue;
    if (BOOLEAN_KEYS.has(key)) {
      result[key] = rawValue === true || rawValue === 'true';
      continue;
    }
    if (NUMBER_LIMITS[key]) {
      const value = Number(rawValue);
      const [minimum, maximum] = NUMBER_LIMITS[key];
      if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${key} 必须在 ${minimum} 到 ${maximum} 之间。`);
      }
      result[key] = Math.round(value);
      continue;
    }
    let value = String(rawValue ?? '').trim();
    if (key === 'model' && value === 'ds-v4-flash') value = 'deepseek-v4-flash';
    if (key === 'qweatherApiHost' && value && !value.includes('://')) value = `https://${value}`;
    if (URL_KEYS.has(key) && value) validateHttpUrl(key, value);
    if (key === 'trigger' && (!value || Array.from(value).length > 12)) {
      throw new Error('触发关键词长度必须为 1 到 12 个字符。');
    }
    if (key === 'model' && (!value || value.length > 80)) throw new Error('模型名称无效。');
    if (key === 'systemPrompt' && (value.length < 20 || value.length > 8000)) {
      throw new Error('人格预设长度必须为 20 到 8000 个字符。');
    }
    result[key] = value;
  }
  return result;
}

function validateHttpUrl(key, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} 必须是完整的 HTTP(S) 地址。`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${key} 必须是无账号信息的 HTTP(S) 地址。`);
  }
}

function isAiReady(config) {
  return Boolean(
    config.enabled
    && config.deepseekResponsesUrl
    && config.deepseekApiKey
    && config.model
  );
}

module.exports = {
  AI_CONFIG_DEFAULTS,
  AI_SECRET_KEYS,
  NUMBER_LIMITS,
  normalizeAiConfig,
  isAiReady
};
