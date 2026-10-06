'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateImageBytes } = require('../bilibili/gift/remote-gift-image-cache');
const { sendJson } = require('./http-utils');

const MAX_TEXT_IMAGE_BYTES = 5 * 1024 * 1024;
const TEXT_IMAGE_PREFIX = '/scene-text-images/';
const IMAGE_TYPES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' });
const FILE_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(png|jpg|gif|webp)$/;
const imageDirectory = (dataDir) => path.join(path.resolve(dataDir), 'scene-text-images');

function storeTextImage(dataDir, bytes, contentType) {
  const extension = IMAGE_TYPES[contentType];
  if (!extension || !validateImageBytes(bytes, `image.${extension}`)) {
    throw Object.assign(new Error('请选择有效的 PNG、JPEG、GIF 或 WebP 图片。'), { statusCode: 400 });
  }
  if (bytes.length > MAX_TEXT_IMAGE_BYTES) {
    throw Object.assign(new Error('图片不能超过 5 MiB。'), { statusCode: 413 });
  }
  const directory = imageDirectory(dataDir);
  fs.mkdirSync(directory, { recursive: true });
  const filename = `${crypto.randomUUID()}.${extension}`;
  const destination = path.join(directory, filename);
  const temporary = `${destination}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return { imagePath: `${TEXT_IMAGE_PREFIX}${filename}` };
}

async function serveSceneTextImage(dataDir, req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, { ok: false, error: '图片仅支持 GET 或 HEAD。' });
  const filename = url.pathname.slice(TEXT_IMAGE_PREFIX.length);
  if (!FILE_NAME.test(filename)) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  const file = path.join(imageDirectory(dataDir), filename);
  let bytes;
  try {
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_TEXT_IMAGE_BYTES) throw new Error('Invalid image.');
    bytes = await fs.promises.readFile(file);
    if (bytes.length > MAX_TEXT_IMAGE_BYTES || !validateImageBytes(bytes, filename)) throw new Error('Invalid image.');
  } catch (_) {
    return sendJson(res, 404, { ok: false, error: 'Not found.' });
  }
  const extension = path.extname(filename).slice(1);
  res.writeHead(200, {
    'Content-Type': Object.keys(IMAGE_TYPES).find((type) => IMAGE_TYPES[type] === extension),
    'Content-Length': bytes.length,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

module.exports = { MAX_TEXT_IMAGE_BYTES, TEXT_IMAGE_PREFIX, storeTextImage, serveSceneTextImage };
