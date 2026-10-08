// 开播动画配置与本地媒体上传的 HTTP 入口。
'use strict';

const { sendJson } = require('../http-utils');
const { getOpeningConfig, resolveOpeningMediaSlot, saveOpeningMedia, clearOpeningMedia } = require('../opening-service');
const { readOpeningUpload, OPENING_UPLOAD_ERRORS } = require('../opening-upload');

const prefixes = ['/api/opening'];

async function uploadMedia(context, request, res, kind) {
  const slot = resolveOpeningMediaSlot(kind, request.query?.get('style') ?? undefined);
  if (!slot) return sendJson(res, 400, { ok: false, error: '不支持的开播动画样式。' });
  const upload = await readOpeningUpload(request.req, kind);
  request.authorize?.();
  if (!upload) return sendJson(res, 400, { ok: false, error: OPENING_UPLOAD_ERRORS[kind] });
  sendJson(res, 200, { ok: true, data: saveOpeningMedia(context, slot, upload) });
}

function clearMedia(context, request, res, kind) {
  const slot = resolveOpeningMediaSlot(kind, request.query?.get('style') ?? undefined);
  if (!slot) return sendJson(res, 400, { ok: false, error: '不支持的开播动画样式。' });
  sendJson(res, 200, { ok: true, data: clearOpeningMedia(context, slot) });
}

const routes = {
  async 'GET /api/opening/config'(context, _request, res) {
    sendJson(res, 200, { ok: true, data: getOpeningConfig(context) });
  },
  async 'POST /api/opening/music'(context, request, res) {
    return uploadMedia(context, request, res, 'music');
  },
  async 'DELETE /api/opening/music'(context, request, res) {
    return clearMedia(context, request, res, 'music');
  },
  async 'POST /api/opening/character'(context, request, res) {
    return uploadMedia(context, request, res, 'character');
  },
  async 'DELETE /api/opening/character'(context, request, res) {
    return clearMedia(context, request, res, 'character');
  },
};

module.exports = { prefixes, routes };
