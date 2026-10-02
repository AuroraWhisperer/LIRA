'use strict';

const { readJsonBody, sendJson, verifyToken } = require('../http-utils');
const { MAX_PREVIEW_REQUEST_BYTES } = require('../component-preview-sessions');

async function handleComponentPreview(context, req, res, url) {
  const sessions = context.componentPreviews;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '预览接口仅支持 POST。' });
  if (req.headers.origin === 'null') return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
  try {
    const body = await readJsonBody(req, MAX_PREVIEW_REQUEST_BYTES);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendJson(res, 400, { ok: false, error: '预览请求无效。' });
    }
    let data;
    if (['open', 'exchange', 'revoke'].includes(body.action)) {
      if (!verifyToken(context, req, url)) return sendJson(res, 401, { ok: false, error: '请从客户端打开预览。' });
      data = body.action === 'open' ? sessions.open(body) : body.action === 'exchange'
        ? sessions.exchange(body) : { closed: sessions.revoke(body.id) };
    } else {
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
      data = sessions.browser(body, token);
    }
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: error.statusCode ? error.message : '预览请求无效。' });
  }
}

module.exports = { prefixes: ['/api/component-preview'], routes: {},
  publicRoutes: { 'POST /api/component-preview': handleComponentPreview }, handleComponentPreview };
