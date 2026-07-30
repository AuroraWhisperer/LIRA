// 编写人：Aurora
// 系统域路由：健康检查、全局状态、运行指标和退出。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/health', '/api/state', '/api/system/'];

const routes = {
  'GET /api/health'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.system.getHealth() });
  },

  'GET /api/state'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.system.getState() });
  },

  async 'GET /api/system/metrics'(context, request, res) {
    const windowMs = Number(request.query.get('windowMs') || 5000);
    sendJson(res, 200, { ok: true, data: await context.system.getMetrics(windowMs) });
  },

  async 'POST /api/system/shutdown'(context, request, res) {
    const body = await request.body();
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少退出确认。' });
      return;
    }
    sendJson(res, 200, { ok: true, data: { shuttingDown: true } });
    setTimeout(() => context.system.shutdown(), 250);
  }
};

module.exports = { prefixes, routes };
