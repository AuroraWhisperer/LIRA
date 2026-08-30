'use strict';

const { sendJson } = require('../http-utils');
const { getClockConfig } = require('../clock-contract');

const prefixes = ['/api/clock'];

const routes = {
  'GET /api/clock/config'(context, _request, res) {
    sendJson(res, 200, {
      ok: true,
      data: getClockConfig(context.settings.get()),
    });
  },
};

module.exports = { prefixes, routes };
