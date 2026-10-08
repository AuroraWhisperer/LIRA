'use strict';

const { readJsonBody, sendJson, validateOrigin } = require('../http-utils');
const { normalizeSettingsPatch } = require('../settings-contract');
const { openingStyleSettingsPatch } = require('../../../public/js/shared/opening-settings');
const { routes: openingRoutes, getOpeningConfig } = require('./opening-routes');

async function handleCanvasOpening(context, req, res, url) {
  const authorize = () => {
    if (req.aborted || res.destroyed) throw Object.assign(new Error('操作已取消。'), { statusCode: 400 });
    const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
    context.componentPreviews.authorizeCanvasMedia({ id: url.searchParams.get('id'),
      attachmentId: url.searchParams.get('attachmentId') }, token);
  };
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!validateOrigin(req, [url.origin])) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
    authorize();
    const kind = url.pathname.slice('/api/component-preview/opening/'.length);
    if (!['config', 'character', 'music'].includes(kind)) return sendJson(res, 404, { ok: false });
    if (kind === 'config' && req.method === 'POST') {
      const patch = await readJsonBody(req, 4096);
      authorize();
      let settings;
      try { settings = openingStyleSettingsPatch(url.searchParams.get('style'), patch); }
      catch (error) { return sendJson(res, 400, { ok: false, error: error.message }); }
      const normalized = normalizeSettingsPatch(settings, context.settings.defaults);
      if (normalized.error) return sendJson(res, 400, { ok: false, error: normalized.error });
      context.settings.setMany(normalized.values);
      context.broadcastSnapshot('settings');
      return sendJson(res, 200, { ok: true, data: getOpeningConfig(context) });
    }
    const route = openingRoutes[`${req.method} /api/opening/${kind}`];
    if (!route) return sendJson(res, 405, { ok: false, error: '不支持的开播操作。' });
    return await route(context, { req, query: url.searchParams, authorize }, res);
  } catch (error) {
    const status = [400, 403, 409, 410, 413, 503].includes(error.statusCode) ? error.statusCode : 500;
    return sendJson(res, status, { ok: false, error: status === 500 ? '开播设置暂时不可用，请重试。' : error.message });
  }
}

const publicRoutes = Object.fromEntries(['GET config', 'POST config', 'POST character', 'DELETE character', 'POST music', 'DELETE music']
  .map(entry => { const [method, kind] = entry.split(' '); return [`${method} /api/component-preview/opening/${kind}`, handleCanvasOpening]; }));

module.exports = { prefixes: [], routes: {}, publicRoutes, handleCanvasOpening };
