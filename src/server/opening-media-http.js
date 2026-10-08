'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sendJson, contentType } = require('./http-utils');
const { AUDIO_EXTENSIONS, CHARACTER_EXTENSIONS } = require('./opening-contract');
const { getMusicDir, getCharacterDir } = require('./opening-media-store');

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
  const selected = getCurrentFileName?.();
  const selectedNames = Array.isArray(selected) ? selected : [selected];
  if (!fileName || path.basename(fileName) !== fileName || !selectedNames.includes(fileName)) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const extension = path.extname(fileName).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(extension)) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const filePath = path.join(getMusicDir(dataDir), fileName);
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
  const selected = getCurrentFileName?.();
  const selectedNames = Array.isArray(selected) ? selected : [selected];
  if (!fileName || path.basename(fileName) !== fileName || !selectedNames.includes(fileName)) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const extension = path.extname(fileName).toLowerCase();
  if (!CHARACTER_EXTENSIONS.has(extension)) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const filePath = path.join(getCharacterDir(dataDir), fileName);
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

module.exports = { serveOpeningMedia, serveOpeningCharacter };
