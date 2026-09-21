'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./frontend-modules');

const ROOT_DIR = path.join(__dirname, '..', '..');

function response(payload) {
  return { ok: payload.ok !== false, text: async () => JSON.stringify(payload) };
}

async function flushBlindboxTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function createBlindboxFixture({
  roomId = '',
  loggedIn = false,
  authAvailable = true,
  mappingState = { mode: 'v2', applied: true, customCount: 1 },
} = {}) {
  const container = { innerHTML: '', querySelectorAll: () => [] };
  const textarea = { value: '[]' };
  const status = { textContent: '' };
  const listToggle = {
    hidden: true,
    textContent: '',
    attributes: { 'aria-expanded': 'false' },
    getAttribute(name) {
      return this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const windowListeners = new Map();
  const documentListeners = new Map();
  const refreshRequests = [];
  let currentRoomId = roomId;

  const document = {
    readyState: 'loading',
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    },
    dispatchEvent(event) {
      documentListeners.get(event.type)?.(event);
    },
    getElementById(id) {
      return (
        {
          blindBoxList: container,
          giftBlindBoxCustomConfigV2: textarea,
          blindBoxMappingStatus: status,
          blindBoxListToggle: listToggle,
        }[id] || null
      );
    },
  };
  const window = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    },
    dispatchEvent(event) {
      windowListeners.get(event.type)?.(event);
    },
    bilibiliAuth: {
      getAuthState: async () => ({ loggedIn }),
    },
  };
  if (!authAvailable) delete window.bilibiliAuth;

  const fetchCalls = [];
  const fetch = (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === '/api/state') {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: {
        settings: { roomId: currentRoomId }, blindBoxMapping: mappingState,
      } }) });
    }
    if (url === '/api/overtime/gifts/catalog') {
      return Promise.resolve(
        response({
          ok: true,
          data: { schemaVersion: 2, gifts: [], blindBoxes: [] },
        }),
      );
    }
    if (url === '/api/overtime/gifts/refresh') {
      return new Promise((resolve) =>
        refreshRequests.push({ resolve, options }),
      );
    }
    return Promise.resolve(response({ ok: true, data: {} }));
  };

  await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'),
    { document, window, fetch, CustomEvent: class {
      constructor(type, { detail }) { this.type = type; this.detail = detail; }
    } },
  );
  await window.AdminApp.state.reloadState();
  await flushBlindboxTasks();
  window.AdminApp.gifts.blindbox.renderBlindBoxList();

  return {
    container,
    textarea,
    status,
    listToggle,
    visibleNames: () =>
      [
        ...container.innerHTML.matchAll(
          /<div class="blind-box-chip">[\s\S]*?<span class="bb-chip-name">([^<]+)<\/span>/g,
        ),
      ].map(([, name]) => name),
    window,
    document,
    fetchCalls,
    refreshRequests,
    dispatchSettings(nextRoomId) {
      currentRoomId = nextRoomId;
      window.dispatchEvent({
        type: 'app:settings-state',
        detail: { roomId: nextRoomId },
      });
    },
    dispatchSavedSettings(nextRoomId) {
      currentRoomId = nextRoomId;
      window.AdminApp.eventBus.emit('state:saved', {
        settings: { roomId: nextRoomId },
      });
    },
    dispatchAuthChanged() {
      document.dispatchEvent({ type: 'app:bilibili-auth-changed' });
    },
    async resolveRefresh(data) {
      const request = refreshRequests.shift();
      assert.ok(request, 'expected a pending blind-box refresh request');
      request.resolve(response({ ok: true, data }));
      await flushBlindboxTasks();
    },
    module: window.AdminApp.gifts.blindbox,
  };
}

module.exports = {
  createBlindboxFixture,
  flushBlindboxTasks,
};
