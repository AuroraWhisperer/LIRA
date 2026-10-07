'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { sendJson } = require('./http-utils');

const MAX_WEB_BYTES = 512 * 1024 * 1024;
const WEB_MIME = Object.freeze({ html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
  wav: 'audio/wav', ogg: 'audio/ogg', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' });
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });

function webFilePath(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\\:*?"<>|\u0000-\u001f]/.test(value)
    || value.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw invalid('素材路径无效；请使用素材目录内的相对路径。');
  const extension = path.posix.extname(value).slice(1).toLowerCase();
  if (!Object.hasOwn(WEB_MIME, extension)) throw invalid(`不支持的网页资源格式：${value.slice(0, 100)}`);
  return value;
}

function webResourceUrl(id, filename) {
  return `/component-web/${id}/${webFilePath(filename).split('/').map(encodeURIComponent).join('/')}`;
}

async function saveWebFiles(directory, files) {
  const names = new Set();
  let bytes = 0;
  for await (const file of files) {
    const name = webFilePath(file.path);
    if (names.has(name.toLowerCase()) || names.size >= 1024) throw invalid('网页资源重复，或文件数量超过 1024。');
    names.add(name.toLowerCase());
    const destination = path.join(directory, ...name.split('/'));
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    let size = 0;
    await pipeline(file.stream, new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length; size += chunk.length;
      if (bytes > MAX_WEB_BYTES || (/\.(html?|css|js|mjs|json)$/i.test(name) && size > 4 * 1024 * 1024)) return done(invalid('网页素材过大；整套最多 512 MiB，代码文件最多 4 MiB。'));
      done(null, chunk);
    } }), fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  }
  if (!names.size) throw invalid('没有可导入的网页文件。');
  return { bytes, names };
}

async function* readWebUpload(stream) {
  // A bounded JSON line describes the files; binary payloads follow in that order.
  const iterator = stream[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0);
  async function more() {
    const next = await iterator.next();
    if (next.done) throw invalid('网页素材上传不完整。');
    buffer = Buffer.concat([buffer, next.value]);
  }
  while (!buffer.includes(10)) { if (buffer.length > 256 * 1024) throw invalid('网页文件清单过大。'); await more(); }
  const end = buffer.indexOf(10);
  if (end > 256 * 1024) throw invalid('网页文件清单过大。');
  const files = JSON.parse(buffer.subarray(0, end).toString('utf8'));
  buffer = buffer.subarray(end + 1);
  if (!Array.isArray(files) || !files.length || files.length > 1024) throw invalid('网页文件清单无效。');
  let total = 0;
  for (const file of files) {
    webFilePath(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || (total += file.size) > MAX_WEB_BYTES) throw invalid('网页素材大小无效或超过 512 MiB。');
  }
  for (const file of files) {
    let remaining = file.size;
    async function* content() {
      while (remaining) {
        if (!buffer.length) await more();
        const size = Math.min(remaining, buffer.length);
        const chunk = buffer.subarray(0, size); buffer = buffer.subarray(size); remaining -= size;
        yield chunk;
      }
    }
    yield { path: file.path, stream: content() };
    if (remaining) throw invalid('网页素材未完整读取。');
  }
  if (buffer.length || !(await iterator.next()).done) throw invalid('网页素材包含清单之外的内容。');
}

async function serveComponentWeb(dataDir, req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, { ok: false });
  const match = /^\/component-web\/([a-f0-9-]{36})\/(.+)$/.exec(url.pathname);
  if (!match || !dataDir) return sendJson(res, 404, { ok: false });
  let filename; let stat; let extension;
  try {
    const relative = webFilePath(decodeURIComponent(match[2]));
    extension = path.extname(relative).slice(1).toLowerCase();
    filename = path.join(path.resolve(dataDir), 'component-library');
    for (const part of [match[1], 'web', ...relative.split('/')]) {
      filename = path.join(filename, part);
      stat = await fs.promises.lstat(filename);
      if (stat.isSymbolicLink()) throw invalid('Invalid resource');
    }
    if (!stat.isFile() || stat.size > MAX_WEB_BYTES) throw invalid('Invalid resource');
  } catch { return sendJson(res, 404, { ok: false }); }
  res.writeHead(200, { 'Content-Type': WEB_MIME[extension], 'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable',
    'Referrer-Policy': 'no-referrer',
    ...(['html', 'htm', 'svg'].includes(extension) ? { 'Content-Security-Policy': "sandbox allow-scripts; object-src 'none'; form-action 'none'" } : {}) });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filename);
  res.on('close', () => stream.destroy()); stream.on('error', () => res.destroy()); stream.pipe(res);
}

module.exports = { WEB_MIME, MAX_WEB_BYTES, webFilePath, webResourceUrl, saveWebFiles, readWebUpload, serveComponentWeb };
