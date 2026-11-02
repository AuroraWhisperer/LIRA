'use strict';

const fs = require('node:fs/promises');
const { sendJson, contentType } = require('./http-utils');

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
  const filename = await resources.waitForAsset(name, url.searchParams.get('v'));
  if (res.destroyed) return true;
  if (!filename) {
    sendJson(res, 404, { ok: false, error: '资源尚未下载' });
    return true;
  }
  try {
    const body = req.method === 'HEAD' ? null : await fs.readFile(filename);
    const size = body ? body.length : (await fs.stat(filename)).size;
    res.writeHead(200, { 'Content-Type': contentType(name), 'Content-Length': size });
    res.end(body);
  } catch { sendJson(res, 404, { ok: false, error: '资源暂不可用' }); }
  return true;
}

module.exports = { serveResourceAsset };
