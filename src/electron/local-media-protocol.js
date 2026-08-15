'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const MIME_TYPES = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma'
};

function registerLocalMediaProtocol(protocol, isPathAllowedForLocalMedia) {
  protocol.handle('local-media', async function (request) {
    // Parse URL: local-media://media/<base64url-encoded-path>
    let urlPath = '';
    try { urlPath = new URL(request.url).pathname; } catch (_) { return new Response('Bad URL', { status: 400 }); }
    const encoded = urlPath.replace(/^\/+/, '');
    let filePath = '';
    try { filePath = Buffer.from(encoded, 'base64url').toString('utf8'); } catch (_) {
      return new Response('Invalid path encoding', { status: 400 });
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return new Response('File not found', { status: 404 });
    }
    if (!isPathAllowedForLocalMedia(filePath)) {
      return new Response('Forbidden', { status: 403 });
    }

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (_) {
      return new Response('File not found', { status: 404 });
    }
    if (!stat.isFile()) return new Response('Not a file', { status: 404 });
    const fileSize = stat.size;
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

    // 用流式读取替代 readFileSync/readSync，避免大媒体文件卡住主进程。
    const range = parseRange(request.headers.get('range'), fileSize);
    if (range && range.unsatisfiable) {
      return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } });
    }

    if (range) {
      const chunkSize = range.end - range.start + 1;
      const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`,
          'Content-Length': String(chunkSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        }
      });
    }

    const stream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }
    });
  });
}

// 处理 Range 请求：支持 bytes=start-end / bytes=start- / 后缀 bytes=-N；
// 对倒置（start>end）或非法范围返回 null，让调用方回退为完整文件响应。
function parseRange(rangeHeader, fileSize) {
  const text = String(rangeHeader || '').trim();
  if (!text) return null;
  const match = text.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return null;

  let start;
  let end;
  if (!startText) {
    // 后缀范围：最后 N 字节
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    if (fileSize <= 0) return { unsatisfiable: true };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : fileSize - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start > end) return null;
  if (start >= fileSize) return { unsatisfiable: true };
  end = Math.min(end, fileSize - 1);
  return { start, end };
}

module.exports = {
  registerLocalMediaProtocol,
  parseRange
};
