'use strict';

const { ready, QMC2 } = require('@clamber_l/crypto');

const MAX_UPSTREAM_BYTES = 64 * 1024 * 1024;
const QQ_MEDIA_HOSTS = new Set([
  'isure.stream.qqmusic.qq.com',
  'ws.stream.qqmusic.qq.com',
  'dl.stream.qqmusic.qq.com',
  'streamoc.music.tc.qq.com',
  'aqqmusic.tc.qq.com',
]);

function parseRange(value) {
  const match = /^bytes=(\d+)-(\d*)$/i.exec(String(value || '').trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : null;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    (end != null && (!Number.isSafeInteger(end) || end < start))
  ) {
    return null;
  }
  return { start, end };
}

function validateMediaUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch (_) {
    throw new Error('QQ 加密媒体地址无效。');
  }
  if (
    url.protocol !== 'https:' ||
    !QQ_MEDIA_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new Error('QQ 加密媒体地址不在允许的 CDN 范围内。');
  }
  return url;
}

async function serveQQEncryptedStream(record, req, res, options = {}) {
  if (!record || Number(record.expiresAt) <= Date.now()) {
    sendError(res, 404, '加密播放会话已过期，请重新解析歌曲。');
    return;
  }
  const mediaUrl = validateMediaUrl(record.url);
  const range = parseRange(req && req.headers && req.headers.range);
  const headers = { Accept: '*/*' };
  if (range)
    headers.Range = `bytes=${range.start}-${range.end == null ? '' : range.end}`;

  const fetchImpl = options.fetchImpl || fetch;
  const upstream = await fetchImpl(mediaUrl, { headers, redirect: 'follow' });
  try {
    validateMediaUrl(upstream.url || mediaUrl);
  } catch (_) {
    sendError(res, 502, 'QQ 加密媒体重定向到了不受支持的地址。');
    return;
  }
  if (!upstream.ok && upstream.status !== 206) {
    sendError(
      res,
      upstream.status === 416 ? 416 : 502,
      'QQ 加密媒体暂时不可用。',
    );
    return;
  }
  const contentLength = Number(upstream.headers.get('content-length') || 0);
  if (contentLength > MAX_UPSTREAM_BYTES) {
    sendError(res, 502, 'QQ 加密媒体响应过大。');
    return;
  }

  await ready;
  const cipher = new QMC2(String(record.ekey || ''));
  const startOffset = range ? range.start : 0;
  const responseHeaders = {
    'Content-Type':
      record.contentType ||
      (record.family === 'Q0' ? 'audio/flac' : 'audio/ogg'),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name);
    if (value)
      responseHeaders[name.replace(/^[a-z]/, (char) => char.toUpperCase())] =
        value;
  }
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) responseHeaders['Content-Range'] = contentRange;
  res.writeHead(upstream.status === 206 ? 206 : 200, responseHeaders);

  try {
    if (!upstream.body) return res.end();
    let offset = startOffset;
    for await (const chunk of upstream.body) {
      const buffer = Buffer.from(chunk);
      cipher.decrypt(buffer, offset);
      offset += buffer.length;
      res.write(buffer);
    }
    res.end();
  } catch (error) {
    if (!res.destroyed) res.destroy(error);
  } finally {
    cipher.free();
  }
}

function sendError(res, status, message) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ ok: false, error: message }));
}

module.exports = { parseRange, serveQQEncryptedStream, validateMediaUrl };
