'use strict';

const { isOfficialDeepSeekUrl } = require('./model-endpoint');

const EFFORT_VALUES = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function getModelReasoning(config = {}, modelInfo = {}) {
  const catalog = readCatalogReasoning(modelInfo);
  if (catalog !== undefined) return catalog;

  const model = String(config.model || modelInfo.id || modelInfo.slug || '');
  const provider = resolveProvider(config);
  // Subscription availability and effort settings belong to the current account catalog.
  if (provider === 'openai' && config.modelAuthMode === 'subscription') return null;
  if (provider === 'deepseek' && /^(?:deepseek-flash|deepseek-v4-pro)$/.test(model)) {
    // https://api-docs.deepseek.com/api/list-models/
    return profile(['low', 'high', 'max'], 'high');
  }
  if (provider === 'kimi' && /^kimi-k3(?:\.1-pro)?$/.test(model)) {
    // https://platform.kimi.com/docs/guide/kimi-k3-quickstart
    // https://platform.kimi.com/docs/guide/use-reasoning-effort
    return profile(['low', 'high', 'max'], 'max');
  }
  if (provider === 'gemini') return getGeminiReasoning(model);
  // OpenAI-compatible relays often return IDs only; explicit catalog levels still win above.
  if (['openai', 'custom', ''].includes(provider)) return getOpenAiReasoning(model);
  return null;
}

function readCatalogReasoning(modelInfo) {
  if (Array.isArray(modelInfo?.effort?.supported_levels)) {
    return profile(modelInfo.effort.supported_levels, modelInfo.effort.default_level);
  }
  if (Array.isArray(modelInfo?.supported_reasoning_levels)) {
    return profile(modelInfo.supported_reasoning_levels, modelInfo.default_reasoning_level);
  }
  return undefined;
}

function profile(values, defaultValue) {
  if (!Array.isArray(values)) return null;
  const efforts = [...new Set(values.map((value) => typeof value === 'string' ? value : value?.effort))]
    .filter((value) => EFFORT_VALUES.has(value));
  return { efforts, ...(efforts.includes(defaultValue) ? { defaultEffort: defaultValue } : {}) };
}

function resolveProvider(config) {
  if (config.modelProvider && config.modelProvider !== 'auto') return config.modelProvider;
  if (config.deepseekResponsesUrl && isOfficialDeepSeekUrl(config.deepseekResponsesUrl)) return 'deepseek';
  return '';
}

function getOpenAiReasoning(model) {
  // Only the exact documented IDs below are covered; unknown snapshots need catalog metadata.
  const snapshots = {
    'gpt-5-2025-08-07': 'gpt-5',
    'gpt-5.1-2025-11-13': 'gpt-5.1',
    'gpt-5.2-2025-12-11': 'gpt-5.2',
    'gpt-5.4-2026-03-05': 'gpt-5.4',
    'gpt-5.4-pro-2026-03-05': 'gpt-5.4-pro',
    'gpt-5.5-2026-04-23': 'gpt-5.5',
    'gpt-5.5-pro-2026-04-23': 'gpt-5.5-pro',
  };
  model = Object.hasOwn(snapshots, model) ? snapshots[model] : model;
  // https://developers.openai.com/api/docs/models/gpt-6.1-sol
  // https://developers.openai.com/api/docs/models/gpt-6-astra
  // https://developers.openai.com/api/reference/resources/responses/methods/create#reasoning
  if (['gpt-6.1-sol', 'gpt-6-astra'].includes(model)) {
    return profile(['low', 'medium', 'high', 'xhigh', 'max'], 'medium');
  }
  // https://developers.openai.com/api/docs/models/gpt-6-sol
  // https://developers.openai.com/api/docs/models/gpt-6-luna
  // https://developers.openai.com/api/docs/models/gpt-6.1-terra
  if (['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-terra'].includes(model)) {
    return profile(['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium');
  }
  // https://developers.openai.com/api/docs/models/gpt-5.5
  if (model === 'gpt-5.5') {
    return profile(['none', 'low', 'medium', 'high', 'xhigh'], 'medium');
  }
  // https://developers.openai.com/api/docs/models/gpt-5.6-terra
  // https://developers.openai.com/api/docs/models/gpt-5.6-sol
  if (['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra'].includes(model)) {
    return profile(['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium');
  }
  // https://developers.openai.com/api/docs/models/gpt-5.4-pro
  if (model === 'gpt-5.4-pro') return profile(['medium', 'high', 'xhigh'], 'medium');
  // https://developers.openai.com/api/docs/models/gpt-5.5-pro
  if (model === 'gpt-5.5-pro') return profile(['medium', 'high', 'xhigh'], 'high');
  // https://developers.openai.com/api/docs/models/gpt-5.2
  // https://developers.openai.com/api/docs/models/gpt-5.4
  if (['gpt-5.2', 'gpt-5.4'].includes(model)) {
    return profile(['none', 'low', 'medium', 'high', 'xhigh'], 'none');
  }
  // https://developers.openai.com/api/docs/models/gpt-5.1
  if (model === 'gpt-5.1') {
    return profile(['none', 'low', 'medium', 'high'], 'none');
  }
  // https://developers.openai.com/api/docs/models/gpt-5
  // https://developers.openai.com/api/reference/resources/responses/methods/create#reasoning
  if (model === 'gpt-5') {
    return profile(['minimal', 'low', 'medium', 'high'], 'medium');
  }
  return null;
}

function getGeminiReasoning(model) {
  // https://aistudio.google.com/docs/thinking#thinking-levels
  // https://aistudio.google.com/docs/openai#thinking
  const profiles = {
    'gemini-4-carbon': [['low', 'medium', 'high'], 'medium'],
    'gemini-4-argon': [['low', 'medium', 'high'], 'medium'],
    'gemini-4-hydrogen': [['low', 'medium', 'high', 'xhigh'], 'high'],
    'gemini-3.8-flash': [['low', 'medium', 'high'], 'medium'],
    'gemini-3.6-flash': [['minimal', 'low', 'medium', 'high'], 'medium'],
    'gemini-3.5-flash-lite': [['minimal', 'low', 'medium', 'high'], 'minimal'],
    'gemini-3.1-flash-lite': [['minimal', 'low', 'medium', 'high'], 'minimal'],
    'gemini-3.1-pro-preview': [['low', 'medium', 'high'], 'high'],
    'gemini-3.1-flash-lite-image': [['minimal', 'high'], 'minimal'],
    'gemini-3-flash-preview': [['minimal', 'low', 'medium', 'high'], 'high'],
    'gemini-3-pro-preview': [['low', 'high'], 'high'],
    'gemini-2.5-pro': [['low', 'medium', 'high']],
    'gemini-2.5-flash': [['none', 'low', 'medium', 'high']],
    'gemini-2.5-flash-lite': [['none', 'low', 'medium', 'high']],
    'gemini-robotics-er-2-preview': [['minimal', 'low', 'medium', 'high'], 'high'],
  };
  const values = profiles[model];
  return values ? profile(...values) : null;
}

module.exports = { getModelReasoning };
