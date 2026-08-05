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
      const settings = context.settings.get();
      sendJson(res, 200, {
        ok: true,
        data: {
          ...sender,
          checkinBlessings: settings.checkinBlessings
        }
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || '获取弹幕发送状态失败。' });
    }
  },

  async 'POST /api/bilibili/danmaku/send'(context, request, res) {
    try {
      const body = await request.body();
      const message = String(body && body.message || '').trim();
      if (!message) {
        sendJson(res, 400, { ok: false, error: '弹幕内容不能为空。' });
        return;
      }
      const result = await context.bilibili.sendDanmaku({
        message,
        mentionRequester: body && body.mentionRequester === true
      });
      sendJson(res, 200, { ok: true, data: result });
    } catch (error) {
      console.warn(`[Bilibili] send danmaku failed: ${error.message}`);
      sendJson(res, 502, {
        ok: false,
        error: publicDanmakuSendErrorMessage(error),
        detail: error.message || String(error)
      });
    }
  }
};

function publicDanmakuSendErrorMessage(error) {
  const message = error && error.message ? error.message : String(error || '');
  let friendly = '发送失败：B站没有接收这条弹幕，请稍后再试。';
  if (/发送过于频繁/.test(message)) {
    friendly = '发送失败：刚刚已经发过了，请等几秒再试。';
  } else if (/请先登录|登录 Bilibili|bili_jct|code=-101/i.test(message)) {
    friendly = '发送失败：需要先登录 Bilibili 账号，或当前登录已经过期。';
  } else if (/请先设置|直播间号|room_init|code=60004/i.test(message)) {
    friendly = '发送失败：直播间号不对，或还没有设置直播间。';
  } else if (/code=-352|风控|校验失败/i.test(message)) {
    friendly = '发送失败：B站触发了风控校验，通常需要重新登录或稍后再试。';
  } else if (/code=-412|拦截/i.test(message)) {
    friendly = '发送失败：B站拦截了这次请求，稍后再试或换网络看看。';
  } else if (/code=-400|参数/i.test(message)) {
    friendly = '发送失败：B站认为这条弹幕的内容或房间参数不正确。';
  } else if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|timeout/i.test(message)) {
    friendly = '发送失败：现在连不上 B站服务，请检查网络后重试。';
  } else if (/non-JSON|Unexpected token|Unexpected end/i.test(message)) {
    friendly = '发送失败：B站接口返回了异常内容，请稍后再试。';
  }
  return `${friendly} 具体报错已写入日志，可在启动窗口或 logs 目录查看。`;
}

module.exports = { prefixes, routes };
