'use strict';

const { sendJson } = require('../http-utils');
const { ENUM_VALUES } = require('../../ai/config');

const prefixes = ['/api/ai'];
const SECRET_KEYS = new Set(['deepseekApiKey', 'qweatherApiKey', 'amapApiKey']);
const ALLOWED_KEYS = new Set([
  'enabled', 'trigger', 'modelProvider', 'deepseekResponsesUrl', 'deepseekApiKey', 'model',
  'modelApiProtocol', 'webSearchEnabled', 'reasoningEnabled', 'reasoningEffort',
  'qweatherApiHost', 'qweatherApiKey',
  'amapApiHost', 'amapApiKey', 'weatherEnabled', 'placesEnabled', 'routesEnabled',
  'replyMaxChars', 'generationConcurrency', 'queueLimit', 'sendIntervalMs',
  'userCooldownSeconds', 'roomLimitPerMinute', 'requestTimeoutMs', 'maxToolCalls',
  'cacheTtlSeconds', 'contextTtlSeconds', 'systemPrompt'
]);

function createProviderTestRoute(provider) {
  return async (context, request, res) => {
    try {
      sendJson(res, 200, { ok: true, data: await context.ai.testProvider(provider) });
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        code: String(error?.code || 'UPSTREAM_ERROR').slice(0, 80),
        error: error.message || '连接测试失败。'
      });
    }
  };
}

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
  async 'POST /api/ai/models'(context, request, res) {
    try {
      const body = await request.body();
      const apiKey = body?.apiKey ?? '';
      const apiUrl = body?.apiUrl ?? '';
      const modelProvider = body?.modelProvider ?? '';
      const modelApiProtocol = body?.modelApiProtocol ?? '';
      if (typeof apiKey !== 'string' || apiKey.length > 512) throw new Error('API Key 格式无效。');
      if (typeof apiUrl !== 'string' || apiUrl.length > 2048) throw new Error('API 请求地址格式无效。');
      if (typeof modelProvider !== 'string' || modelProvider.length > 32) throw new Error('模型供应商格式无效。');
      if (typeof modelApiProtocol !== 'string' || modelApiProtocol.length > 32) throw new Error('接口协议格式无效。');
      const input = { apiKey: apiKey.trim(), apiUrl: apiUrl.trim() };
      const normalizedProvider = modelProvider.trim().toLowerCase();
      const normalizedProtocol = modelApiProtocol.trim().toLowerCase();
      if (normalizedProvider && !ENUM_VALUES.modelProvider.has(normalizedProvider)) {
        throw new Error('模型供应商格式无效。');
      }
      if (normalizedProtocol && !ENUM_VALUES.modelApiProtocol.has(normalizedProtocol)) {
        throw new Error('接口协议格式无效。');
      }
      if (normalizedProvider) input.modelProvider = normalizedProvider;
      if (normalizedProtocol) input.modelApiProtocol = normalizedProtocol;
      sendJson(res, 200, {
        ok: true,
        data: await context.ai.listModels(input)
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || '无法获取模型列表。' });
    }
  },
  async 'POST /api/ai/test'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: await context.ai.test() });
    } catch (error) {
      sendJson(res, 502, { ok: false, error: error.message || '模型服务连接测试失败。' });
    }
  },
  'POST /api/ai/test/deepseek': createProviderTestRoute('deepseek'),
  'POST /api/ai/test/qweather': createProviderTestRoute('qweather'),
  'POST /api/ai/test/amap': createProviderTestRoute('amap')
};

module.exports = { prefixes, routes, ALLOWED_KEYS };
