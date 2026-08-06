// 编写人：Aurora
// 设置域路由：按白名单写入设置并重建 Bilibili 监听。
'use strict';

const { sendJson } = require('../http-utils');
const { normalizeRoomInput } = require('../../shared/utils');
const { parseCustomReplyRules } = require('../../bilibili/custom-reply-service');

const prefixes = ['/api/settings'];

const routes = {
  async 'POST /api/settings'(context, request, res) {
    const body = await request.body();
    const allowedKeys = new Set(Object.keys(context.settings.defaults));
    for (const [key, rawValue] of Object.entries(body || {})) {
      if (allowedKeys.has(key)) {
        const value = normalizeSettingValue(key, rawValue);
        context.settings.set(key, value);
      }
    }
    context.bilibili.configure();
    context.broadcastSnapshot('settings');
    sendJson(res, 200, { ok: true, data: context.system.getState() });
  }
};

function normalizeSettingValue(key, rawValue) {
  if (key === 'roomId') return normalizeRoomInput(rawValue);
  if (key === 'customReplyRules') return JSON.stringify(parseCustomReplyRules(rawValue));
  return String(rawValue);
}

module.exports = { prefixes, routes };
