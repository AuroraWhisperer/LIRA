'use strict';

const { sendJson } = require('../http-utils');
const { normalizeRoomInput, publicBilibiliErrorMessage } = require('../../shared/utils');

const prefixes = ['/api/bilibili/'];

const routes = {
  async 'GET /api/bilibili/auth/state'(context, _request, res) {
    try {
      const authState = context.bilibili.auth
        ? await context.bilibili.auth.getAuthState()
        : { loggedIn: false, uid: 0, message: 'Bilibili 登录仅在 Electron 桌面环境中可用。' };
      sendJson(res, 200, { ok: true, data: authState });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || '获取 Bilibili 登录状态失败。' });
    }
  },

  async 'POST /api/bilibili/reconnect'(context, _request, res) {
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
  },

  async 'GET /api/bilibili/danmaku/state'(context, _request, res) {
    try {
      const sender = await context.bilibili.getDanmakuSenderState();
      sendJson(res, 200, { ok: true, data: sender });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || '获取弹幕发送状态失败。' });
    }
  },

  async 'POST /api/bilibili/danmaku/send'(context, request, res) {
    try {
      const body = await request.body();
      const message = String(body && body.message || '').trim();
      if (!message || message.length > 1000) {
        sendJson(res, 400, { ok: false, error: '弹幕内容不能为空且不能超过 1000 个字符。' });
        return;
      }
      const result = await context.bilibili.sendDanmaku({
        message,
        mentionRequester: body && body.mentionRequester === true
      });
      sendJson(res, 200, { ok: true, data: result });
    } catch (error) {
      console.warn(`[Bilibili] send danmaku failed: ${error.message}`);
      sendJson(res, 502, { ok: false, error: error.message || '发送弹幕失败。' });
    }
  }
};

module.exports = { prefixes, routes };
