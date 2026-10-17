'use strict';

const { sendJson } = require('./http-utils');

async function serveFontAsset(library, req, res, url) {
  const stylesheet = url.pathname === '/css/shared/display-fonts.css';
  const status = url.pathname === '/font-library/status';
  const match = /^\/font-library\/([a-z0-9-]+)$/.exec(url.pathname);
  if (!library || !stylesheet && !match) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) {
    sendJson(res, 405, { ok: false, error: '请求方法不支持' });
    return true;
  }
  if (status) {
    const snapshot = library.getState();
    if (req.method === 'HEAD') { res.writeHead(200); res.end(); }
    else sendJson(res, 200, { status: snapshot.status, completed: snapshot.completed, completedAt: snapshot.completedAt });
    return true;
  }
  const font = stylesheet ? null : await library.readFont(match[1]);
  if (!stylesheet && !font) {
    sendJson(res, 404, { ok: false, error: '字体尚未下载' });
    return true;
  }
  const body = stylesheet ? Buffer.from(library.stylesheet()) : font.bytes;
  res.writeHead(200, {
    'Content-Type': stylesheet ? 'text/css; charset=utf-8' : `font/${font.format}`,
    'Content-Length': body.length,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

module.exports = { serveFontAsset };
