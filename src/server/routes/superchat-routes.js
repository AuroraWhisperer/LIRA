// 编写人：Aurora
// 醒目留言域路由。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/superchats/'];

const routes = {
  async 'POST /api/superchats/action'(context, request, res) {
    const body = await request.body();
    const result = context.superChat.handleAction(body.action, body.id);
    context.broadcastSnapshot(`superchat:${body.action}`);
    sendJson(res, 200, { ok: true, data: result });
  }
};

module.exports = { prefixes, routes };
