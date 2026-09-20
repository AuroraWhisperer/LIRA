'use strict';

const { sendJson } = require('../http-utils');

function wishRoute(action) {
  return async (context, request, res) => {
    try {
      const body = action === 'getSnapshot' ? undefined : await request.body();
      if (
        request.query?.has('sourceId') ||
        request.query?.has('source_id') ||
        body?.sourceId !== undefined ||
        body?.source_id !== undefined
      ) {
        return sendJson(res, 400, {
          ok: false,
          error: '礼物来源不能由页面指定。',
        });
      }
      const data = await context.giftWishes[action](body);
      if (action !== 'getSnapshot') context.broadcastSnapshot('gift:wishes');
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      const status =
        error.code === 'INVALID_GIFT_WISH'
          ? 400
          : ['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)
            ? 409
            : null;
      if (!status) throw error;
      sendJson(res, status, {
        ok: false,
        error: error.message,
        code: error.code,
      });
    }
  };
}

const routes = {
  'GET /api/gifts/wishes': wishRoute('getSnapshot'),
  'POST /api/gifts/wishes/save': wishRoute('save'),
  'POST /api/gifts/wishes/delete': wishRoute('remove'),
};

module.exports = { routes };
