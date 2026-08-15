'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');

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
  const playbackEntry = path.join(__dirname, '..', '..', 'public', 'js', 'playback.js');
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

module.exports = {
  closestTarget,
  createPlaybackApp,
  flushAsyncWork,
  track
};
