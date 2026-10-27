'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function createFixture({ json = JSON } = {}) {
  const requests = [];
  const urls = [];
  const timers = new Map();
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
  const { StateService } = await loadModuleExports(path.resolve('public/js/admin/state.js'), {
    JSON: json,
    window,
    location: { protocol: 'http:', host: '127.0.0.1:3000' },
    WebSocket: Socket,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    URLSearchParams,
    fetch: (url) => {
      urls.push(url);
      return new Promise((resolve) => requests.push((data) => resolve({ json: async () => ({ ok: true, data }) })));
    },
    setTimeout(callback) { const id = {}; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const service = new StateService();
  service.connectSocket();
  return { service, requests, urls, timers, events, eventBus: window.AdminApp.eventBus };
}

test('song filters only read songs and identical pending refreshes share a request', async () => {
  const { service, requests, urls } = await createFixture();
  const options = { filters: { query: 'example' } };
  const first = service.reloadSongs(options);
  const second = service.reloadSongs(options);
  assert.deepEqual(urls, ['/api/songs?query=example']);
  requests[0]([{ id: 1 }]);
  await Promise.all([first, second]);
  assert.equal(urls.length, 1);
  assert.equal(service.getSongs()[0].id, 1);
});

test('snapshot comparison avoids serializing large fields and sees mutable and realtime updates', async () => {
  let serialized = 0;
  const { service, eventBus } = await createFixture({ json: { parse: JSON.parse,
    stringify(value) { serialized++; return JSON.stringify(value); } } });
  const changes = [];
  eventBus.on('state:loaded', (payload) => changes.push(Array.from(payload.changedKeys)));
  const snapshot = { settings: { roomId: '123' }, lyricTimeline: { lines: Array.from({ length: 2000 }, (_, i) => [i, '歌词']) } };
  service.applySnapshot(snapshot);
  service.applySnapshot(structuredClone(snapshot));
  assert.equal(changes.length, 1);
  service.getAppState().settings.roomId = 'local';
  service.applySnapshot(structuredClone(snapshot));
  assert.deepEqual(changes.at(-1), ['settings']);
  service.applyRealtimeField('lyricTimeline', { lines: [[1, '更新']] });
  service.applySnapshot(structuredClone(snapshot));
  assert.deepEqual(changes.at(-1), ['lyricTimeline']);
  assert.equal(serialized, 0);
});

test('mutation refresh consumes its queued song notification but preserves later invalidation', async () => {
  const { service, requests, urls, timers } = await createFixture();
  service.ws.receive({ type: 'snapshot', reason: 'songs:add', state: { categories: [] } });
  const mutationRefresh = service.reloadAll();
  requests[0]({ categories: [] });
  await new Promise(setImmediate);
  assert.equal(timers.size, 0);
  assert.deepEqual(urls, ['/api/state', '/api/songs?']);
  service.ws.receive({ type: 'snapshot', reason: 'cloud:songs', state: { categories: [] } });
  const [id, refresh] = [...timers][0];
  timers.delete(id);
  refresh();
  assert.equal(urls.length, 3);
  requests[2]([{ id: 2 }]);
  await new Promise(setImmediate);
  requests[1]([{ id: 1 }]);
  await mutationRefresh;
  assert.equal(service.getSongs()[0].id, 2);
});

test('a mutation without a socket echo cannot reuse a pre-mutation song request', async () => {
  const { service, requests, urls } = await createFixture();
  const old = service.reloadSongs();
  const mutationRefresh = service.reloadAll();
  requests[1]({ categories: [] });
  await new Promise(setImmediate);
  assert.deepEqual(urls, ['/api/songs?', '/api/state', '/api/songs?']);
  requests[2]([{ id: 2 }]);
  await mutationRefresh;
  requests[0]([{ id: 1 }]);
  await old;
  assert.equal(service.getSongs()[0].id, 2);
});

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
  assert.equal(events.filter((event) => event.type === 'app:settings-state').length, 1);
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
