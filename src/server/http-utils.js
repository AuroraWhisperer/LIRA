// 编写人：Aurora
// HTTP 请求/响应辅助函数，无业务逻辑。
'use strict';

const { resolveRequestPrincipal } = require('./access-policy');

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
        // Discard pending upload bytes so closing the response does not reset it.
        req.resume();
        // Bound draining for clients that never finish the rejected upload.
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
    ...(status === 413 ? { Connection: 'close', 'Content-Length': Buffer.byteLength(body) } : {}),
  });
  if (status === 413 && res.req && !res.req.complete) {
    // Deliver a complete error body before closing a socket with pending input.
    res.write(body);
    res.req.once('end', () => res.end());
    return;
  }
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
    '.woff2': 'font/woff2',
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
  contentType,
  verifyToken,
  validateRequestHost,
  validateOrigin,
  sendStableError,
};
