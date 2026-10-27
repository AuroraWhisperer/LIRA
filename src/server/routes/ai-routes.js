'use strict';

const { sendJson } = require('../http-utils');
const { AI_CONFIG_DEFAULTS, AI_SECRET_KEYS, ENUM_VALUES } = require('../../ai/config');

const prefixes = ['/api/ai'];
const SECRET_KEYS = new Set(AI_SECRET_KEYS);
const ALLOWED_KEYS = new Set(Object.keys(AI_CONFIG_DEFAULTS));

function createProviderTestRoute(provider) {
  return async (context, request, res) => {
    try {
      sendJson(res, 200, {
        ok: true,
        data: await context.ai.testProvider(provider),
      });
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        code: String(error?.code || 'UPSTREAM_ERROR').slice(0, 80),
        error: error.message || '连接测试失败。',
      });
    }
  };
}

const routes = {
  'GET /api/ai/chatgpt/status'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.ai.getChatGptStatus() });
  },
  async 'POST /api/ai/chatgpt/login'(context, request, res) {
    try {
      const body = await request.body();
      if (body?.profileId !== undefined && (typeof body.profileId !== 'string' || body.profileId.length > 80)) throw new Error('账号标识无效。');
      if (body?.newAccount !== undefined && typeof body.newAccount !== 'boolean') throw new Error('账号选择无效。');
      sendJson(res, 200, { ok: true, data: await context.ai.openChatGptLogin({ profileId: body?.profileId, newAccount: body?.newAccount }) });
    } catch (error) {
      if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
      sendJson(res, 400, { ok: false, code: error.code, error: error.message });
    }
  },
  'POST /api/ai/chatgpt/cancel'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.ai.cancelChatGptLogin() });
  },
  async 'POST /api/ai/chatgpt/select'(context, request, res) {
    try {
      const body = await request.body();
      if (typeof body?.profileId !== 'string' || body.profileId.length > 80) throw new Error('账号标识无效。');
      sendJson(res, 200, { ok: true, data: context.ai.selectChatGptAccount(body.profileId) });
    } catch (error) {
      if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
      sendJson(res, 400, { ok: false, code: error.code, error: error.message });
    }
  },
  async 'POST /api/ai/chatgpt/logout'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: await context.ai.logoutChatGpt() });
    } catch (error) {
      sendJson(res, 400, { ok: false, code: error.code, error: 'ChatGPT 退出失败，请重试。' });
    }
  },
  'GET /api/ai/doubao/status'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.ai.getDoubaoStatus() });
  },
  async 'POST /api/ai/doubao/login'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: await context.ai.openDoubaoLogin() });
    } catch (error) {
      sendJson(res, 503, { ok: false, code: error.code, error: error.message });
    }
  },
  async 'POST /api/ai/doubao/logout'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: await context.ai.logoutDoubao() });
    } catch (error) {
      sendJson(res, 503, { ok: false, code: error.code, error: error.message });
    }
  },
  async 'POST /api/ai/personas/update'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: context.ai.updatePersona(await request.body()) });
    } catch (error) {
      if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
      sendJson(res, 400, { ok: false, error: error.message || '预设更新失败。' });
    }
  },
  async 'POST /api/ai/personas/create'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: context.ai.createPersona(await request.body()) });
    } catch (error) {
      if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
      sendJson(res, 400, { ok: false, error: error.message || '角色包保存失败。' });
    }
  },
  async 'POST /api/ai/personas/import'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: context.ai.importPersona(await request.body()) });
    } catch (error) {
      if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
      sendJson(res, 400, { ok: false, error: error.message || '角色包导入失败。' });
    }
  },
  async 'POST /api/ai/personas/delete'(context, request, res) {
    try {
      const input = await request.body();
      sendJson(res, 200, { ok: true, data: context.ai.deletePersona(input?.id) });
    } catch (error) {
      if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
      sendJson(res, 400, { ok: false, error: error.message || '角色包删除失败。' });
    }
  },
  'GET /api/ai/personas/export'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.ai.exportPersona() });
  },
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
      if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
      sendJson(res, 400, {
        ok: false,
        error: error.message || 'AI 配置无效。',
      });
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
      const modelAuthMode = body?.modelAuthMode ?? '';
      if (typeof apiKey !== 'string' || apiKey.length > 512) throw new Error('API Key 格式无效。');
      if (typeof apiUrl !== 'string' || apiUrl.length > 2048) throw new Error('API 请求地址格式无效。');
      if (typeof modelProvider !== 'string' || modelProvider.length > 32) throw new Error('模型供应商格式无效。');
      if (typeof modelApiProtocol !== 'string' || modelApiProtocol.length > 32) throw new Error('接口协议格式无效。');
      if (typeof modelAuthMode !== 'string' || modelAuthMode.length > 32) throw new Error('接入方式无效。');
      const input = { apiKey: apiKey.trim(), apiUrl: apiUrl.trim() };
      const normalizedProvider = modelProvider.trim().toLowerCase();
      const normalizedProtocol = modelApiProtocol.trim().toLowerCase();
      const normalizedAuthMode = modelAuthMode.trim().toLowerCase();
      if (normalizedAuthMode && !ENUM_VALUES.modelAuthMode.has(normalizedAuthMode)) throw new Error('接入方式无效。');
      if (normalizedAuthMode) input.modelAuthMode = normalizedAuthMode;
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
        data: await context.ai.listModels(input),
      });
    } catch (error) {
      if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
      sendJson(res, 400, {
        ok: false,
        error: error.message || '无法获取模型列表。',
      });
    }
  },
  async 'POST /api/ai/test'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: await context.ai.test() });
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        error: error.message || '模型服务连接测试失败。',
      });
    }
  },
  'POST /api/ai/test/deepseek': createProviderTestRoute('deepseek'),
  'POST /api/ai/test/qweather': createProviderTestRoute('qweather'),
  'POST /api/ai/test/amap': createProviderTestRoute('amap'),
};

module.exports = { prefixes, routes, ALLOWED_KEYS };
