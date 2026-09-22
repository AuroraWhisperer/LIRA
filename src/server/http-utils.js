// 编写人：Aurora
// HTTP 请求/响应辅助函数，无业务逻辑。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveDataPaths } = require('../shared/data-paths');
const { composeAdminHtml, isAdminPageRoute } = require('./admin-page');
const { OVERLAY_PAGES, getOverlayScope, createOverlayToken, resolveRequestPrincipal } = require('./access-policy');
const { createOverlayBootstrap } = require('./overlay-bootstrap');
const { isSafeBasename, MAX_IMAGE_BYTES, validateImageBytes } = require('../bilibili/gift/remote-gift-image-cache');

function readJsonBody(req, maxBodyBytes = 0) {
  return readRawBody(req, maxBodyBytes).then((body) => {
    if (body.length === 0) return {};
    try {
      return JSON.parse(body.toString('utf8'));
    } catch (_) {
      throw new Error('Invalid JSON body.');
    }
  });
}

function readRawBody(req, maxBodyBytes = 0) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    const maxBytes = Number(maxBodyBytes || 0);
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (maxBytes > 0 && total > maxBytes) {
        settled = true;
        chunks.length = 0;
        req.pause();
        // Let the error response flush before reclaiming an unfinished upload.
        const closeTimer = setTimeout(() => req.destroy(), 1000);
        closeTimer.unref();
        req.once('close', () => clearTimeout(closeTimer));
        reject(
          Object.assign(new Error('Request body is too large.'), {
            code: 'REQUEST_BODY_TOO_LARGE',
            statusCode: 413,
          }),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(status === 413 ? { Connection: 'close' } : {}),
  });
  res.end(body);
}

function verifyToken(context, req, requestUrl) {
  return req.headers?.origin !== 'null' && resolveRequestPrincipal(context, req, requestUrl)?.type === 'admin';
}

function sendCsv(res, filename, content) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(content);
}

function sendBuffer(res, status, contentTypeValue, filename, content) {
  res.writeHead(status, {
    'Content-Type': contentTypeValue,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
  });
  res.end(content);
}

function servePageOrAsset(publicDir, req, res, requestUrl, sessionToken, beginPlaybackSnapshotSession) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, {
      ok: false,
      error: '请求方法不支持',
      details: '静态资源仅支持 GET 请求',
    });
    return;
  }

  const isAdminPage = isAdminPageRoute(requestUrl.pathname);
  const pageMap = new Map([
    ['/license', 'pages/license.html'],
    ...Object.entries(OVERLAY_PAGES).map(([scope, file]) => [`/${scope}`, `pages/overlays/${file}`]),
  ]);
  const assetPath = pageMap.get(requestUrl.pathname) || requestUrl.pathname.replace(/^\/+/, '');
  const resolvedPath = isAdminPage
    ? path.join(publicDir, 'pages', 'admin', 'shell-start.html')
    : path.resolve(publicDir, assetPath);
  if (
    assetPath.includes(':') ||
    (!isAdminPage && resolvedPath !== publicDir && !resolvedPath.startsWith(publicDir + path.sep))
  ) {
    sendJson(res, 403, { ok: false, error: 'Forbidden.' });
    return;
  }

  const relativePath = path.relative(publicDir, resolvedPath).replaceAll('\\', '/').toLowerCase();
  const isHtml = path.extname(resolvedPath).toLowerCase() === '.html';
  const overlayScope = getOverlayScope(`/${relativePath}`);
  if (
    isHtml &&
    !overlayScope &&
    relativePath !== 'pages/license.html' &&
    !verifyToken({ sessionToken }, req, requestUrl)
  ) {
    sendJson(res, 401, { ok: false, error: '请从桌面应用打开管理页面。' });
    return;
  }

  const sendContent = (error, content) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }
    let body = content;
    if (isAdminPage && req.method === 'GET' && beginPlaybackSnapshotSession) {
      const writer = beginPlaybackSnapshotSession();
      const headEnd = body.indexOf(Buffer.from('</head>'));
      const bootstrap = Buffer.from(
        `<script>window.__PLAYBACK_SNAPSHOT_WRITER__=${JSON.stringify(writer)};</script>\n`,
      );
      body = Buffer.concat([body.subarray(0, headEnd), bootstrap, body.subarray(headEnd)]);
    }
    if (overlayScope && sessionToken) {
      const bootstrap = Buffer.from(createOverlayBootstrap(createOverlayToken(sessionToken, overlayScope)));
      const headEnd = body.indexOf(Buffer.from('</head>'));
      if (headEnd !== -1) {
        body = Buffer.concat([body.subarray(0, headEnd), bootstrap, body.subarray(headEnd)]);
      }
    }

    if (isHtml) {
      addFrameProtectionHeaders(res, overlayScope ? `/${overlayScope}` : requestUrl.pathname);
    } else {
      // Sandboxed overlays have opaque origins. Only public static assets may
      // be read cross-origin; API data and HTML use their own access policy.
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.writeHead(200, {
      'Content-Type': contentType(resolvedPath),
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(body);
    }
  };

  if (isAdminPage) {
    try {
      sendContent(null, Buffer.from(composeAdminHtml(publicDir)));
    } catch (error) {
      sendContent(error);
    }
    return;
  }

  fs.readFile(resolvedPath, sendContent);
}

function serveOpeningMedia(dataDir, req, res, requestUrl, getCurrentFileName) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, {
      ok: false,
      error: '请求方法不支持',
      details: '开播音乐仅支持 GET 请求',
    });
    return;
  }
  const encodedName = requestUrl.pathname.slice('/opening-media/'.length);
  let fileName = '';
  try {
    fileName = decodeURIComponent(encodedName);
  } catch (_) {
    fileName = '';
  }
  if (!fileName || path.basename(fileName) !== fileName || fileName !== String(getCurrentFileName?.() || '')) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const extension = path.extname(fileName).toLowerCase();
  if (!new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma']).has(extension)) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const filePath = path.join(path.resolve(String(dataDir || '')), 'opening-music', fileName);
  serveOpeningFile(filePath, req, res);
}

function serveOpeningCharacter(dataDir, req, res, requestUrl, getCurrentFileName) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, {
      ok: false,
      error: '请求方法不支持',
      details: '开播人物图仅支持 GET 请求',
    });
    return;
  }
  const encodedName = requestUrl.pathname.slice('/opening-character/'.length);
  let fileName = '';
  try {
    fileName = decodeURIComponent(encodedName);
  } catch (_) {
    fileName = '';
  }
  if (!fileName || path.basename(fileName) !== fileName || fileName !== String(getCurrentFileName?.() || '')) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const extension = path.extname(fileName).toLowerCase();
  if (!new Set(['.png', '.jpg', '.jpeg', '.webp']).has(extension)) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const filePath = path.join(path.resolve(String(dataDir || '')), 'opening-character', fileName);
  serveOpeningFile(filePath, req, res);
}

function serveOpeningFile(filePath, req, res) {
  fs.stat(filePath, (statError, stats) => {
    if (res.destroyed) return;
    if (statError || !stats.isFile()) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }
    const headers = {
      'Content-Type': contentType(filePath),
      'Content-Length': stats.size,
      'Cache-Control': 'no-store',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    const source = fs.createReadStream(filePath);
    source.on('error', (error) => {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const missing = error.code === 'ENOENT' || error.code === 'ENOTDIR';
      sendJson(res, missing ? 404 : 500, {
        ok: false,
        error: missing ? 'Not found.' : 'Internal server error.',
      });
    });
    res.once('close', () => source.destroy());
    source.once('open', () => {
      if (res.destroyed) {
        source.destroy();
        return;
      }
      res.writeHead(200, headers);
      source.pipe(res);
    });
  });
}

function serveOvertimeGiftImage(dataDir, req, res, requestUrl) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, {
      ok: false,
      error: '请求方法不支持',
      details: '加班礼物图片仅支持 GET 请求',
    });
    return;
  }
  const encodedName = requestUrl.pathname.slice('/overtime-gift-images/'.length);
  if (!isSafeBasename(encodedName)) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const filePath = path.join(resolveDataPaths(String(dataDir || '')).giftImagesDir, encodedName);
  fs.lstat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }
    if (stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }
    fs.readFile(filePath, (readError, bytes) => {
      const basename = path.basename(filePath);
      if (readError || !validateImageBytes(bytes, basename)) {
        sendJson(res, 404, { ok: false, error: 'Not found.' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType(filePath),
        'Content-Length': bytes.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(bytes);
    });
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
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.wma': 'audio/x-ms-wma',
    '.ico': 'image/x-icon',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function validateRequestHost(req, runtimeBaseUrl) {
  const requestHost = req.headers.host;
  if (!requestHost) return false;

  const trustedUrl = new URL(runtimeBaseUrl);
  const trustedHostPort = trustedUrl.host; // includes port

  return requestHost === trustedHostPort;
}

function validateOrigin(req, allowedOrigins) {
  const origin = req.headers.origin;

  // No Origin header means non-browser request (e.g., curl, health check)
  if (!origin) return true;

  // Check against allowed origins
  return allowedOrigins.some((allowed) => origin === allowed);
}

function addFrameProtectionHeaders(res, pathname) {
  if (getOverlayScope(pathname)) {
    // Do not add allow-same-origin: an embedded overlay must not call the
    // privileged parent frame or inherit its credentials.
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
  } else {
    // Chromium can attribute a dedicated worker's fetch to its owning main
    // frame. Management pages have no workers; block their creation explicitly.
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; worker-src 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
  }
}

/**
 * Sends a stable error response that maps internal errors to fixed client-facing messages.
 * Prevents internal details (stack traces, file paths) from leaking.
 * @param {http.ServerResponse} res - Response object
 * @param {Error} error - Error to map
 */
function sendStableError(res, error) {
  const message = error?.message || '';

  // Map known error patterns to stable 4xx responses
  if (message === 'Invalid JSON body.' || message.includes('JSON')) {
    sendJson(res, 400, {
      ok: false,
      error: 'Request body must be valid JSON.',
    });
    return;
  }

  if (message === 'Request body is too large.' || message.includes('too large')) {
    sendJson(res, 413, {
      ok: false,
      error: 'Request body exceeds size limit.',
    });
    return;
  }

  if (error?.statusCode === 400) {
    sendJson(res, 400, { ok: false, error: 'Invalid request parameters.' });
    return;
  }

  // Default: stable 500 without internal details
  sendJson(res, 500, { ok: false, error: 'Internal server error.' });
}

module.exports = {
  readJsonBody,
  readRawBody,
  sendJson,
  sendCsv,
  sendBuffer,
  servePageOrAsset,
  serveOpeningMedia,
  serveOpeningCharacter,
  serveOvertimeGiftImage,
  contentType,
  verifyToken,
  validateRequestHost,
  validateOrigin,
  addFrameProtectionHeaders,
  sendStableError,
};
