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

test('clicking a drawer track replaces the queue with its visible list and preserves button actions', async () => {
  const visibleTracks = [
    track('daily-1', '每日第一首'),
    track('daily-2', '每日第二首'),
    track('daily-3', '每日第三首')
  ];
  const app = await createPlaybackApp({
    current: track('old-current', '原队列歌曲'),
    currentOrigin: 'normal',
    requestedQueue: [track('old-requested', '原插队歌曲')],
    normalQueue: [track('old-next', '原下一首')],
    normalQueueTracks: [track('old-current', '原队列歌曲'), track('old-next', '原下一首')],
    radioQueue: [track('old-radio', '原电台歌曲')],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '原播放队列',
    queueSourceKey: 'qq:liked',
    playlistIndex: 0,
    volume: 0.75
  }, {
    authState: { platform: 'qq', loggedIn: true },
    homeAction: 'daily',
    homeTracks: visibleTracks
  });

  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();

  assert.match(
    app.element('playbackDrawerBody').innerHTML,
    /data-playback-home-track-row-index="1"/
  );

  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackMenuIndex: '1' }, 'playback-home-track-menu-index')
  });
  assert.equal(app.savedState().current.id, 'old-current', 'the menu button must not play its row');

  await app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({ playbackHomeTrackRowIndex: '1' }, 'playback-home-track-row-index')
  });
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.id, 'daily-2');
  assert.equal(persisted.queueType, 'playlist');
  assert.equal(persisted.queueTitle, '每日推荐');
  assert.equal(persisted.queueSourceKey, 'qq:daily');
  assert.equal(persisted.playlistIndex, 1);
  assert.deepEqual(persisted.normalQueueTracks.map((item) => item.id), [
    'daily-1',
    'daily-2',
    'daily-3'
  ]);
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), ['daily-3']);
  assert.deepEqual(persisted.requestedQueue, []);
  assert.deepEqual(persisted.radioQueue, []);
});

test('clicking a track in the active playlist jumps without duplicating or replacing that queue', async () => {
  const likedTracks = [
    track('liked-1', '霓虹派对'),
    track('liked-2', '枪火'),
    track('liked-3', '贩卖日落'),
    track('liked-4', 'China-2')
  ];
  const searchedTrack = track('searched-between', '搜索插入歌曲');
  const app = await createPlaybackApp({
    current: likedTracks[3],
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [
      likedTracks[0],
      searchedTrack,
      likedTracks[1],
      likedTracks[2],
      likedTracks[3]
    ],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '我喜欢',
    queueSourceKey: 'qq:liked',
    playlistIndex: 4,
    volume: 0.75
  }, {
    authState: { platform: 'qq', loggedIn: true },
    homeAction: 'liked',
    homeTracks: likedTracks
  });

  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();

  const clickFirstLikedTrack = () => app.emit('playbackDrawerBody', 'click', {
    target: closestTarget({
      playbackHomeTrackAction: 'play',
      playbackHomeTrackIndex: '0'
    }, 'playback-home-track-action')
  });
  await Promise.all([clickFirstLikedTrack(), clickFirstLikedTrack()]);
  await flushAsyncWork();

  const persisted = app.savedState();
  assert.equal(persisted.current.id, 'liked-1');
  assert.equal(persisted.playlistIndex, 0);
  assert.equal(persisted.queueSourceKey, 'qq:liked');
  assert.deepEqual(persisted.normalQueueTracks.map((item) => item.id), [
    'liked-1',
    'searched-between',
    'liked-2',
    'liked-3',
    'liked-4'
  ]);
  assert.deepEqual(persisted.normalQueue.map((item) => item.id), [
    'searched-between',
    'liked-2',
    'liked-3',
    'liked-4'
  ]);
  assert.equal(app.audioPlayCalls(), 1);
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

test('empty playback uses the latest authenticated provider state', async () => {
  const app = await createPlaybackApp({
    current: null,
    currentOrigin: '',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [],
    history: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75
  }, {
    authState: { platform: 'qq', loggedIn: true }
  });

  await app.init();
  await flushAsyncWork();
  await app.emit('playbackPlayPause', 'click');

  const prompt = app.element('toast').prepended.at(0);
  assert.match(prompt.innerHTML, /播放队列为空/);
  assert.match(prompt.innerHTML, /搜索QQ音乐歌曲并添加到播放队列/);
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

test('playback persistence retains the numeric QQ song ID', async () => {
  const current = {
    ...track('000w1gfs48CBnw', '해볼래 (试试看)'),
    sourceSongId: 107402287
  };
  const app = await createPlaybackApp({
    current,
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [current],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '我喜欢',
    playlistIndex: 0,
    volume: 0.75
  });

  await app.init();
  await flushAsyncWork();
  await app.emitWindow('pagehide');

  const persisted = app.ipcSavedState();
  assert.equal(persisted.current.sourceSongId, 107402287);
  assert.equal(persisted.normalQueueTracks[0].sourceSongId, 107402287);
});

test('cold start restores the server queue and playback progress without local storage', async () => {
  const savedState = {
    current: track('restored-current', '恢复的歌曲'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [track('restored-next', '恢复的下一首')],
    normalQueueTracks: [
      track('restored-current', '恢复的歌曲'),
      track('restored-next', '恢复的下一首')
    ],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '恢复的歌单',
    playlistIndex: 0,
    currentTime: 42,
    volume: 0.75
  };
  const app = await createPlaybackApp(savedState, { localState: null });

  await app.init();
  await flushAsyncWork();

  assert.equal(app.element('queuePopupTitle').textContent, '恢复的歌单');
  assert.equal(app.element('queuePopupSize').textContent, '2 首');
  assert.equal(app.element('playbackCurrentTime').textContent, '00:42');
  assert.match(app.element('playbackQueueList').innerHTML, /恢复的下一首/);
});

test('desktop shutdown awaits the pending playback state IPC save', async () => {
  const savedState = {
    current: track('shutdown-current', '退出前歌曲'),
    currentOrigin: 'normal',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [track('shutdown-current', '退出前歌曲')],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'playlist',
    queueTitle: '退出前队列',
    playlistIndex: 0,
    currentTime: 37,
    volume: 0.75
  };
  const app = await createPlaybackApp(savedState, { localState: null });

  await app.init();
  await flushAsyncWork();
  assert.equal(app.hasPrepareShutdownListener(), true);
  await app.emitPrepareShutdown();

  assert.equal(app.ipcSavedState().currentTime, 37);
  assert.equal(app.shutdownAcknowledged(), true);
});

test('pagehide preserves personal playlist caches for the next desktop start', async () => {
  const sharedStorage = new Map();
  const app = await createPlaybackApp({
    current: null,
    currentOrigin: '',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],
    radioQueue: [],
    mode: 'sequence',
    selectedSource: 'qq',
    queueType: 'queue',
    queueTitle: '播放队列',
    volume: 0.75
  }, {
    storage: sharedStorage,
    authState: { platform: 'qq', loggedIn: true },
    homeAction: 'liked',
    homeTracks: [track('cached-liked', '缓存歌曲')]
  });

  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  assert.equal(app.hasStorageKey('playbackCache:qq:liked'), true);

  await app.emitWindow('pagehide');

  assert.equal(app.hasStorageKey('playbackCache:qq:liked'), true);
});

async function createPlaybackApp(initialState, options = {}) {
  const elements = new Map();
  const storage = options.storage || new Map();
  const localState = Object.hasOwn(options, 'localState') ? options.localState : initialState;
  if (localState) {
    storage.set('songAssistantPlaybackState:v1', JSON.stringify(localState));
  }
  let serverState = JSON.parse(JSON.stringify(options.serverState ?? initialState));
  let prepareShutdownListener = null;
  let ipcSavedState = null;
  let shutdownAcknowledged = false;
  const fetchCalls = [];
  const errors = [];
  const windowListeners = new Map();
  const homeTracks = options.homeTracks;
  const homeActionButton = options.homeAction ? new FakeElement() : null;
  if (homeActionButton) homeActionButton.dataset.playbackHomeAction = options.homeAction;

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
    querySelectorAll(selector) {
      if (selector === '[data-playback-home-action]' && homeActionButton) {
        return [homeActionButton];
      }
      return [];
    },
    querySelector() {
      return null;
    }
  };

  const localStorage = {
    get length() {
      return storage.size;
    },
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    key(index) {
      return Array.from(storage.keys())[index] ?? null;
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
        return options.authState ?? { platform, loggedIn: false };
      },
      async providerHealth() {
        return { ok: true, message: 'ok' };
      },
      async savePlaybackState(_clientId, payload) {
        ipcSavedState = JSON.parse(JSON.stringify(payload));
        serverState = ipcSavedState;
        return { saved: true };
      },
      onPrepareShutdown(callback) {
        prepareShutdownListener = callback;
        return () => { prepareShutdownListener = null; };
      },
      async confirmShutdownFlush() {
        shutdownAcknowledged = true;
        return { ok: true };
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
          serverState = JSON.parse(JSON.stringify(parsed.payload));
        }
        return response({ ok: true, data: {} });
      }
      return response({
        ok: true,
        data: {
          payload: serverState ? JSON.parse(JSON.stringify(serverState)) : null,
          updatedAt: ''
        }
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
        data: { tracks: homeTracks || [track('radio-refill', '电台补充歌曲')] }
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
    async emitPrepareShutdown() {
      if (prepareShutdownListener) await prepareShutdownListener();
    },
    hasPrepareShutdownListener() {
      return Boolean(prepareShutdownListener);
    },
    emitHomeAction() {
      return homeActionButton?.emit('click');
    },
    beaconUrls() {
      return fetchCalls
        .filter(({ options: callOptions }) => callOptions.body instanceof sandbox.Blob)
        .map(({ url }) => url);
    },
    hasStorageKey(key) {
      return storage.has(key);
    },
    ipcSavedState() {
      return ipcSavedState;
    },
    shutdownAcknowledged() {
      return shutdownAcknowledged;
    },
    savedState() {
      assert.deepEqual(errors, []);

      // Flush any pending debounced saves
      for (const timer of timers.values()) {
        timer.callback();
      }
      timers.clear();

      if (serverState) return JSON.parse(JSON.stringify(serverState));
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
    },
    audioPlayCalls() {
      return document.getElementById('music-player').playCalls;
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
    this.prepended = [];
    this.style = {
      display: '',
      setProperty() {}
    };
    this.textContent = '';
    this.value = '';
  }

  prepend(child) {
    this.prepended.unshift(child);
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
    this.playCalls = 0;
    this.src = '';
    this.volume = 0.75;
  }

  load() {}

  pause() {
    this.paused = true;
  }

  async play() {
    this.playCalls += 1;
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
