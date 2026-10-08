'use strict';

const { readJsonBody, sendJson, validateOrigin } = require('../http-utils');
const { getOpeningConfig, resolveOpeningMediaSlot, saveOpeningMedia,
  clearOpeningMedia, updateOpeningStyleSettings } = require('../opening-service');
const { readOpeningUpload, OPENING_UPLOAD_ERRORS } = require('../opening-upload');

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
      const data = updateOpeningStyleSettings(context, url.searchParams.get('style'), patch);
      return sendJson(res, 200, { ok: true, data });
    }
    if (kind === 'config' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, data: getOpeningConfig(context) });
    }
    if (kind === 'config' || !['POST', 'DELETE'].includes(req.method)) {
      return sendJson(res, 405, { ok: false, error: '不支持的开播操作。' });
    }
    const slot = resolveOpeningMediaSlot(kind, url.searchParams.get('style') ?? undefined);
    if (!slot) return sendJson(res, 400, { ok: false, error: '不支持的开播动画样式。' });
    if (req.method === 'DELETE') {
      return sendJson(res, 200, { ok: true, data: clearOpeningMedia(context, slot) });
    }
    const upload = await readOpeningUpload(req, kind);
    authorize();
    if (!upload) return sendJson(res, 400, { ok: false, error: OPENING_UPLOAD_ERRORS[kind] });
    return sendJson(res, 200, { ok: true, data: saveOpeningMedia(context, slot, upload) });
  } catch (error) {
    const status = [400, 403, 409, 410, 413, 503].includes(error.statusCode) ? error.statusCode : 500;
    return sendJson(res, status, { ok: false, error: status === 500 ? '开播设置暂时不可用，请重试。' : error.message });
  }
}

const publicRoutes = Object.fromEntries(['GET config', 'POST config', 'POST character', 'DELETE character', 'POST music', 'DELETE music']
  .map(entry => { const [method, kind] = entry.split(' '); return [`${method} /api/component-preview/opening/${kind}`, handleCanvasOpening]; }));

module.exports = { prefixes: [], routes: {}, publicRoutes, handleCanvasOpening };
