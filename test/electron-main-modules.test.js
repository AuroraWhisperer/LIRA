'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('desktop runtime adapts the legacy server API without changing calls', async () => {
  const { createDesktopRuntime } = require('../src/electron/desktop-runtime');
  const calls = [];
  const legacy = {
    startServer(options) { calls.push(['start', options]); return { baseUrl: 'http://127.0.0.1:3000' }; },
    shutdownApplication(options) { calls.push(['stop', options]); },
    setPreShutdownHook(hook) { calls.push(['hook', hook]); },
    persistPlaybackSnapshot(payload, clientId) { return { payload, clientId }; },
    getSetting(key) { return `setting:${key}`; }
  };
  const runtime = createDesktopRuntime(legacy);
  const hook = () => {};

  assert.deepEqual(await runtime.start({ host: '127.0.0.1' }), { baseUrl: 'http://127.0.0.1:3000' });
  await runtime.stop({ exitProcess: false });
  runtime.setPreShutdownHook(hook);
  assert.deepEqual(runtime.persistPlaybackSnapshot({ currentMs: 10 }, 'desktop'), {
    payload: { currentMs: 10 },
    clientId: 'desktop'
  });
  assert.equal(runtime.getSetting('theme'), 'setting:theme');
  assert.deepEqual(calls, [
    ['start', { host: '127.0.0.1' }],
    ['stop', { exitProcess: false }],
    ['hook', hook]
  ]);
});

test('local media protocol enforces authorization and serves byte ranges', async (t) => {
  const { registerLocalMediaProtocol } = require('../src/electron/local-media-protocol');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-local-media-'));
  const allowedPath = path.join(tempDir, 'allowed.mp3');
  const blockedPath = path.join(tempDir, 'blocked.mp3');
  fs.writeFileSync(allowedPath, Buffer.from('abcdef'));
  fs.writeFileSync(blockedPath, Buffer.from('blocked'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  let handler = null;
  registerLocalMediaProtocol({
    handle(scheme, nextHandler) {
      assert.equal(scheme, 'local-media');
      handler = nextHandler;
    }
  }, (filePath) => filePath === allowedPath);

  const allowedUrl = `local-media://media/${Buffer.from(allowedPath).toString('base64url')}`;
  const partial = await handler({ url: allowedUrl, headers: new Headers({ range: 'bytes=1-3' }) });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 1-3/6');
  assert.equal(Buffer.from(await partial.arrayBuffer()).toString('utf8'), 'bcd');

  const inverted = await handler({ url: allowedUrl, headers: new Headers({ range: 'bytes=4-2' }) });
  assert.equal(inverted.status, 200);
  assert.equal(inverted.headers.get('content-range'), null);
  assert.equal(Buffer.from(await inverted.arrayBuffer()).toString('utf8'), 'abcdef');

  const blockedUrl = `local-media://media/${Buffer.from(blockedPath).toString('base64url')}`;
  const blocked = await handler({ url: blockedUrl, headers: new Headers() });
  assert.equal(blocked.status, 403);
});
