'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/music/wesing/'];

function weSingRoute(run) {
  return async (context, request, res) => {
    try {
      sendJson(res, 200, { ok: true, data: await run(context, request) });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message || '全民 K 歌操作失败。',
      });
    }
  };
}

const routes = {
  'GET /api/music/wesing/status': weSingRoute((context) =>
    context.weSing.getStatus(),
  ),

  'POST /api/music/wesing/configure': weSingRoute(async (context, request) => {
    const body = await request.body();
    return context.weSing.configure(body.cachePath);
  }),

  'POST /api/music/wesing/offset': weSingRoute(async (context, request) => {
    const body = await request.body();
    return context.weSing.setLyricOffsetMs(body.offsetMs);
  }),

  'POST /api/music/wesing/active': weSingRoute(async (context, request) => {
    const body = await request.body();
    if (typeof body.active !== 'boolean')
      throw new Error('active 必须是布尔值。');
    return context.weSing.setActive(body.active);
  }),

  'POST /api/music/wesing/refresh': weSingRoute((context) =>
    context.weSing.refresh(),
  ),
};

module.exports = { prefixes, routes };
