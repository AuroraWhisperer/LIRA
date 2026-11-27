'use strict';

const { sendJson } = require('../http-utils');
const { readNowPlayingConfig, saveNowPlayingConfig, patchNowPlayingConfig } = require('../now-playing-settings');

const prefixes = ['/api/now-playing'];
const routes = {
  'GET /api/now-playing/config'(context, _request, res) {
    sendJson(res, 200, { ok: true, data: readNowPlayingConfig(context.settings.get()) });
  },
  async 'POST /api/now-playing/config'(context, request, res) {
    const body = await request.body();
    const isPatch = body && Object.hasOwn(body, 'patch') && Object.keys(body).length === 1;
    const data = isPatch ? patchNowPlayingConfig(context, body.patch) : saveNowPlayingConfig(context, body);
    sendJson(res, 200, { ok: true, data });
  },
};

module.exports = { prefixes, routes };
