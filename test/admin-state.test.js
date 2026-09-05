'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT_DIR, 'public', 'js', 'admin', 'state.js');

class FakeWebSocket {
  constructor() {
    this.listeners = new Map();
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

function createGlobals(fetch) {
  const events = [];
  return {
    fetch,
    location: { protocol: 'http:', host: 'localhost' },
    window: {
      dispatchEvent(event) {
        events.push(event);
      },
    },
    document: {
      getElementById() {
        return { hidden: false, textContent: '', className: '' };
      },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    WebSocket: FakeWebSocket,
    events,
  };
}

test('Admin reloads songs for cloud invalidation and preserves snapshot filtering', async () => {
  const globals = createGlobals(async () => ({
    json: async () => ({ ok: true, data: { categories: [], tags: [] } }),
  }));
  const { StateService } = await loadModuleExports(STATE_PATH, globals);
  const service = new StateService();
  let reloads = 0;
  service.scheduleSongReload = () => {
    reloads += 1;
  };
  service.connectSocket();
  const socket = service.ws;
  const snapshot = (reason) =>
    socket.emit('message', {
      data: JSON.stringify({ type: 'snapshot', reason, state: {} }),
    });

  snapshot('cloud:songs');
  snapshot('songs:created');
  snapshot('live:status');
  assert.equal(reloads, 2);
});

test('Admin emits a fresh HTTP lyric version once and ignores duplicate or stale versions', async () => {
  const states = [
    { generation: 4, sequence: 1, text: 'fresh' },
    { generation: 4, sequence: 1, text: 'duplicate' },
    { generation: 3, sequence: 9, text: 'stale' },
  ];
  const globals = createGlobals(async () => ({
    json: async () => ({ ok: true, data: { lyricState: states.shift() } }),
  }));
  const { StateService } = await loadModuleExports(STATE_PATH, globals);
  const service = new StateService();

  await service.reloadState();
  await service.reloadState();
  await service.reloadState();

  assert.deepEqual(
    globals.events.filter((event) => event.type === 'app:lyric-state').map((event) => event.detail),
    [{ generation: 4, sequence: 1, text: 'fresh' }],
  );
  assert.equal(service.appState.lyricState.text, 'fresh');
});
