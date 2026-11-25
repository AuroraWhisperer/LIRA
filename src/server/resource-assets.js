'use strict';

const { sendJson, contentType } = require('./http-utils');
const { servePublicFile } = require('./public-asset');

async function serveResourceAsset(resources, req, res, url) {
  const name = url.pathname.replace(/^\/+/, '');
  if (!resources?.isManaged(name) || resources.getState().status === 'idle') return false;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) {
    sendJson(res, 405, { ok: false, error: '请求方法不支持' });
    return true;
  }
  const version = url.searchParams.get('v');
  const filename = await resources.waitForAsset(name, version);
  if (res.destroyed) return true;
  if (!filename) {
    sendJson(res, 404, { ok: false, error: '资源尚未下载' });
    return true;
  }
  await servePublicFile(filename, req, res, contentType(name), version);
  return true;
}

module.exports = { serveResourceAsset };
