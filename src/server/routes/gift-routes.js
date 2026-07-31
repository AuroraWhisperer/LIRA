// 编写人：Aurora
// 礼物域路由：冲刺进度重置。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/gifts/'];

const routes = {
  'POST /api/gifts/sprint/reset'(context, request, res) {
    const result = context.gifts.resetSprint();
    context.broadcastSnapshot('gift:sprint:reset');
    sendJson(res, 200, { ok: true, data: result });
  },

  'GET /api/gifts/history'(context, request, res) {
    const page = Number(request.query.get('page')) || 1;
    const limit = Number(request.query.get('limit')) || 50;
    const data = context.gifts.getHistory({ page, limit });
    sendJson(res, 200, { ok: true, data });
  },

  'GET /api/gifts/blind-box-stats'(context, request, res) {
    const stats = context.gifts.getBlindBoxStats();
    sendJson(res, 200, { ok: true, data: stats });
  },

  'GET /api/gifts/search'(context, request, res) {
    const query = request.query || new Map();
    const getParam = (name) => {
      const val = query.get ? query.get(name) : query[name];
      return val || '';
    };
    const from = getParam('from');
    const to = getParam('to');
    const limit = Math.min(Number(getParam('limit')) || 100, 500);
    const rows = context.gifts.search({ from, to, limit });
    sendJson(res, 200, { ok: true, data: rows });
  }
};

module.exports = { prefixes, routes };
