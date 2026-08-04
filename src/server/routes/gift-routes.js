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
    const sortField = request.query.get('sortField') || 'created_at';
    const sortDirection = request.query.get('sortDirection') || 'desc';
    const data = context.gifts.getHistory({ page, limit, sortField, sortDirection });
    sendJson(res, 200, { ok: true, data });
  },

  'GET /api/gifts/blind-box-stats'(context, request, res) {
    const boxName = request.query.get('boxName') || '';
    const stats = context.gifts.getBlindBoxStats({ boxName });
    sendJson(res, 200, { ok: true, data: stats });
  },

  'GET /api/gifts/blind-box-analysis'(context, request, res) {
    const query = request.query;
    const data = context.gifts.getBlindBoxAnalysis({
      viewer: query.get('viewer') || '',
      box: query.get('box') || '',
      view: query.get('view') || 'users',
      page: query.get('page') || '1',
      limit: query.get('limit') || '25',
      sort: query.get('sort') || '',
      direction: query.get('direction') || 'desc'
    });
    sendJson(res, 200, { ok: true, data });
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
  },

  async 'POST /api/gifts/clear-recent'(context, request, res) {
    const body = await request.body();
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }
    const result = context.gifts.clearRecent();
    context.broadcastSnapshot('gift:clear-recent');
    sendJson(res, 200, { ok: true, data: result });
  }
};

module.exports = { prefixes, routes };
