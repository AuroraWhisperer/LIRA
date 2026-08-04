'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

let _testToken = '';

async function requestJson(baseUrl, pathname, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (_testToken) headers['Authorization'] = `Bearer ${_testToken}`;
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error || `${pathname} returned ${response.status}`);
  assert.equal(payload.ok, true);
  return payload.data;
}

function postJson(baseUrl, pathname, body) {
  return requestJson(baseUrl, pathname, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

function readInitialWebSocketSnapshot(baseUrl) {
  return new Promise((resolve, reject) => {
    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws${_testToken ? '?token=' + encodeURIComponent(_testToken) : ''}`;
    const socket = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for WebSocket snapshot'));
    }, 2000);

    socket.addEventListener('message', (event) => {
      clearTimeout(timeout);
      socket.close();
      resolve(JSON.parse(String(event.data)));
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('WebSocket connection failed'));
    }, { once: true });
  });
}

function readInjectedApiAnchor(html, baseUrl, href) {
  const match = html.match(/<script>\(function\(\)\{[\s\S]*?\}\)\(\);<\/script>/);
  assert.ok(match, 'the page should contain the injected session script');
  const anchor = {
    href,
    getAttribute(name) {
      return name === 'href' ? this.href : null;
    },
    setAttribute(name, value) {
      if (name === 'href') this.href = value;
    }
  };
  const NativeWebSocket = function NativeWebSocket() {};
  NativeWebSocket.prototype = {};
  Object.assign(NativeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const window = { fetch() {}, WebSocket: NativeWebSocket };
  vm.runInNewContext(match[0].slice(8, -9), {
    window,
    document: {
      readyState: 'complete',
      querySelectorAll: () => [anchor],
      addEventListener() {}
    },
    location: new URL(`${baseUrl}/admin`),
    URL,
    Headers,
    encodeURIComponent
  });
  return anchor.href;
}

test('server normalizes localhost to the IPv4 loopback address', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-loopback-'));
  const { createServerRuntime } = require('../src/server');
  const runtime = createServerRuntime({ dataDir });
  const port = await findAvailablePort();

  try {
    const app = await runtime.start({ host: 'localhost', startPort: port });
    assert.equal(app.host, '127.0.0.1');
    assert.equal(app.baseUrl, `http://127.0.0.1:${port}`);
  } finally {
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server keeps its core HTTP, state, song and queue behavior', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-smoke-'));
  const originalFetch = global.fetch;
  let shutdownApplication;

  process.env.SONG_PLUGIN_DATA_DIR = dataDir;
  process.env.AUTO_OPEN_ADMIN = '0';
  global.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === '127.0.0.1') {
      return originalFetch(input, options);
    }
    if (url.hostname === 'raw.githubusercontent.com') {
      return Promise.resolve(new Response("'SEND_GIFT' 'COMBO_SEND'", { status: 200 }));
    }
    return Promise.reject(new Error(`Unexpected external request in smoke test: ${url.hostname}`));
  };

  try {
    const serverModule = require('../src/server');
    shutdownApplication = serverModule.shutdownApplication;
    const app = await serverModule.startServer({
      host: '127.0.0.1',
      startPort: 38471
    });

    _testToken = serverModule.getApiToken();
    const tokenPath = path.join(dataDir, '.session-token');
    assert.equal(fs.readFileSync(tokenPath, 'utf8').trim(), _testToken);

    const health = await requestJson(app.baseUrl, '/api/health');
    assert.equal(health.serviceId, 'bilibili-live-song-plugin');
    assert.equal(path.resolve(health.dataDir), path.resolve(dataDir));

    const blindBoxAnalysis = await requestJson(
      app.baseUrl,
      '/api/gifts/blind-box-analysis?view=records&page=1&limit=25'
    );
    assert.equal(blindBoxAnalysis.summary.boxCount, 0);
    assert.deepEqual(blindBoxAnalysis.items, []);
    assert.equal(blindBoxAnalysis.pagination.total, 0);

    for (const pathname of ['/admin', '/queue', '/songlist', '/lyrics']) {
      const response = await fetch(`${app.baseUrl}${pathname}`);
      assert.equal(response.status, 200, pathname);
      if (pathname === '/admin') {
        const html = await response.text();
        assert.equal(
          readInjectedApiAnchor(html, app.baseUrl, '/api/songs/export.xlsx'),
          `/api/songs/export.xlsx?token=${encodeURIComponent(_testToken)}`
        );
        assert.equal(
          readInjectedApiAnchor(html, app.baseUrl, `${app.baseUrl}/api/songs/template.xlsx`),
          `${app.baseUrl}/api/songs/template.xlsx?token=${encodeURIComponent(_testToken)}`
        );
        assert.equal(
          readInjectedApiAnchor(html, app.baseUrl, 'https://example.com/api/export'),
          'https://example.com/api/export'
        );
      }
    }

    for (const pathname of ['/api/songs/template.xlsx', '/api/songs/export.xlsx']) {
      const unauthorized = await fetch(`${app.baseUrl}${pathname}`);
      assert.equal(unauthorized.status, 401, `${pathname} should reject a missing token`);

      const authorized = await fetch(
        `${app.baseUrl}${pathname}?token=${encodeURIComponent(_testToken)}`
      );
      assert.equal(authorized.status, 200, `${pathname} should accept its tokenized anchor URL`);
      assert.ok((await authorized.arrayBuffer()).byteLength > 0, `${pathname} should return a workbook`);
    }

    const initialSnapshot = await readInitialWebSocketSnapshot(app.baseUrl);
    assert.equal(initialSnapshot.type, 'snapshot');
    assert.equal(initialSnapshot.reason, 'connect');
    assert.equal(initialSnapshot.state.lyricState.status, 'idle');

    const publishedLyric = await postJson(app.baseUrl, '/api/playback/lyric-state', {
      trackTitle: 'Smoke Song',
      artists: ['Smoke Artist'],
      lineText: 'Smoke lyric',
      progress: 0.4,
      playing: true,
      status: 'ready'
    });
    assert.equal(publishedLyric.lineText, 'Smoke lyric');
    const lyricSnapshot = await readInitialWebSocketSnapshot(app.baseUrl);
    assert.equal(lyricSnapshot.state.lyricState.lineText, 'Smoke lyric');

    const settingsState = await postJson(app.baseUrl, '/api/settings', {
      enableBilibili: false,
      queueLimit: 3
    });
    assert.equal(settingsState.settings.enableBilibili, 'false');
    assert.equal(settingsState.settings.queueLimit, '3');

    const savedSong = await postJson(app.baseUrl, '/api/songs/save', {
      name: 'Smoke Song',
      artist: 'Smoke Artist',
      categoryName: 'Smoke Category'
    });
    assert.equal(savedSong.name, 'Smoke Song');

    const songs = await requestJson(app.baseUrl, '/api/songs?query=Smoke');
    assert.equal(songs.length, 1);
    assert.equal(songs[0].category_name, 'Smoke Category');

    const imported = await postJson(app.baseUrl, '/api/songs/import', {
      rows: [
        { name: 'Smoke Song', artist: 'Smoke Artist' },
        { name: 'Imported Song', artist: 'Imported Artist' },
        { name: '' }
      ]
    });
    assert.equal(imported.duplicate, 1);
    assert.equal(imported.inserted, 1);
    assert.equal(imported.failed, 1);

    const queueItem = await postJson(app.baseUrl, '/api/queue/add', {
      songName: 'Smoke Song',
      artist: 'Smoke Artist',
      requesterName: 'Smoke User',
      requesterUid: 'smoke-user',
      requesterGuardLevel: 2,
      requesterMedalName: 'Smoke Medal',
      requesterMedalLevel: 12
    });
    assert.equal(queueItem.requester_name, 'Smoke User');
    assert.equal(queueItem.requester_guard_level, 2);
    assert.equal(queueItem.requester_medal_name, 'Smoke Medal');
    assert.equal(queueItem.requester_medal_level, 12);

    const pinnedQueue = await postJson(app.baseUrl, '/api/queue/action', {
      action: 'pin',
      id: queueItem.id
    });
    assert.equal(pinnedQueue.waiting[0].is_pinned, true);

    const clearedLibrary = await postJson(app.baseUrl, '/api/database/clear', {
      confirm: true
    });
    assert.equal(clearedLibrary.scope, 'song-library');

    const stateAfterLibraryClear = await requestJson(app.baseUrl, '/api/state');
    assert.equal(stateAfterLibraryClear.songCount, 0);
    assert.equal(stateAfterLibraryClear.queue.waiting.length, 1);
    assert.equal(stateAfterLibraryClear.queue.waiting[0].song_id, null);
    assert.equal(stateAfterLibraryClear.categories.some((category) => category.name === '默认'), true);

    const nextQueue = await postJson(app.baseUrl, '/api/queue/action', {
      action: 'next'
    });
    assert.equal(nextQueue.waiting.length, 0);

    const cleared = await postJson(app.baseUrl, '/api/database/clear-all', {
      confirm: true
    });
    assert.equal(cleared.scope, 'all');

    const finalState = await requestJson(app.baseUrl, '/api/state');
    assert.equal(finalState.songCount, 0);
    assert.equal(finalState.queue.waiting.length, 0);
    assert.equal(finalState.settings.queueLimit, '3');
    assert.equal(finalState.categories.some((category) => category.name === '默认'), true);
  } finally {
    if (shutdownApplication) {
      await shutdownApplication({ exitProcess: false });
      assert.equal(fs.existsSync(path.join(dataDir, '.session-token')), false);
    }
    global.fetch = originalFetch;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server runtimes isolate sequential data directories', async () => {
  const firstDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-runtime-first-'));
  const secondDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-runtime-second-'));
  const { createServerRuntime } = require('../src/server');
  let firstRuntime;
  let secondRuntime;

  try {
    firstRuntime = createServerRuntime({ dataDir: firstDataDir });
    await firstRuntime.start({
      host: '127.0.0.1',
      startPort: await findAvailablePort()
    });
    assert.equal(firstRuntime.getSetting('queueLimit'), '50');
    assert.equal(fs.existsSync(path.join(firstDataDir, '.session-token')), true);
    await firstRuntime.stop({ exitProcess: false });
    assert.equal(fs.existsSync(path.join(firstDataDir, '.session-token')), false);

    secondRuntime = createServerRuntime({ dataDir: secondDataDir });
    await secondRuntime.start({
      host: '127.0.0.1',
      startPort: await findAvailablePort()
    });
    assert.equal(fs.existsSync(path.join(secondDataDir, '.session-token')), true);
    await secondRuntime.stop({ exitProcess: false });
    assert.equal(fs.existsSync(path.join(secondDataDir, '.session-token')), false);
  } finally {
    if (firstRuntime) await firstRuntime.stop({ exitProcess: false });
    if (secondRuntime) await secondRuntime.stop({ exitProcess: false });
    fs.rmSync(firstDataDir, { recursive: true, force: true });
    fs.rmSync(secondDataDir, { recursive: true, force: true });
  }
});

test('server runtime closes cleanly when stop races with start', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-runtime-race-'));
  const { createServerRuntime } = require('../src/server');
  const runtime = createServerRuntime({ dataDir });
  const port = await findAvailablePort();

  try {
    const startResult = runtime.start({ host: '127.0.0.1', startPort: port });
    const stopResult = runtime.stop();
    const [, stopped] = await Promise.allSettled([startResult, stopResult]);

    assert.equal(stopped.status, 'fulfilled');
    assert.equal(fs.existsSync(path.join(dataDir, '.session-token')), false);
    assert.equal(await canConnect(port), false);
  } finally {
    await runtime.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('server startup rolls back an ephemeral listener when runtime info fails', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-runtime-rollback-'));
  const lifecycle = require('../src/server/lifecycle');
  const originalWriteRuntimeInfo = lifecycle.writeRuntimeInfo;
  const { createServerRuntime } = require('../src/server');
  const runtime = createServerRuntime({ dataDir });
  let assignedPort = 0;

  lifecycle.writeRuntimeInfo = (runtimeDataDir, info) => {
    assignedPort = info.port;
    originalWriteRuntimeInfo(runtimeDataDir, info);
    throw new Error('forced runtime info failure');
  };

  try {
    await assert.rejects(
      runtime.start({ host: '127.0.0.1', startPort: 0 }),
      /forced runtime info failure/
    );
    assert.ok(assignedPort > 0);
    assert.equal(await canConnect(assignedPort), false);
    assert.equal(fs.existsSync(path.join(dataDir, '.session-token')), false);
    assert.equal(fs.existsSync(path.join(dataDir, '.server-runtime.json')), false);
  } finally {
    lifecycle.writeRuntimeInfo = originalWriteRuntimeInfo;
    await runtime.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
