'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

async function createFixture() {
  const requests = [];
  const events = [];
  class Socket {
    constructor() {
      this.handlers = new Map();
    }
    addEventListener(name, handler) {
      this.handlers.set(name, handler);
    }
    receive(payload) {
      this.handlers.get('message')({ data: JSON.stringify(payload) });
    }
  }
  const window = {
    dispatchEvent(event) {
      events.push(event);
    },
  };
  const { StateService } = await loadModuleExports(
    path.resolve('public/js/admin/state.js'),
    {
      window,
      document: { getElementById: () => ({}), querySelectorAll: () => [] },
      location: { protocol: 'http:', host: '127.0.0.1:3000' },
      WebSocket: Socket,
      CustomEvent: class {
        constructor(type, options) {
          this.type = type;
          this.detail = options.detail;
        }
      },
      fetch: () =>
        new Promise((resolve) =>
          requests.push((data) =>
            resolve({ json: async () => ({ ok: true, data }) }),
          ),
        ),
      setTimeout,
      clearTimeout,
    },
  );
  const service = new StateService();
  service.connectSocket();
  return { service, requests, events, eventBus: window.AdminApp.eventBus };
}

test('an older HTTP snapshot cannot replace a newer WebSocket snapshot', async () => {
  const { service, requests } = await createFixture();
  const reload = service.reloadState();
  service.ws.receive({
    type: 'snapshot',
    state: {
      settings: { roomId: 'new' },
      categories: [{ name: 'new' }],
      overtime: { revision: 8 },
    },
  });
  requests[0]({
    settings: { roomId: 'old' },
    categories: [],
    overtime: { revision: 7 },
  });
  await reload;
  assert.equal(service.getAppState().settings.roomId, 'new');
  assert.equal(service.getCategories()[0].name, 'new');
  assert.equal(service.getAppState().overtime.revision, 8);
});

test('concurrent HTTP state requests only accept the latest request', async () => {
  const { service, requests } = await createFixture();
  const older = service.reloadState();
  const newer = service.reloadState();
  requests[1]({ settings: { roomId: 'new' } });
  await newer;
  requests[0]({ settings: { roomId: 'old' } });
  await older;
  assert.equal(service.getAppState().settings.roomId, 'new');
});

test('HTTP hydration keeps newer partial updates while accepting unrelated fields', async () => {
  const { service, requests } = await createFixture();
  const reload = service.reloadState();
  service.ws.receive({ type: 'overtime:update', state: { revision: 8 } });
  service.ws.receive({ type: 'wesing-state', state: { track: 'new' } });
  service.ws.receive({ type: 'lyric-timeline', timeline: { sequence: 9 } });
  requests[0]({
    settings: { roomId: '123' },
    overtime: { revision: 7 },
    weSing: { track: 'old' },
    lyricTimeline: { sequence: 8 },
  });
  await reload;
  assert.equal(service.getAppState().settings.roomId, '123');
  assert.equal(service.getAppState().overtime.revision, 8);
  assert.equal(service.getAppState().weSing.track, 'new');
  assert.equal(service.getAppState().lyricTimeline.sequence, 9);
});

test('snapshots preserve newer overtime and lyric revisions', async () => {
  const { service } = await createFixture();
  service.ws.receive({ type: 'overtime:update', state: { revision: 8 } });
  service.ws.receive({
    type: 'lyric-state',
    state: { generation: 1, sequence: 9 },
  });
  service.ws.receive({
    type: 'snapshot',
    state: {
      overtime: { revision: 7 },
      lyricState: { generation: 1, sequence: 8 },
    },
  });
  assert.equal(service.getAppState().overtime.revision, 8);
  assert.equal(service.getAppState().lyricState.sequence, 9);
});

test('gift-only snapshots do not redispatch unchanged settings', async () => {
  const { service, events, eventBus } = await createFixture();
  const changes = [];
  eventBus.on('state:loaded', (payload) => changes.push(payload.changedKeys));
  const state = { settings: { roomId: '123' }, gifts: { recent: [] } };
  service.ws.receive({ type: 'snapshot', state });
  service.ws.receive({
    type: 'snapshot',
    state: { ...state, gifts: { recent: [{ id: 1 }] } },
  });
  assert.equal(
    events.filter((event) => event.type === 'app:settings-state').length,
    1,
  );
  assert.deepEqual(Array.from(changes[1]), ['gifts']);
});

test('a reconnect snapshot accepts restarted overtime without letting old HTTP restore the previous server', async () => {
  const { service, requests } = await createFixture();
  service.ws.receive({ type: 'overtime:update', state: { revision: 90 } });
  const pending = service.reloadState();
  service.ws.receive({
    type: 'snapshot',
    reason: 'connect',
    state: { overtime: { revision: 1, enabled: false } },
  });
  requests[0]({ overtime: { revision: 90, enabled: true } });
  await pending;
  assert.equal(service.getAppState().overtime.revision, 1);
  assert.equal(service.getAppState().overtime.enabled, false);
  service.ws.receive({ type: 'overtime:update', state: { revision: 2 } });
  assert.equal(service.getAppState().overtime.revision, 2);
});
