'use strict';

const { readJsonBody, sendJson, validateOrigin } = require('../http-utils');
const { normalizeSceneConfig } = require('../scene-components');
const { createSceneSharedAppearance } = require('../scene-shared-appearance');
const { sceneAppearanceKey } = require('../../../public/js/shared/scene-shared-appearance.js');

async function handleCanvasAppearance(context, req, res, url) {
  res.setHeader('Cache-Control', 'no-store');
  const authorize = () => {
    if (req.aborted || res.destroyed) throw Object.assign(new Error('操作已取消。'), { statusCode: 400 });
    const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
    context.componentPreviews.authorizeCanvasMedia({ id: url.searchParams.get('id'),
      attachmentId: url.searchParams.get('attachmentId') }, token);
  };
  try {
    if (!validateOrigin(req, [url.origin])) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
    authorize();
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
    const body = await readJsonBody(req, 2 * 1024 * 1024);
    authorize();
    const owner = createSceneSharedAppearance(context);
    let data;
    if (body?.action === 'read' && Array.isArray(body.items) && body.items.length <= 100) {
      data = Object.fromEntries(body.items.map(({ type, config }) => {
        const normalized = normalizeSceneConfig(type, config);
        return [sceneAppearanceKey(type, normalized), owner.read(type, normalized)];
      }));
    } else if (body?.action === 'patch') {
      const config = normalizeSceneConfig(body.type, body.config);
      data = owner.patch(body.type, config, body.patch);
      context.broadcastSnapshot('settings');
    } else return sendJson(res, 400, { ok: false, error: '显示参数请求无效。' });
    return sendJson(res, 200, { ok: true, data });
  } catch (error) {
    const status = [400, 403, 404, 409, 410, 413, 503].includes(error.statusCode) ? error.statusCode : 500;
    return sendJson(res, status, { ok: false, error: status === 500 ? '显示参数暂时不可用，请重试。' : error.message });
  }
}

module.exports = { prefixes: [], routes: {}, publicRoutes: { 'POST /api/component-preview/appearance': handleCanvasAppearance }, handleCanvasAppearance };
