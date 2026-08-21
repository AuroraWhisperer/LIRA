// 编写人：Aurora
// HTTP 请求/响应辅助函数，无业务逻辑。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { composeAdminHtml, isAdminPageRoute } = require('./admin-page');

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

function verifyToken(context, req, requestUrl) {
  const token = context.sessionToken;
  if (!token) return true; // 未启用 token 时不拦截（向后兼容）
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ') && authHeader.slice(7) === token) return true;
  const queryToken = requestUrl.searchParams.get('token');
  if (queryToken === token) return true;
  return false;
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

function servePageOrAsset(publicDir, req, res, requestUrl, injectToken) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: '请求方法不支持', details: '静态资源仅支持 GET 请求' });
    return;
  }

  const isAdminPage = isAdminPageRoute(requestUrl.pathname);
  const pageMap = new Map([
    ['/queue', 'pages/overlays/queue.html'],
    ['/songlist', 'pages/overlays/songs.html'],
    ['/blindbox', 'pages/overlays/blindbox.html'],
    ['/overtime', 'pages/overlays/overtime.html'],
    ['/gift-effects', 'pages/overlays/gift-effects.html'],
    ['/lyrics', 'pages/overlays/lyric-window.html'],
    ['/games', 'pages/overlays/games.html'],
    ['/wheel', 'pages/overlays/wheel.html'],
    ['/opening', 'pages/overlays/opening.html']
  ]);
  const assetPath = pageMap.get(requestUrl.pathname)
    || requestUrl.pathname.replace(/^\/+/, '');
  const resolvedPath = isAdminPage
    ? path.join(publicDir, 'pages', 'admin', 'shell-start.html')
    : path.resolve(publicDir, assetPath);
  if (!isAdminPage && resolvedPath !== publicDir && !resolvedPath.startsWith(publicDir + path.sep)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden.' });
    return;
  }

  const sendContent = (error, content) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }
    let body = content;
    if (injectToken && typeof injectToken === 'string' && injectToken.length > 0
        && resolvedPath.endsWith('.html')) {
      const tokenScript = Buffer.from(
        `\n<script>(function(){` +
        `var t=${JSON.stringify(injectToken)};window.__API_TOKEN__=t;` +
        // Native anchor navigation cannot carry an Authorization header.
        `var patchApiAnchors=function(){` +
        `var links=document.querySelectorAll("a[href]");` +
        `for(var i=0;i<links.length;i++){var a=links[i],h=a.getAttribute("href");` +
        `if(typeof h!=="string")continue;var u;try{u=new URL(h,location.href);}catch(_){continue;}` +
        `if(u.origin===location.origin&&u.pathname.startsWith("/api/")&&!u.searchParams.has("token")){` +
        `u.searchParams.set("token",t);a.setAttribute("href",h.startsWith("/")?u.pathname+u.search+u.hash:u.href);}}};` +
        `if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",patchApiAnchors,{once:true});` +
        `else patchApiAnchors();` +
        // Patch fetch to auto-add Authorization header
        `var _fetch=window.fetch;` +
        `window.fetch=function(u,o){o=o||{};o.headers=o.headers||{};` +
        `if(typeof u==="string"&&u.startsWith("/api/")&&u!=="/api/health"&&!o.headers.Authorization&&!o.headers.authorization)` +
        `{o.headers=new Headers(o.headers);o.headers.set("Authorization","Bearer "+t);}` +
        `return _fetch.call(this,u,o);};` +
        // Patch WebSocket to append ?token= for /ws connections
        `var _WS=window.WebSocket;` +
        `window.WebSocket=function(u,p){` +
        `if(typeof u==="string"&&u.indexOf("/ws")!==-1&&u.indexOf("?token=")===-1)` +
        `{u=u+(u.indexOf("?")===-1?"?":"&")+"token="+encodeURIComponent(t);}` +
        `return p?new _WS(u,p):new _WS(u);};` +
        `window.WebSocket.prototype=_WS.prototype;` +
        `window.WebSocket.CONNECTING=_WS.CONNECTING;` +
        `window.WebSocket.OPEN=_WS.OPEN;` +
        `window.WebSocket.CLOSING=_WS.CLOSING;` +
        `window.WebSocket.CLOSED=_WS.CLOSED;` +
        `})();</script>\n`
      );
      const headEnd = body.indexOf(Buffer.from('</head>'));
      if (headEnd !== -1) {
        body = Buffer.concat([body.subarray(0, headEnd), tokenScript, body.subarray(headEnd)]);
      }
    }

    // Add frame protection headers for HTML pages before writeHead
    if (resolvedPath.endsWith('.html')) {
      addFrameProtectionHeaders(res, requestUrl.pathname);
    }

    res.writeHead(200, {
      'Content-Type': contentType(resolvedPath),
      'Cache-Control': 'no-store'
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
    '.ico': 'image/x-icon'
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
  return allowedOrigins.some(allowed => origin === allowed);
}

function addFrameProtectionHeaders(res, pathname) {
  // Exclude overlay pages - they need to be frameable for OBS
  const overlayPaths = ['/queue', '/songlist', '/blindbox', '/overtime', '/gift-effects', '/lyrics', '/games', '/wheel', '/opening'];
  const isOverlay = overlayPaths.includes(pathname);

  if (!isOverlay) {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
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
    sendJson(res, 400, { ok: false, error: 'Request body must be valid JSON.' });
    return;
  }

  if (message === 'Request body is too large.' || message.includes('too large')) {
    sendJson(res, 413, { ok: false, error: 'Request body exceeds size limit.' });
    return;
  }

  // Default: stable 500 without internal details
  sendJson(res, 500, { ok: false, error: 'Internal server error.' });
}

module.exports = {
  readJsonBody,
  sendJson,
  sendCsv,
  sendBuffer,
  servePageOrAsset,
  contentType,
  verifyToken,
  validateRequestHost,
  validateOrigin,
  addFrameProtectionHeaders,
  sendStableError
};
