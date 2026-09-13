'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

async function requestJson(connection, pathname, options = {}) {
  const { baseUrl, token } = connection;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
  });
  const payload = await response.json();
  assert.equal(
    response.ok,
    true,
    payload.error || `${pathname} returned ${response.status}`,
  );
  assert.equal(payload.ok, true);
  return payload.data;
}

function postJson(connection, pathname, body) {
  return requestJson(connection, pathname, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function readInitialWebSocketSnapshot(connection) {
  const { baseUrl, token } = connection;
  return new Promise((resolve, reject) => {
    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;
    const socket = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for WebSocket snapshot'));
    }, 2000);

    socket.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout);
        socket.close();
        resolve(JSON.parse(String(event.data)));
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection failed'));
      },
      { once: true },
    );
  });
}

function readInjectedApiAnchor(html, baseUrl, href) {
  const match = html.match(
    /<script>\(function\(\)\{[\s\S]*?\}\)\(\);<\/script>/,
  );
  assert.ok(match, 'the page should contain the injected session script');
  const anchor = {
    href,
    getAttribute(name) {
      return name === 'href' ? this.href : null;
    },
    setAttribute(name, value) {
      if (name === 'href') this.href = value;
    },
  };
  const NativeWebSocket = function NativeWebSocket() {};
  NativeWebSocket.prototype = {};
  Object.assign(NativeWebSocket, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  });
  const window = { fetch() {}, WebSocket: NativeWebSocket };
  vm.runInNewContext(match[0].slice(8, -9), {
    window,
    document: {
      readyState: 'complete',
      querySelectorAll: () => [anchor],
      addEventListener() {},
    },
    location: new URL(`${baseUrl}/admin`),
    URL,
    Headers,
    encodeURIComponent,
  });
  return anchor.href;
}

async function assertSmokeHealth(connection, dataDir) {
  const health = await requestJson(connection, '/api/health');
  assert.equal(health.serviceId, 'lira');
  assert.equal(path.resolve(health.dataDir), path.resolve(dataDir));

  const blindBoxAnalysis = await requestJson(
    connection,
    '/api/gifts/blind-box-analysis?view=records&page=1&limit=25',
  );
  assert.equal(blindBoxAnalysis.summary.boxCount, 0);
  assert.deepEqual(blindBoxAnalysis.items, []);
  assert.equal(blindBoxAnalysis.pagination.total, 0);
}

async function assertSmokePagesAndExports(connection) {
  for (const pathname of ['/admin', '/queue', '/songlist', '/lyrics']) {
    const response = await fetch(`${connection.baseUrl}${pathname}`);
    assert.equal(response.status, 200, pathname);
    if (pathname === '/admin') {
      const html = await response.text();
      assert.equal(
        readInjectedApiAnchor(
          html,
          connection.baseUrl,
          '/api/songs/export.xlsx',
        ),
        `/api/songs/export.xlsx?token=${encodeURIComponent(connection.token)}`,
      );
      assert.equal(
        readInjectedApiAnchor(
          html,
          connection.baseUrl,
          `${connection.baseUrl}/api/songs/template.xlsx`,
        ),
        `${connection.baseUrl}/api/songs/template.xlsx?token=${encodeURIComponent(connection.token)}`,
      );
      assert.equal(
        readInjectedApiAnchor(
          html,
          connection.baseUrl,
          'https://example.com/api/export',
        ),
        'https://example.com/api/export',
      );
    }
  }

  for (const pathname of [
    '/api/songs/template.xlsx',
    '/api/songs/export.xlsx',
  ]) {
    const unauthorized = await fetch(`${connection.baseUrl}${pathname}`);
    assert.equal(
      unauthorized.status,
      401,
      `${pathname} should reject a missing token`,
    );

    const authorized = await fetch(
      `${connection.baseUrl}${pathname}?token=${encodeURIComponent(connection.token)}`,
    );
    assert.equal(
      authorized.status,
      200,
      `${pathname} should accept its tokenized anchor URL`,
    );
    assert.ok(
      (await authorized.arrayBuffer()).byteLength > 0,
      `${pathname} should return a workbook`,
    );
  }
}

async function assertSmokeLyrics(connection) {
  const initialSnapshot = await readInitialWebSocketSnapshot(connection);
  assert.equal(initialSnapshot.type, 'snapshot');
  assert.equal(initialSnapshot.reason, 'connect');
  assert.equal(initialSnapshot.state.lyricState.status, 'idle');
  assert.equal(initialSnapshot.state.lyricTimeline.status, 'idle');

  const publishedLyric = await postJson(
    connection,
    '/api/playback/lyric-state',
    {
      trackTitle: 'Smoke Song',
      artists: ['Smoke Artist'],
      lineText: 'Smoke lyric',
      progress: 0.4,
      playing: true,
      status: 'ready',
    },
  );
  assert.equal(publishedLyric.lineText, 'Smoke lyric');
  const lyricSnapshot = await readInitialWebSocketSnapshot(connection);
  assert.equal(lyricSnapshot.state.lyricState.lineText, 'Smoke lyric');

  const publishedTimeline = await postJson(
    connection,
    '/api/playback/lyric-timeline',
    {
      trackTitle: 'Smoke Song',
      artists: ['Smoke Artist'],
      status: 'ready',
      lines: [
        { startMs: 0, text: '出品：Smoke Studio' },
        { startMs: 9000, text: 'Smoke lyric' },
      ],
    },
  );
  assert.equal(publishedTimeline.lines.length, 2);
  const timelineSnapshot = await readInitialWebSocketSnapshot(connection);
  assert.equal(
    timelineSnapshot.state.lyricTimeline.lines[0].text,
    '出品：Smoke Studio',
  );
}

async function assertSmokeSongsAndSettings(connection) {
  const settingsState = await postJson(connection, '/api/settings', {
    enableBilibili: false,
    queueLimit: 3,
    onboardingVersion: '1',
    onboardingCompletedAt: '2026-08-19T00:00:00.000Z',
    onboardingSkippedOptional: 'ai',
  });
  assert.equal(settingsState.settings.enableBilibili, 'false');
  assert.equal(settingsState.settings.queueLimit, '3');
  assert.equal(settingsState.settings.onboardingVersion, '1');
  assert.equal(settingsState.settings.onboardingSkippedOptional, 'ai');

  const savedSong = await postJson(connection, '/api/songs/save', {
    name: 'Smoke Song',
    artist: 'Smoke Artist',
    categoryName: 'Smoke Category',
  });
  assert.equal(savedSong.name, 'Smoke Song');

  const songs = await requestJson(connection, '/api/songs?query=Smoke');
  assert.equal(songs.length, 1);
  assert.equal(songs[0].category_name, 'Smoke Category');

  const imported = await postJson(connection, '/api/songs/import', {
    rows: [
      { name: 'Smoke Song', artist: 'Smoke Artist' },
      { name: 'Imported Song', artist: 'Imported Artist' },
      { name: '' },
    ],
  });
  assert.equal(imported.duplicate, 1);
  assert.equal(imported.inserted, 1);
  assert.equal(imported.failed, 1);
}

async function assertSmokeQueueAndClearing(connection) {
  const queueItem = await postJson(connection, '/api/queue/add', {
    songName: 'Smoke Song',
    artist: 'Smoke Artist',
    requesterName: 'Smoke User',
    requesterUid: 'smoke-user',
    requesterGuardLevel: 2,
    requesterMedalName: 'Smoke Medal',
    requesterMedalLevel: 12,
  });
  assert.equal(queueItem.requester_name, 'Smoke User');
  assert.equal(queueItem.requester_guard_level, 2);
  assert.equal(queueItem.requester_medal_name, 'Smoke Medal');
  assert.equal(queueItem.requester_medal_level, 12);

  const pinnedQueue = await postJson(connection, '/api/queue/action', {
    action: 'pin',
    id: queueItem.id,
  });
  assert.equal(pinnedQueue.waiting[0].is_pinned, true);

  const clearedLibrary = await postJson(connection, '/api/database/clear', {
    confirm: true,
  });
  assert.equal(clearedLibrary.scope, 'song-library');

  const stateAfterLibraryClear = await requestJson(connection, '/api/state');
  assert.equal(stateAfterLibraryClear.songCount, 0);
  assert.equal(stateAfterLibraryClear.queue.waiting.length, 1);
  assert.equal(stateAfterLibraryClear.queue.waiting[0].song_id, null);
  assert.equal(
    stateAfterLibraryClear.categories.some(
      (category) => category.name === '默认',
    ),
    true,
  );

  const nextQueue = await postJson(connection, '/api/queue/action', {
    action: 'next',
  });
  assert.equal(nextQueue.waiting.length, 0);

  const cleared = await postJson(connection, '/api/database/clear-all', {
    confirm: true,
  });
  assert.equal(cleared.scope, 'all');

  const finalState = await requestJson(connection, '/api/state');
  assert.equal(finalState.songCount, 0);
  assert.equal(finalState.queue.waiting.length, 0);
  assert.equal(finalState.settings.queueLimit, '3');
  assert.equal(finalState.settings.onboardingVersion, '1');
  assert.equal(
    finalState.settings.onboardingCompletedAt,
    '2026-08-19T00:00:00.000Z',
  );
  assert.deepEqual(
    finalState.categories.map((category) => category.name),
    ['默认'],
  );
}

module.exports = {
  assertSmokeHealth,
  assertSmokePagesAndExports,
  assertSmokeLyrics,
  assertSmokeSongsAndSettings,
  assertSmokeQueueAndClearing,
};
