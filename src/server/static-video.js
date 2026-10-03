'use strict';

const fs = require('node:fs');

// 仅供已通过 public 路径检查的 WebM 使用；Range 使 Chromium 能回到首帧重播。
function serveStaticVideo(filePath, req, res) {
  fs.stat(filePath, (error, stats) => {
    if (res.destroyed) return;
    if (error || !stats.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const headers = {
      'Content-Type': 'video/webm',
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };
    let start = 0;
    let end = stats.size - 1;
    let status = 200;
    const range = req.method === 'GET' && req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, stats.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      }
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stats.size) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stats.size}`, 'Content-Length': 0 });
        res.end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`;
      headers['Content-Length'] = end - start + 1;
    }
    if (req.method === 'HEAD' || stats.size === 0) {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    const source = fs.createReadStream(filePath, { start, end });
    res.once('close', () => source.destroy());
    source.once('error', () => {
      if (res.headersSent) res.destroy();
      else { res.writeHead(500); res.end(); }
    });
    source.once('open', () => {
      if (res.destroyed) { source.destroy(); return; }
      res.writeHead(status, headers);
      source.pipe(res);
    });
  });
}

module.exports = { serveStaticVideo };
