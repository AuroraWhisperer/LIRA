// 编写人：Aurora
// HTTP 请求/响应辅助函数，无业务逻辑。
'use strict';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8')
  });
  res.end(body);
}

function sendCsv(res, filename, content) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`
  });
  res.end(content);
}

function sendBuffer(res, status, contentTypeValue, filename, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  res.writeHead(status, {
    'Content-Type': contentTypeValue,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length
  });
  res.end(buffer);
}

function servePageOrAsset(publicDir, req, res, requestUrl) {
  const fs = require('node:fs');
  const path = require('node:path');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  const pageMap = new Map([
    ['/', 'admin.html'],
    ['/admin', 'admin.html'],
    ['/settings', 'admin.html'],
    ['/songs', 'admin.html'],
    ['/queue', 'overlay-queue.html'],
    ['/songlist', 'overlay-songs.html']
  ]);
  const assetPath = pageMap.get(requestUrl.pathname)
    || requestUrl.pathname.replace(/^\/+/, '');
  const resolvedPath = path.resolve(publicDir, assetPath);
  if (!resolvedPath.startsWith(publicDir)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden.' });
    return;
  }

  fs.readFile(resolvedPath, (error, content) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType(resolvedPath),
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(content);
    }
  });
}

function contentType(filePath) {
  const ext = require('node:path').extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = { readJsonBody, sendJson, sendCsv, sendBuffer, servePageOrAsset };
