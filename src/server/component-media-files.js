'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { validateImageBytes } = require('../bilibili/gift/remote-gift-image-cache');
const { sendJson } = require('./http-utils');

const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
const MEDIA_MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm' };
const RESOURCE_MIME = { ...MEDIA_MIME, svg: 'image/svg+xml', woff2: 'font/woff2' };
const MEDIA_URL = /^\/component-media\/([a-f0-9-]{36})\/([a-f0-9]{64}\.(png|jpg|gif|webp|mp4|webm|svg|woff2))$/;
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });

async function receiveMedia(stream, destination, maxBytes = MAX_MEDIA_BYTES) {
  let size = 0;
  const hash = createHash('sha256');
  const bound = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > maxBytes) return callback(Object.assign(new Error('文件超过允许大小，请压缩后重试。'), { statusCode: 413 }));
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(stream, bound, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  if (!size) throw invalid('文件是空的。');
  return { size, digest: hash.digest('hex') };
}

async function identifyMedia(file, extension, { packageResource = false } = {}) {
  const ext = extension.toLowerCase().replace(/^\./, '').replace(/^jpeg$/, 'jpg');
  if (packageResource && ['svg', 'woff2'].includes(ext)) {
    const stat = await fs.promises.stat(file);
    if (stat.size > 1024 * 1024) throw invalid('套装字体或矢量图过大。');
    const bytes = await fs.promises.readFile(file);
    const valid = ext === 'woff2' ? bytes.length >= 48 && bytes.toString('ascii', 0, 4) === 'wOF2'
      : /^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(bytes.toString('utf8')) && !/<!DOCTYPE|<!ENTITY/i.test(bytes.toString('utf8'));
    if (!valid) throw invalid('套装字体或矢量图格式无效。');
    return { extension: ext, kind: ext === 'svg' ? 'image' : 'font' };
  }
  if (!Object.hasOwn(MEDIA_MIME, ext)) throw invalid('请选择 PNG、JPEG、GIF、WebP、MP4 或 WebM 文件。');
  const handle = await fs.promises.open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(64), 0, 64, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const valid = ext === 'mp4' ? bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
      : ext === 'webm' ? bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3
        : validateImageBytes(bytes, `image.${ext}`);
    if (!valid) throw invalid('文件内容与格式不匹配，或文件已损坏。');
    return { extension: ext, kind: ext === 'mp4' || ext === 'webm' ? 'video' : 'image' };
  } finally { await handle.close(); }
}

async function saveMedia(stream, directory, filename, options) {
  await fs.promises.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `${randomUUID()}.part`);
  try {
    const result = await receiveMedia(stream, temporary);
    const type = await identifyMedia(temporary, path.extname(filename), options);
    const basename = `${result.digest}.${type.extension}`;
    const destination = path.join(directory, basename);
    if (!fs.existsSync(destination)) await fs.promises.rename(temporary, destination);
    return { ...result, ...type, basename };
  } finally { await fs.promises.rm(temporary, { force: true }); }
}

async function serveComponentMedia(dataDir, req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, { ok: false, error: '素材仅支持读取。' });
  const match = MEDIA_URL.exec(url.pathname);
  if (!match || !dataDir) return sendJson(res, 404, { ok: false });
  const directory = path.join(path.resolve(dataDir), 'component-library', match[1]);
  const filename = path.join(directory, match[2]);
  let stat;
  try {
    if (!(await fs.promises.lstat(directory)).isDirectory() || (await fs.promises.lstat(directory)).isSymbolicLink()) throw invalid('Invalid directory');
    stat = await fs.promises.lstat(filename);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MEDIA_BYTES) throw invalid('Invalid media');
  } catch { return sendJson(res, 404, { ok: false }); }
  let start = 0; let end = stat.size - 1;
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!range || (!range[1] && !range[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    if (!range[1]) start = Math.max(0, stat.size - Number(range[2]));
    else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end();
    }
  }
  res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': RESOURCE_MIME[match[3]], 'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*', ...(match[3] === 'svg' ? { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" } : {}),
    ...(req.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filename, { start, end });
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

module.exports = { MAX_MEDIA_BYTES, MEDIA_MIME, receiveMedia, identifyMedia, saveMedia, serveComponentMedia };
