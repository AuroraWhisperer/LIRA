'use strict';

const { readRawBody, sendJson, validateOrigin } = require('../http-utils');
const { MAX_TEXT_IMAGE_BYTES, storeTextImage } = require('../scene-text-images');
const { GUARD_WISH_GIFTS } = require('../../bilibili/gift/wish-service');

async function handleTextMedia(context, req, res, url, authorize = () => {}) {
  try {
    if (!validateOrigin(req, [url.origin])) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
    authorize();
    let data;
    if (url.pathname.endsWith('/text-image')) {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '上传图片仅支持 POST。' });
      const bytes = await readRawBody(req, MAX_TEXT_IMAGE_BYTES);
      // A slow upload must not survive account changes, revocation or attachment takeover.
      authorize();
      data = storeTextImage(context.system.dataDir, bytes, req.headers['content-type']);
    } else {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '礼物目录仅支持 GET。' });
      const source = url.searchParams.get('source') || 'room';
      if (!['room', 'all'].includes(source)) return sendJson(res, 400, { ok: false, error: '请选择本房间或全部礼物。' });
      const snapshot = await (source === 'all' ? context.overtime.getGlobalGiftCatalog() : context.overtime.getGiftCatalog());
      authorize();
      data = { ...snapshot, gifts: snapshot?.gifts || [], guards: GUARD_WISH_GIFTS };
    }
    return sendJson(res, 200, { ok: true, data });
  } catch (error) {
    const status = [400, 403, 409, 410, 413, 503].includes(error.statusCode) ? error.statusCode : 500;
    return sendJson(res, status, { ok: false, error: status === 500 ? '画布素材暂时不可用，请重试。' : error.message });
  }
}

function handleCanvasTextMedia(context, req, res, url) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
  return handleTextMedia(context, req, res, url, () => context.componentPreviews.authorizeCanvasMedia({
    id: url.searchParams.get('id'), attachmentId: url.searchParams.get('attachmentId'),
  }, token));
}

const protectedRoute = (context, request, res) => handleTextMedia(context, request.req, res,
  new URL(request.req.url, `http://${request.req.headers.host}`));
const routes = {
  'POST /api/scenes/text-image': protectedRoute,
  'GET /api/scenes/text-gifts': protectedRoute,
};
const publicRoutes = {
  'POST /api/component-preview/text-image': handleCanvasTextMedia,
  'GET /api/component-preview/text-gifts': handleCanvasTextMedia,
};

module.exports = { prefixes: ['/api/scenes/'], routes, publicRoutes, handleCanvasTextMedia };
