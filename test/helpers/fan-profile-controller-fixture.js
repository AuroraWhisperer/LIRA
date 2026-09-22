'use strict';

const assert = require('node:assert/strict');
const { createFanProfileController, fanScopeFor } = require('../../src/electron/fan-profile-controller');
const { registerFanProfileIpc } = require('../../src/electron/ipc/fan-profile-ipc');
const ORIGIN = 'http://127.0.0.1:3000';
const SCOPE_A = JSON.stringify(['https://lira.example', 'streamer-a']);
const SCOPE_B = JSON.stringify(['https://lira.example', 'streamer-b']);

class FakeTimers {
  pending = new Map();

  setTimeout(callback, delay) {
    const handle = {
      callback,
      delay,
      unrefCalled: false,
      unref() {
        this.unrefCalled = true;
      },
    };
    this.pending.set(handle, handle);
    return handle;
  }

  clearTimeout(handle) {
    this.pending.delete(handle);
  }

  runNext() {
    const handle = this.pending.values().next().value;
    assert.ok(handle, 'expected a scheduled retry');
    this.pending.delete(handle);
    handle.callback();
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fixture(t, options = {}) {
  const state = {
    authorized: true,
    streamerId: 'streamer-a',
    accountName: '虚构账号甲',
    epoch: 1,
    origin: 'https://lira.example',
    roomId: '42',
    ...options.state,
  };
  const calls = { execute: [], consume: [], fetch: [], roster: [], imports: [], unsubscribe: 0 };
  const settings = options.settings || new Map();
  const listeners = new Set();
  const timers = new FakeTimers();
  const getSettings = (scope) =>
    settings.get(scope) || {
      initialized: options.initialized !== false,
      cursor: 0,
      epoch: null,
      autoSyncGuardRoster: options.autoSyncGuardRoster === true,
    };
  const page = (streamerId = state.streamerId, nextCursor = 1) => ({
    version: 1,
    streamerId,
    epoch: 'remote-epoch',
    after: 0,
    nextCursor,
    events: [],
    hasMore: false,
  });
  const licenseManager = {
    isAuthorized: () => state.authorized,
    getCloudSyncIdentity: () => ({ streamerId: state.streamerId, accountName: state.accountName }),
    getRemoteBaseUrl: () => state.origin,
    getAuthorizationEpoch: () => state.epoch,
    onStateChanged(listener) {
      listeners.add(listener);
      return () => {
        calls.unsubscribe++;
        listeners.delete(listener);
      };
    },
    async getFanFactsInternal(input) {
      calls.fetch.push({ scope: fanScopeFor(licenseManager), ...input });
      return options.fetch ? options.fetch(input, state) : page();
    },
  };
  const service = {
    importGuardRoster(scope, snapshot, automaticDate) {
      calls.imports.push({ scope, snapshot });
      if (automaticDate)
        settings.set(scope, {
          ...getSettings(scope),
          lastGuardRosterAutoUpdate: { date: automaticDate, roomId: state.roomId },
        });
      return { created: 1, updated: 0, skipped: 0, total: 1 };
    },
    execute(scope, action, payload) {
      calls.execute.push({ scope, action, payload });
      if (action === 'settings') return getSettings(scope);
      if (action === 'configure') {
        const next = { ...getSettings(scope), ...payload, initialized: true };
        settings.set(scope, next);
        return next;
      }
      if (action === 'list') return { profiles: [{ id: 'fictional-profile', alias: '小海' }] };
      return { saved: true };
    },
    consumeFacts(scope, value) {
      calls.consume.push({ scope, page: value });
      const next = { ...getSettings(scope), cursor: value.nextCursor, epoch: value.epoch };
      settings.set(scope, next);
      return next;
    },
  };
  const controller = createFanProfileController({
    licenseManager,
    getService: () => service,
    timers,
    now: options.now,
    isWindowOpen: () => state.windowOpen === true,
    getRoomId: () => state.roomId,
    fetchGuardRoster: async (roomId, input) => {
      calls.roster.push({ roomId, ...input });
      return options.roster ? options.roster(input) : { roomId: '1234', members: [] };
    },
  });
  const handlers = new Map();
  const frame = { url: `${ORIGIN}/admin?desktop=1` };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  let mainWindow = window;
  const disposeIpc = registerFanProfileIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: (name) => handlers.delete(name) },
    controller,
    getMainWindow: () => mainWindow,
    getDesktopBaseUrl: () => ORIGIN,
  });
  const event = { sender: window.webContents, senderFrame: frame };
  const invoke = (request, sender = event) => handlers.get('fan-profiles:invoke')(sender, request);
  t.after(() => {
    disposeIpc();
    controller.dispose();
  });
  return {
    state,
    calls,
    settings,
    timers,
    page,
    licenseManager,
    service,
    controller,
    handlers,
    frame,
    window,
    event,
    invoke,
    disposeIpc,
    setWindow: (value) => {
      mainWindow = value;
    },
    listeners,
    emit: () => {
      for (const listener of listeners) listener();
    },
  };
}

module.exports = { fixture, deferred, ORIGIN, SCOPE_A, SCOPE_B };
