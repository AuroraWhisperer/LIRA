'use strict';

const { sendJson } = require('../http-utils');

async function appearanceReply(res, action) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return sendJson(res, 200, { ok: true, data: await action() });
  } catch (error) {
    const status = [400, 409, 423, 503].includes(error.statusCode) ? error.statusCode : 503;
    return sendJson(res, status, { ok: false, code: error.code,
      error: status === 503 ? '弹幕外观暂时无法读取或保存，请稍后重试。' : error.message });
  }
}

function readDanmakuDisplay(context, request, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!context.readDanmakuDisplay) return sendJson(res, 503, { ok: false, error: '弹幕组件尚未就绪。' });
  const data = context.readDanmakuDisplay({ epoch: request.query.get('epoch'), cursor: request.query.get('cursor') });
  return sendJson(res, 200, { ok: true, data });
}

function openDanmakuEvents(context, request, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!request.req.headers.authorization?.startsWith('Bearer ')) {
    return sendJson(res, 401, { ok: false, error: '弹幕更新通知需要请求头凭据。' });
  }
  if (!context.danmakuEvents || typeof context.getSceneOutputStatus !== 'function') {
    return sendJson(res, 503, { ok: false, error: '弹幕更新通知尚未就绪。' });
  }
  try {
    return context.danmakuEvents.open(res, { id: 'danmaku' }, context.getSceneOutputStatus);
  } catch (error) {
    const status = [401, 403, 423, 429, 503].includes(error.statusCode) ? error.statusCode : 503;
    return sendJson(res, status, { ok: false, error: '弹幕更新通知暂时不可用。' });
  }
}

module.exports = { prefixes: ['/api/danmaku/'], routes: {
  'GET /api/danmaku/appearance': (context, request, res) => appearanceReply(res, () => context.danmakuAppearance.read()),
  'POST /api/danmaku/appearance': (context, request, res) => appearanceReply(res, async () => {
    const input = await request.body();
    return context.danmakuAppearance.save(input);
  }),
  'GET /api/danmaku/display': readDanmakuDisplay,
  'GET /api/danmaku/events': openDanmakuEvents,
} };
