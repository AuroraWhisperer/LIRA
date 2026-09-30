'use strict';

const { sendJson } = require('../http-utils');

function readDanmakuDisplay(context, request, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!context.readDanmakuDisplay) return sendJson(res, 503, { ok: false, error: '弹幕组件尚未就绪。' });
  const data = context.readDanmakuDisplay({ epoch: request.query.get('epoch'), cursor: request.query.get('cursor') });
  return sendJson(res, 200, { ok: true, data });
}

module.exports = { prefixes: ['/api/danmaku/'], routes: { 'GET /api/danmaku/display': readDanmakuDisplay } };
