'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// A missing stream error handler must fail only this child, not the test runner.
const probe = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const [modulePath, kind, scenario, root] = process.argv.slice(1);
const { serveOpeningMedia, serveOpeningCharacter } = require(modulePath);
const directory = path.join(root, kind);
fs.mkdirSync(directory);
const fileName = kind === 'opening-music' ? 'fixture.mp3' : 'fixture.png';
const filePath = path.join(directory, fileName);
const content = Buffer.alloc(128 * 1024, 65);
fs.writeFileSync(filePath, content);
const handler = kind === 'opening-music' ? serveOpeningMedia : serveOpeningCharacter;
const prefix = kind === 'opening-music' ? '/opening-media/' : '/opening-character/';
const nativeStat = fs.stat;
const nativeStream = fs.createReadStream;
let sourceClosed;
if (scenario === 'removed-after-stat') {
  fs.stat = (target, callback) => nativeStat(target, (error, stats) => {
    if (!error && target === filePath) fs.unlinkSync(filePath);
    callback(error, stats);
  });
}
if (scenario === 'read-failure') {
  fs.createReadStream = (target) => {
    const source = nativeStream(target, { highWaterMark: 1 });
    source.once('data', () => queueMicrotask(() => source.destroy(
      Object.assign(new Error('synthetic read failure'), { code: 'EIO' }),
    )));
    return source;
  };
}
if (scenario === 'open-failure') {
  fs.createReadStream = () => {
    const source = new Readable({ read() {} });
    queueMicrotask(() => source.destroy(
      Object.assign(new Error('synthetic open failure'), { code: 'EIO' }),
    ));
    return source;
  };
}
if (scenario === 'client-abort') {
  fs.createReadStream = (target) => {
    const source = nativeStream(target, { highWaterMark: 1 });
    sourceClosed = new Promise((resolve) => source.once('close', resolve));
    return source;
  };
}
const server = http.createServer((req, res) => {
  handler(root, req, res, new URL(req.url, 'http://127.0.0.1'), () => fileName);
});
const watchdog = setTimeout(() => process.exit(2), 3000);
(async () => {
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const result = await new Promise((resolve) => {
      const request = http.request({
        host: '127.0.0.1', port: server.address().port, path: prefix + fileName,
        method: scenario === 'HEAD' ? 'HEAD' : 'GET',
      }, (response) => {
        const chunks = [];
        if (scenario === 'client-abort') {
          response.once('data', () => response.destroy());
          response.once('close', () => resolve({ interrupted: true }));
        }
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode, headers: response.headers,
          body: Buffer.concat(chunks),
        }));
        response.on('error', () => resolve({ interrupted: true }));
      });
      request.on('error', () => resolve({ interrupted: true }));
      request.end();
    });
    if (scenario === 'removed-after-stat') {
      assert.equal(result.status, 404);
      assert.equal(JSON.parse(result.body).error, 'Not found.');
    } else if (scenario === 'read-failure') {
      assert.equal(result.interrupted, true);
    } else if (scenario === 'open-failure') {
      assert.equal(result.status, 500);
      assert.equal(JSON.parse(result.body).error, 'Internal server error.');
    } else if (scenario === 'client-abort') {
      assert.equal(result.interrupted, true);
      assert.ok(sourceClosed);
      await sourceClosed;
    } else {
      assert.equal(result.status, 200);
      assert.equal(Number(result.headers['content-length']), content.length);
      assert.deepEqual(result.body, scenario === 'HEAD' ? Buffer.alloc(0) : content);
    }
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    clearTimeout(watchdog);
    fs.stat = nativeStat;
    fs.createReadStream = nativeStream;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

for (const kind of ['opening-music', 'opening-character']) {
  for (const scenario of [
    'removed-after-stat', 'read-failure', 'open-failure', 'client-abort', 'GET', 'HEAD',
  ]) {
    test(`${kind} handles ${scenario} without an unhandled stream error`, (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-opening-stream-'));
      t.after(() => {
        const directory = path.join(root, kind);
        if (fs.existsSync(directory)) {
          for (const name of fs.readdirSync(directory)) {
            fs.unlinkSync(path.join(directory, name));
          }
          fs.rmdirSync(directory);
        }
        fs.rmdirSync(root);
      });
      const result = spawnSync(
        process.execPath,
        ['-e', probe, require.resolve('../src/server/http-utils'), kind, scenario, root],
        { encoding: 'utf8', timeout: 5000, windowsHide: true },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    });
  }
}
