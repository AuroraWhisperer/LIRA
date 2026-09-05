'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');
const SONGS_PATH = path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js');

class FakeWebSocket {
  static latest;

  constructor() {
    this.listeners = new Map();
    FakeWebSocket.latest = this;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  emit(type, payload) {
    for (const handler of this.listeners.get(type) || []) handler(payload);
  }
}

test('OBS song overlay reloads for cloud and local song invalidations only', async () => {
  const domHandlers = new Map();
  const timers = [];
  const globals = {
    window: {
      OverlayUtils: {},
      addEventListener() {},
      dispatchEvent() {},
    },
    document: {
      hidden: false,
      fonts: { addEventListener() {}, removeEventListener() {} },
      addEventListener(type, handler) {
        domHandlers.set(type, handler);
      },
      getElementById() {
        return null;
      },
    },
    location: { protocol: 'http:', host: 'localhost', search: '' },
    URLSearchParams,
    WebSocket: FakeWebSocket,
    fetch: async (url) => ({
      json: async () =>
        url === '/api/state'
          ? { ok: true, data: { settings: {} } }
          : { ok: true, data: [] },
    }),
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  };
  await loadModuleExports(SONGS_PATH, globals);
  domHandlers.get('DOMContentLoaded')();
  await new Promise((resolve) => setImmediate(resolve));
  const socket = FakeWebSocket.latest;
  const snapshot = (reason) =>
    socket.emit('message', {
      data: JSON.stringify({ type: 'snapshot', reason, state: { settings: {} } }),
    });

  snapshot('cloud:songs');
  snapshot('songs:created');
  snapshot('live:status');
  assert.equal(timers.length, 2);
});
