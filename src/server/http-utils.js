// 编写人：Aurora
// HTTP 请求/响应辅助函数，无业务逻辑。
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJsonBody(req, maxBodyBytes = 0) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    const maxBytes = Number(maxBodyBytes || 0);
    req.on('data', (chunk) => {
      total += chunk.length;
      if (maxBytes > 0 && total > maxBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendCsv(res, filename, content) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store'
  });
  res.end(content);
}

function sendBuffer(res, status, contentTypeValue, filename, content) {
  res.writeHead(status, {
    'Content-Type': contentTypeValue,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': content.length,
    'Cache-Control': 'no-store'
  });
  res.end(content);
}

function servePageOrAsset(publicDir, req, res, requestUrl) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: '请求方法不支持', details: '静态资源仅支持 GET 请求' });
    return;
  }

  const pageMap = new Map([
    ['/', 'admin.html'],
    ['/admin', 'admin.html'],
    ['/settings', 'admin.html'],
    ['/songs', 'admin.html'],
    ['/queue', 'overlay-queue.html'],
    ['/songlist', 'overlay-songs.html'],
    ['/lyrics', 'lyric-window.html']
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
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = { readJsonBody, sendJson, sendCsv, sendBuffer, servePageOrAsset, contentType };
