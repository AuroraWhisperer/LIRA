'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/ai'];
const SECRET_KEYS = new Set(['deepseekApiKey', 'qweatherApiKey', 'amapApiKey']);
const ALLOWED_KEYS = new Set([
  'enabled', 'trigger', 'deepseekResponsesUrl', 'deepseekApiKey', 'model',
  'webSearchEnabled', 'reasoningEnabled', 'qweatherApiHost', 'qweatherApiKey',
  'amapApiHost', 'amapApiKey', 'weatherEnabled', 'placesEnabled', 'routesEnabled',
  'replyMaxChars', 'generationConcurrency', 'queueLimit', 'sendIntervalMs',
  'userCooldownSeconds', 'roomLimitPerMinute', 'requestTimeoutMs', 'maxToolCalls',
  'cacheTtlSeconds', 'contextTtlSeconds', 'systemPrompt'
]);

const routes = {
  'GET /api/ai/config'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.ai.getConfig() });
  },
  async 'PUT /api/ai/config'(context, request, res) {
    try {
      const body = await request.body();
      const changes = {};
      for (const [key, value] of Object.entries(body || {})) {
        if (!ALLOWED_KEYS.has(key)) continue;
        if (SECRET_KEYS.has(key) && value === '') continue;
        changes[key] = value === null && SECRET_KEYS.has(key) ? '' : value;
      }
      sendJson(res, 200, { ok: true, data: context.ai.updateConfig(changes) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'AI 配置无效。' });
    }
  },
  'GET /api/ai/status'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.ai.getStatus() });
  },
  async 'POST /api/ai/test'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: await context.ai.test() });
    } catch (error) {
      sendJson(res, 502, { ok: false, error: error.message || 'DeepSeek 连接测试失败。' });
    }
  }
};

module.exports = { prefixes, routes, ALLOWED_KEYS };
