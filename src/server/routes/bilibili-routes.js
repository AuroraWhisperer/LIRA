// 编写人：Aurora
// Bilibili 监听域路由：手动重连。
'use strict';

const { sendJson } = require('../http-utils');
const { normalizeRoomInput, publicBilibiliErrorMessage } = require('../../shared/utils');

const prefixes = ['/api/bilibili/'];

const routes = {
  async 'GET /api/bilibili/auth/state'(context, _request, res) {
    try {
      const authState = context.bilibili.auth
        ? await context.bilibili.auth.getAuthState()
        : { loggedIn: false, uid: 0, message: '非 Electron 桌面环境，Bilibili 登录不可用' };
      sendJson(res, 200, { ok: true, data: authState });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || '获取 Bilibili 登录状态失败' });
    }
  },

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
