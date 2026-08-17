'use strict';

const { SYSTEM_PROMPT } = require('./prompt');

const AI_SECRET_KEYS = Object.freeze([
  'deepseekApiKey',
  'qweatherApiKey',
  'amapApiKey'
]);

const MODEL_PROVIDER_PRESETS = Object.freeze({
  deepseek: Object.freeze({
    url: 'https://api.deepseek.com',
    protocol: 'chat_completions'
  }),
  openai: Object.freeze({
    url: 'https://api.openai.com/v1',
    protocol: 'responses'
  }),
  anthropic: Object.freeze({
    url: 'https://api.anthropic.com/v1',
    protocol: 'chat_completions'
  }),
  gemini: Object.freeze({
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'chat_completions'
  })
});

const AI_CONFIG_DEFAULTS = Object.freeze({
  enabled: true,
  trigger: '',
  modelProvider: 'auto',
  deepseekResponsesUrl: '',
  modelApiProtocol: 'auto',
  deepseekApiKey: '',
  model: '',
  webSearchEnabled: true,
  reasoningEnabled: false,
  reasoningEffort: 'auto',
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
  userCooldownSeconds: 0,
  roomLimitPerMinute: 20,
  requestTimeoutMs: 12000,
  maxToolCalls: 6,
  cacheTtlSeconds: 60,
  contextTtlSeconds: 1200,
  systemPrompt: SYSTEM_PROMPT
});

const BOOLEAN_KEYS = new Set([
  'enabled', 'webSearchEnabled', 'reasoningEnabled',
  'weatherEnabled', 'placesEnabled', 'routesEnabled'
]);

const ENUM_VALUES = Object.freeze({
  modelProvider: new Set(['auto', 'deepseek', 'openai', 'anthropic', 'gemini', 'custom']),
  modelApiProtocol: new Set(['auto', 'responses', 'chat_completions']),
  reasoningEffort: new Set(['auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
});

const NUMBER_LIMITS = Object.freeze({
  replyMaxChars: [10, 50],
  generationConcurrency: [1, 5],
  queueLimit: [1, 100],
  sendIntervalMs: [1500, 30000],
  userCooldownSeconds: [0, 3600],
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
  const requestedProvider = String(input?.modelProvider ?? result.modelProvider ?? 'auto').trim().toLowerCase();
  const providerPresetActive = Boolean(MODEL_PROVIDER_PRESETS[requestedProvider]);

  for (const [key, rawValue] of Object.entries(input || {})) {
    if (!allowedKeys.has(key)) continue;
    if (providerPresetActive && ['deepseekResponsesUrl', 'modelApiProtocol'].includes(key)) continue;
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
    if (ENUM_VALUES[key]) {
      const value = String(rawValue ?? '').trim().toLowerCase();
      if (!ENUM_VALUES[key].has(value)) {
        throw new Error(`${key} 配置无效。`);
      }
      result[key] = value;
      continue;
    }
    let value = String(rawValue ?? '').trim();
    if (key === 'model' && value === 'ds-v4-flash') value = 'deepseek-v4-flash';
    if (key === 'qweatherApiHost' && value && !value.includes('://')) value = `https://${value}`;
    if (URL_KEYS.has(key) && value) validateHttpUrl(key, value);
    if (key === 'trigger' && Array.from(value).length > 12) {
      throw new Error('触发关键词不能超过 12 个字符。');
    }
    if (key === 'model' && value.length > 80) throw new Error('模型名称无效。');
    if (key === 'systemPrompt' && (value.length < 20 || value.length > 8000)) {
      throw new Error('人格预设长度必须为 20 到 8000 个字符。');
    }
    result[key] = value;
  }
  return applyModelProviderPreset(result);
}

function applyModelProviderPreset(config = {}) {
  const preset = MODEL_PROVIDER_PRESETS[config.modelProvider];
  if (!preset) return { ...config };
  return {
    ...config,
    deepseekResponsesUrl: preset.url,
    modelApiProtocol: preset.protocol
  };
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
    && config.trigger
    && config.deepseekResponsesUrl
    && config.deepseekApiKey
    && config.model
  );
}

module.exports = {
  AI_CONFIG_DEFAULTS,
  AI_SECRET_KEYS,
  MODEL_PROVIDER_PRESETS,
  NUMBER_LIMITS,
  ENUM_VALUES,
  applyModelProviderPreset,
  normalizeAiConfig,
  isAiReady
};
