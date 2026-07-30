// 编写人：Aurora
// 礼物域路由：冲刺进度重置和 blivedm 协议兼容性检查。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/gifts/'];

async function checkBlivedm(context, request, res) {
  sendJson(res, 200, { ok: true, data: await context.gifts.runBlivedmCheck() });
}

const routes = {
  'POST /api/gifts/sprint/reset'(context, request, res) {
    const result = context.gifts.resetSprint();
    context.broadcastSnapshot('gift:sprint:reset');
    sendJson(res, 200, { ok: true, data: result });
  },

  // 管理页用 GET 触发，兼容旧版 POST 调用
  'GET /api/gifts/blivedm/check': checkBlivedm,
  'POST /api/gifts/blivedm/check': checkBlivedm
};

module.exports = { prefixes, routes };
