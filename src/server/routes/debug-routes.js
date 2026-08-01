// 编写人：Aurora
// 调试路由 —— 暴露原始礼物消息缓冲区用于问题排查。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/debug/'];

const routes = {
  'GET /api/debug/gift-messages'(context, request, res) {
    const messages = context.debug ? context.debug.getGiftMessages() : [];
    const stats = context.debug ? context.debug.getGiftMessageStats() : {};
    sendJson(res, 200, { ok: true, data: { messages, stats } });
  },

  'GET /api/debug/gift-stats'(context, request, res) {
    const stats = context.debug ? context.debug.getGiftMessageStats() : {};
    sendJson(res, 200, { ok: true, data: stats });
  },

  'POST /api/debug/gift-messages/clear'(context, request, res) {
    if (context.debug) context.debug.clearGiftMessages();
    sendJson(res, 200, { ok: true, data: { cleared: true } });
  }
};

module.exports = { prefixes, routes };
