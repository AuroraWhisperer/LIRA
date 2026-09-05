'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/overtime'];

function overtimeRoute(run) {
  return async (context, request, res) => {
    try {
      const data = await run(context.overtime, request);
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message || 'Invalid overtime request.',
      });
    }
  };
}

const routes = {
  'GET /api/overtime': overtimeRoute((overtime) => overtime.getOverview()),

  'GET /api/overtime/gifts': overtimeRoute((overtime) =>
    overtime.getGiftCatalog(),
  ),

  'GET /api/overtime/gifts/catalog': overtimeRoute((overtime) =>
    overtime.getGlobalGiftCatalog(),
  ),

  'POST /api/overtime/gifts/refresh': overtimeRoute((overtime) =>
    overtime.refreshGiftCatalog({
      reason: 'manual',
      force: true,
    }),
  ),

  'POST /api/overtime/gifts/local/search': overtimeRoute(
    async (overtime, request) => {
      const body = await request.body();
      return overtime.searchLocalGifts(body.query);
    },
  ),

  'POST /api/overtime/gifts/server/search': overtimeRoute(
    async (overtime, request) => {
      const body = await request.body();
      return overtime.searchServerGifts(body.query);
    },
  ),

  'POST /api/overtime/time': overtimeRoute(async (overtime, request) => {
    return overtime.setTime(await request.body());
  }),

  'POST /api/overtime/action': overtimeRoute(async (overtime, request) => {
    const body = await request.body();
    return overtime.act(body.action);
  }),

  'POST /api/overtime/config': overtimeRoute(async (overtime, request) => {
    return overtime.setBackground(await request.body());
  }),

  'POST /api/overtime/rules': overtimeRoute(async (overtime, request) => {
    const body = await request.body();
    return overtime.replaceRules(body.rules);
  }),
};

module.exports = { prefixes, routes };
