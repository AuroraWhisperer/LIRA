// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');

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
    queueType: 'playlist',
    queueTitle: '歌单队列',
    playlistIndex: 0,
    volume: 0.75
  };
  const app = await createPlaybackApp(savedState);

  await app.init();
  await flushAsyncWork();

  assert.equal(app.element('queuePopupTitle').textContent, '歌单队列');
  assert.equal(app.element('queuePopupSize').textContent, '3 首');
  assert.match(app.element('playbackQueueList').innerHTML, /歌单第二首[\s\S]*歌单第三首/);
  assert.doesNotMatch(app.element('playbackQueueList').innerHTML, /不应显示的电台歌曲|不应保留的电台歌曲/);
  assert.doesNotMatch(app.element('playbackQueueList').innerHTML, /插队/);

  app.element('playbackSearchKeyword').value = '新点的歌';
  await app.emit('playbackSearchBtn', 'click');
  await app.emit('playbackSearchResults', 'click', {
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
  const app = await createPlaybackApp({
    current: currentRadioTrack,
    currentOrigin: 'radio',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [track('radio-next', '不应继续的电台歌曲')],
    displayHistory: [currentRadioTrack, olderTrack],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'radio',
    queueTitle: '电台队列',
    volume: 0.75
  });

  await app.init();
  await flushAsyncWork();

  app.element('playbackSearchKeyword').value = '新想听的歌';
  await app.emit('playbackSearchBtn', 'click');
  await app.emit('playbackSearchResults', 'click', {
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

test('previous playback pops history once without pushing the current track back', async () => {
  const app = await createPlaybackApp({
    current: track('current', 'Current'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [],
    history: [track('older', 'Older'), track('previous', 'Previous')],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75
  });

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPrev', 'click');
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.id, 'previous');
  assert.deepEqual(persisted.history.map((item) => item.id), ['older']);
});

test('pagehide beacon includes the injected API token', async () => {
  const app = await createPlaybackApp({
    current: track('current', 'Current'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75
  }, { apiToken: 'token with & symbols' });

  await app.init();
  await flushAsyncWork();
  await app.emitWindow('pagehide');

  assert.equal(
    app.beaconUrls().at(-1),
    '/api/playback/queue-state?token=token%20with%20%26%20symbols'
  );
});

async function createPlaybackApp(initialState, options = {}) {
  const elements = new Map();
  const storage = new Map([
    ['songAssistantPlaybackState:v1', JSON.stringify(initialState)]
  ]);
  const fetchCalls = [];
  const errors = [];
  const windowListeners = new Map();

  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, id === 'music-player' ? new FakeAudioElement() : new FakeElement());
      }
      return elements.get(id);
    },
    createElement(_tag) {
      return new FakeElement();
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
    },
    removeItem(key) {
      storage.delete(key);
    }
  };

  const window = {
    __API_TOKEN__: options.apiToken,
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
    addEventListener(eventName, listener) {
      if (!windowListeners.has(eventName)) windowListeners.set(eventName, []);
      windowListeners.get(eventName).push(listener);
    }
  };

  async function fetch(url, options = {}) {
    fetchCalls.push({ url: String(url), options });
    if (url.startsWith('/api/playback/queue-state')) {
      if (options.method === 'POST') {
        const body = options.body instanceof sandbox.Blob
          ? options.body.parts.join('')
          : options.body;
        const parsed = JSON.parse(body);
        if (parsed.payload) {
          // Save to v2 key (storage manager uses v2 after migration)
          storage.set('playbackState:v2', JSON.stringify(parsed.payload));
        }
        return response({ ok: true, data: {} });
      }
      const saved = storage.get('playbackState:v2') || storage.get('songAssistantPlaybackState:v1');
      return response({
        ok: true,
        data: { payload: saved ? JSON.parse(saved) : null, updatedAt: '' }
      });
    }
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

  const timers = new Map();
  let timerIdCounter = 1;

  const sandbox = {
    console,
    document,
    encodeURIComponent,
    fetch,
    localStorage,
    navigator: {
      sendBeacon(url, data) {
        fetchCalls.push({ url: String(url), options: { method: 'POST', body: data } });
        return true;
      }
    },
    setTimeout(callback, delay) {
      const id = timerIdCounter++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    Blob: class {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options?.type || '';
      }
    },
    window
  };
  const context = vm.createContext(sandbox);
  const playbackEntry = path.join(__dirname, '..', 'public', 'js', 'playback.js');
  const moduleCache = new Map();

  async function loadModule(filePath) {
    const identifier = pathToFileURL(filePath).href;
    if (moduleCache.has(identifier)) return moduleCache.get(identifier);

    const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
      context,
      identifier,
      initializeImportMeta(meta) {
        meta.url = identifier;
      }
    });
    moduleCache.set(identifier, module);
    await module.link((specifier, referencingModule) => {
      const dependencyUrl = new URL(specifier, referencingModule.identifier);
      return loadModule(fileURLToPath(dependencyUrl));
    });
    return module;
  }

  const playbackModule = await loadModule(playbackEntry);
  await playbackModule.evaluate();

  return {
    init() {
      return window.AdminApp.playback.initPlaybackAssistant({
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
    async emitWindow(eventName, event = {}) {
      for (const listener of windowListeners.get(eventName) || []) {
        await listener(event);
      }
    },
    beaconUrls() {
      return fetchCalls
        .filter(({ options: callOptions }) => callOptions.body instanceof sandbox.Blob)
        .map(({ url }) => url);
    },
    savedState() {
      assert.deepEqual(errors, []);

      // Flush any pending debounced saves
      for (const timer of timers.values()) {
        timer.callback();
      }
      timers.clear();

      const localState = storage.get('playbackState:v2') || storage.get('songAssistantPlaybackState:v1');
      if (localState) {
        return JSON.parse(localState);
      }
      const serverSaveCall = fetchCalls.findLast(
        ({ url, options }) => url.startsWith('/api/playback/queue-state') && options.method === 'POST'
      );
      if (!serverSaveCall || !serverSaveCall.options.body) {
        throw new Error('No saved state found in localStorage or fetch calls');
      }
      const bodyText = serverSaveCall.options.body instanceof sandbox.Blob
        ? serverSaveCall.options.body.parts.join('')
        : serverSaveCall.options.body;
      return JSON.parse(JSON.parse(bodyText).payload);
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
      toggle() {},
      contains() { return false; }
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

  prepend(_child) {
    // no-op for test
  }

  remove() {
    // no-op for test (called by showStackedToast timeout)
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
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
    payload,
    async text() {
      return JSON.stringify(payload);
    },
    async json() {
      return payload;
    }
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
