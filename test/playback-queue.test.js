// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const playbackScript = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'playback.js'),
  'utf8'
);

test('playlist playback keeps one queue and loops with directly played search tracks', async () => {
  const savedState = {
    current: track('playlist-1', '歌单第一首'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [
      track('playlist-2', '歌单第二首'),
      track('playlist-3', '歌单第三首')
    ],
    normalQueueTracks: [
      track('playlist-1', '歌单第一首'),
      track('playlist-2', '歌单第二首'),
      track('playlist-3', '歌单第三首')
    ],
    radioQueue: [
      track('radio-1', '不应显示的电台歌曲'),
      track('radio-2', '不应保留的电台歌曲')
    ],
    mode: 'sequence',
    selectedSource: 'qq',
    volume: 0.75
  };
  const app = createPlaybackApp(savedState);

  app.init();
  await flushAsyncWork();

  assert.equal(app.element('queuePopupTitle').textContent, '歌单队列');
  assert.equal(app.element('queuePopupSize').textContent, '2 首');
  assert.match(app.element('playbackQueueList').innerHTML, /歌单第二首[\s\S]*歌单第三首/);
  assert.doesNotMatch(app.element('playbackQueueList').innerHTML, /不应显示的电台歌曲|不应保留的电台歌曲/);
  assert.doesNotMatch(app.element('playbackQueueList').innerHTML, /插队/);

  app.element('playbackSearchKeyword').value = '新点的歌';
  await app.emit('playbackSearchBtn', 'click');
  app.emit('playbackSearchResults', 'click', {
    target: closestTarget({
      playbackSearchAction: 'play',
      playbackSearchIndex: '0'
    }, 'playback-search-action')
  });
  await flushAsyncWork();

  let persisted = app.savedState();
  assert.equal(persisted.queueType, 'playlist');
  assert.equal(persisted.current.id, 'searched');
  assert.equal(persisted.playlistIndex, 1);
  assert.deepEqual(persisted.normalQueueTracks.map((item) => item.id), [
    'playlist-1',
    'searched',
    'playlist-2',
    'playlist-3'
  ]);
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), [
    'playlist-2',
    'playlist-3'
  ]);
  assert.deepEqual(persisted.radioQueue, []);

  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'playlist-2');

  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  assert.equal(app.savedState().current.id, 'playlist-3');

  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  persisted = app.savedState();
  assert.equal(persisted.current.id, 'playlist-1');
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), [
    'searched',
    'playlist-2',
    'playlist-3'
  ]);
  assert.equal(app.radioRefillRequests(), 0);
});

test('playing a wanted track from radio switches to a looping history queue', async () => {
  const currentRadioTrack = track('radio-current', '当前电台歌曲');
  const olderTrack = track('history-old', '更早播放的歌曲');
  const app = createPlaybackApp({
    current: currentRadioTrack,
    currentOrigin: 'radio',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [track('radio-next', '不应继续的电台歌曲')],
    displayHistory: [currentRadioTrack, olderTrack],
    mode: 'sequence',
    selectedSource: 'qq',
    volume: 0.75
  });

  app.init();
  await flushAsyncWork();

  app.element('playbackSearchKeyword').value = '新想听的歌';
  await app.emit('playbackSearchBtn', 'click');
  app.emit('playbackSearchResults', 'click', {
    target: closestTarget({
      playbackSearchAction: 'play',
      playbackSearchIndex: '0'
    }, 'playback-search-action')
  });
  await flushAsyncWork();

  let persisted = app.savedState();
  assert.equal(persisted.queueType, 'playlist');
  assert.equal(persisted.queueTitle, '历史播放');
  assert.equal(persisted.current.id, 'searched');
  assert.equal(persisted.playlistIndex, 0);
  assert.deepEqual(persisted.normalQueueTracks.map((item) => item.id), [
    'searched',
    'radio-current',
    'history-old'
  ]);
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), [
    'radio-current',
    'history-old'
  ]);
  assert.deepEqual(persisted.radioQueue, []);
  assert.equal(app.element('queuePopupTitle').textContent, '历史播放');

  await app.emit('music-player', 'ended');
  await flushAsyncWork();
  persisted = app.savedState();
  assert.equal(persisted.current.id, 'radio-current');
  assert.equal(app.radioRefillRequests(), 0);
});

function createPlaybackApp(initialState) {
  const elements = new Map();
  const storage = new Map([
    ['songAssistantPlaybackState:v1', JSON.stringify(initialState)]
  ]);
  const fetchCalls = [];
  const errors = [];

  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, id === 'music-player' ? new FakeAudioElement() : new FakeElement());
      }
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    }
  };

  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  };

  const window = {
    AdminApp: {
      utils: {
        escapeHtml: escapeText,
        escapeAttr: escapeText,
        value: (id) => document.getElementById(id).value || '',
        formatBytes: (bytes) => `${bytes} B`,
        formatCompactNumber: (number) => String(number),
        toast() {},
        showError(error) {
          errors.push(error);
        },
        async api() {},
        async readJsonResponse(response) {
          return response.payload;
        }
      }
    },
    musicAPI: {
      async getAuthState(platform) {
        return { platform, loggedIn: false };
      },
      async providerHealth() {
        return { ok: true, message: 'ok' };
      }
    },
    addEventListener() {}
  };

  async function fetch(url, options = {}) {
    fetchCalls.push({ url: String(url), options });
    if (url === '/api/music/search') {
      return response({
        ok: true,
        data: {
          tracks: [track('searched', '新点的歌')]
        }
      });
    }
    if (url === '/api/music/resolve-stream') {
      return response({
        ok: true,
        data: { url: 'https://example.test/audio.mp3' }
      });
    }
    if (url === '/api/music/lyrics') {
      return response({
        ok: true,
        data: { lines: [] }
      });
    }
    if (url === '/api/music/cache') {
      return response({
        ok: true,
        data: { totalBytes: 0, totalFiles: 0 }
      });
    }
    if (url === '/api/music/home') {
      return response({
        ok: true,
        data: { tracks: [track('radio-refill', '电台补充歌曲')] }
      });
    }
    return response({ ok: true, data: {} });
  }

  const sandbox = {
    console,
    document,
    encodeURIComponent,
    fetch,
    localStorage,
    navigator: {},
    window
  };
  vm.runInNewContext(playbackScript, sandbox, { filename: 'public/js/playback.js' });

  return {
    init() {
      window.AdminApp.playback.initPlaybackAssistant({
        readJsonResponse: window.AdminApp.utils.readJsonResponse,
        showError: window.AdminApp.utils.showError,
        toast: window.AdminApp.utils.toast
      });
    },
    element(id) {
      return document.getElementById(id);
    },
    async emit(id, eventName, event = {}) {
      return document.getElementById(id).emit(eventName, event);
    },
    savedState() {
      assert.deepEqual(errors, []);
      return JSON.parse(storage.get('songAssistantPlaybackState:v1'));
    },
    radioRefillRequests() {
      return fetchCalls.filter(({ url, options }) => {
        if (url !== '/api/music/home' || !options.body) return false;
        return JSON.parse(options.body).action === 'radio';
      }).length;
    }
  };
}

class FakeElement {
  constructor() {
    this.classList = {
      add() {},
      remove() {},
      toggle() {}
    };
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.innerHTML = '';
    this.listeners = new Map();
    this.style = {
      display: '',
      setProperty() {}
    };
    this.textContent = '';
    this.value = '';
  }

  addEventListener(eventName, listener) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, []);
    this.listeners.get(eventName).push(listener);
  }

  async emit(eventName, event = {}) {
    const listeners = this.listeners.get(eventName) || [];
    for (const listener of listeners) {
      await listener(event);
    }
  }
}

class FakeAudioElement extends FakeElement {
  constructor() {
    super();
    this.currentTime = 0;
    this.duration = 180;
    this.paused = true;
    this.src = '';
    this.volume = 0.75;
  }

  load() {}

  pause() {
    this.paused = true;
  }

  async play() {
    this.paused = false;
  }

  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
}

function closestTarget(dataset, expectedSelectorPart) {
  return {
    closest(selector) {
      return selector.includes(expectedSelectorPart) ? { dataset } : null;
    }
  };
}

function track(id, title) {
  return {
    id,
    source: 'qq',
    sourceTrackId: id,
    title,
    artists: ['测试歌手'],
    album: '测试专辑',
    coverUrl: '',
    durationMs: 180000,
    playable: true,
    vip: false
  };
}

function response(payload) {
  return {
    ok: payload.ok !== false,
    payload
  };
}

function escapeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
