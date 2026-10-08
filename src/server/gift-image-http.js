'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveDataPaths } = require('../shared/data-paths');
const { isSafeBasename, MAX_IMAGE_BYTES, validateImageBytes } = require('../bilibili/gift/remote-gift-image-cache');
const { sendJson, contentType } = require('./http-utils');

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
        'Access-Control-Allow-Origin': '*',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(bytes);
    });
  });
}

module.exports = { serveOvertimeGiftImage };
