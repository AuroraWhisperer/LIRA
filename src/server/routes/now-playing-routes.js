'use strict';

const { sendJson } = require('../http-utils');
const { readNowPlayingConfig, saveNowPlayingConfig } = require('../now-playing-settings');

const prefixes = ['/api/now-playing'];
const routes = {
  'GET /api/now-playing/config'(context, _request, res) {
    sendJson(res, 200, { ok: true, data: readNowPlayingConfig(context.settings.get()) });
  },
  async 'POST /api/now-playing/config'(context, request, res) {
    const config = await request.body();
    sendJson(res, 200, { ok: true, data: saveNowPlayingConfig(context, config) });
  },
};

module.exports = { prefixes, routes };
