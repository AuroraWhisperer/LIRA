'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('server keeps its core HTTP, state, song and queue behavior', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-smoke-'));
  const originalFetch = global.fetch;
  let shutdownApplication;

  process.env.SONG_PLUGIN_DATA_DIR = dataDir;
  process.env.AUTO_OPEN_ADMIN = '0';
  global.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
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
    assert.equal(path.resolve(health.dataDir), path.resolve(dataDir));

    for (const pathname of ['/admin', '/queue', '/songlist']) {
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
