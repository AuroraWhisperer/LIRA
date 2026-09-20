'use strict';

const { sendJson } = require('../http-utils');

function mutate(action) {
  return async (context, request, res) => {
    try {
      const input = await request.body();
      const service = context.interactions;
      const data = action === 'start' ? service.start(input) : service[action](input.sessionId);
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
    }
  };
}

module.exports = {
  prefixes: ['/api/interactions'],
  routes: {
    'GET /api/interactions/session': (context, request, res) => sendJson(res, 200, { ok: true, data: context.interactions.getState() }),
    'GET /api/interactions/host-state': (context, request, res) => sendJson(res, 200, { ok: true, data: context.interactions.getHostState() }),
    'POST /api/interactions/session': mutate('start'),
    'POST /api/interactions/session/finish': mutate('finish'),
    'POST /api/interactions/session/clear': mutate('clear'),
  },
};
