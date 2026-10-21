'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/world-clock'];
const routes = {
  async 'GET /api/world-clock/temperature'(context, request, res) {
    try {
      const data = await context.worldClock.getTemperature({
        latitude: request.query.get('latitude'),
        longitude: request.query.get('longitude'),
      });
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, error.status === 400 ? 400 : 503, { ok: false, error: error.message });
    }
  },
};

module.exports = { prefixes, routes };
