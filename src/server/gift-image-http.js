'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveDataPaths } = require('../shared/data-paths');
const { isSafeBasename, MAX_IMAGE_BYTES, validateImageBytes } = require('../bilibili/gift/remote-gift-image-cache');
const { sendJson, contentType } = require('./http-utils');

async function serveOvertimeGiftImage(dataDir, req, res, requestUrl, ensureImage) {
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
  let bytes = await readImage(filePath);
  if (!bytes && req.method === 'GET' && ensureImage) {
    const readyPath = await ensureImage(requestUrl.pathname);
    if (res.destroyed) return;
    if (readyPath && readyPath !== requestUrl.pathname && readyPath.startsWith('/overtime-gift-images/')
      && isSafeBasename(readyPath.slice('/overtime-gift-images/'.length))) {
      // Do not cache an older fallback under the new artwork's immutable URL.
      res.writeHead(302, { Location: readyPath, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    if (readyPath) bytes = await readImage(filePath);
  }
  if (!bytes) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Content-Length': bytes.length,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(bytes);
}

async function readImage(filePath) {
  try {
    const stats = await fs.promises.lstat(filePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) return null;
    const bytes = await fs.promises.readFile(filePath);
    if (!validateImageBytes(bytes, path.basename(filePath))) return null;
    if (Date.now() - stats.mtimeMs > 86400000) {
      await fs.promises.utimes(filePath, stats.atime, new Date()).catch(() => {});
    }
    return bytes;
  } catch { return null; }
}

module.exports = { serveOvertimeGiftImage };
