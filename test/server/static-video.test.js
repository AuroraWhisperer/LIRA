'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { servePageOrAsset } = require('../../src/server/http-utils');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

test('public WebM supports repeated byte ranges, HEAD, suffixes and rejected out-of-bounds ranges', async (t) => {
  const scratch = createScratchDirectory('static-video-');
  const bytes = Buffer.from('0123456789abcdefghij');
  fs.writeFileSync(path.join(scratch, 'effect.webm'), bytes);
  const server = http.createServer((req, res) => servePageOrAsset(scratch, req, res, new URL(req.url, 'http://127.0.0.1')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    removeScratchDirectory(scratch);
  });
  const url = `http://127.0.0.1:${server.address().port}/effect.webm`;
  const whole = await fetch(url);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'video/webm');
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(whole.headers.get('access-control-allow-origin'), '*');
  assert.equal(await whole.text(), bytes.toString());
  for (const [range, expected, contentRange] of [
    ['bytes=0-3', '0123', 'bytes 0-3/20'],
    ['bytes=15-', 'fghij', 'bytes 15-19/20'],
    ['bytes=-4', 'ghij', 'bytes 16-19/20'],
    ['bytes=0-3', '0123', 'bytes 0-3/20'],
    ['bytes=18-999', 'ij', 'bytes 18-19/20'],
  ]) {
    const res = await fetch(url, { headers: { range } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), contentRange);
    assert.equal(await res.text(), expected);
  }
  const head = await fetch(url, { method: 'HEAD', headers: { range: 'bytes=2-3' } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '20');
  assert.equal(await head.text(), '');
  for (const range of ['bytes=20-', 'bytes=5-3', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5']) {
    const res = await fetch(url, { headers: { range } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */20');
    assert.equal(await res.text(), '');
  }
  assert.equal((await fetch(url.replace('effect.webm', 'missing.webm'))).status, 404);
});
