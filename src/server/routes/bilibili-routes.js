// 编写人：Aurora
// Bilibili 监听域路由：手动重连。
'use strict';

const { sendJson } = require('../http-utils');
const { normalizeRoomInput, publicBilibiliErrorMessage } = require('../../shared/utils');

const prefixes = ['/api/bilibili/'];

const routes = {
  async 'POST /api/bilibili/reconnect'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: await context.bilibili.reconnect() });
    } catch (error) {
      console.warn(`[Bilibili] manual reconnect failed: ${error.message}`);
      const message = publicBilibiliErrorMessage(error, true);
      context.bilibili.updateStatus({
        connected: false,
        enabled: true,
        roomId: normalizeRoomInput(context.settings.get().roomId),
        mode: 'bilibili',
        message
      });
      sendJson(res, 500, {
        ok: false,
        error: message,
        detail: error.message || String(error),
        data: { liveStatus: context.bilibili.liveStatus }
      });
    }
  }
};

module.exports = { prefixes, routes };
