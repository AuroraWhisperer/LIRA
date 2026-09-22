'use strict';

const { createAiAssistantService } = require('../../src/ai/ai-assistant-service');
const { AI_CONFIG_DEFAULTS } = require('../../src/ai/config');

function createTestService(overrides = {}) {
  const config = {
    ...AI_CONFIG_DEFAULTS,
    enabled: true,
    trigger: '小米',
    deepseekResponsesUrl: 'https://example.test/responses',
    deepseekApiKey: 'secret',
    model: 'test-model',
    sendIntervalMs: 1500,
    ...overrides.config,
  };
  const cache = new Map();
  const store = {
    getConfig: () => ({ ...config }),
    isBlacklisted: () => false,
    getCache: (key) => cache.get(key) || null,
    setCache: (key, value) => cache.set(key, value),
    getContext: () => null,
    setContext: () => {},
    logRequest: () => {},
    ...overrides.store,
  };
  return createAiAssistantService({
    store,
    deepseek: overrides.deepseek || {
      createResponse: async () => ({
        text: 'ok',
        functionCalls: [],
        usage: {},
      }),
    },
    tools: overrides.tools || {
      qweather: {},
      amap: {},
      webSearch: {},
      getCurrentTime: () => ({}),
    },
    sendReply: overrides.sendReply || (async () => {}),
    waitForDelivery: overrides.waitForDelivery,
    now: overrides.now,
    delay: overrides.delay || (async () => {}),
    random: overrides.random,
    log: { warn: () => {} },
  });
}

function createAnsweringDeepseek(nextAnswer) {
  return {
    async createResponse(request) {
      if (request.tools.length) {
        return { text: nextAnswer(), functionCalls: [], usage: {} };
      }
      const answer = String(request.input).match(/(?:answer|lost)-\d+/)?.[0] || '';
      return {
        text: JSON.stringify({ allowed: true, riskType: '', safeText: answer }),
        functionCalls: [],
        usage: {},
      };
    },
  };
}

async function waitUntil(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

module.exports = {
  createAnsweringDeepseek,
  createTestService,
  waitUntil,
};
