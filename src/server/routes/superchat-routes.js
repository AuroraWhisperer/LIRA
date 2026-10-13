// 编写人：Aurora
// 醒目留言域路由。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/superchats/'];

const routes = {
  async 'POST /api/superchats/delete'(context, request, res) {
    const body = await request.body();
    const undo = context.superChat.deleteWithUndo(body.id);
    context.broadcastSnapshot('superchat:delete');
    sendJson(res, 200, { ok: true, undo });
  },
  async 'POST /api/superchats/undo'(context, request, res) {
    const body = await request.body();
    try {
      context.superChat.undoDelete(body.token);
    } catch (error) {
      if (error.code !== 'SUPERCHAT_UNDO_EXPIRED') throw error;
      sendJson(res, 409, { ok: false, code: 'SUPERCHAT_UNDO_EXPIRED', error: '这批 SC 已无法撤销。' });
      return;
    }
    context.broadcastSnapshot('superchat:undo');
    sendJson(res, 200, { ok: true });
  },
  async 'POST /api/superchats/action'(context, request, res) {
    const body = await request.body();
    const result = context.superChat.handleAction(body.action, body.id);
    context.broadcastSnapshot(`superchat:${body.action}`);
    sendJson(res, 200, { ok: true, data: result });
  },
};

module.exports = { prefixes, routes };
