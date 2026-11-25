'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./frontend-modules');

function response(payload) {
  return { ok: payload.ok !== false, text: async () => JSON.stringify(payload), json: async () => payload };
}

async function flushBlindboxTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function createBlindboxFixture({
  roomId = '',
  loggedIn = false,
  authAvailable = true,
  mappingState = { mode: 'v2', applied: true, customCount: 1 },
  catalogResponse,
  recentList,
  mappingVisible = true,
  cachedSale = {},
} = {}) {
  const mappingObservers = new Set();
  const container = { innerHTML: '', isConnected: true, closest: () => mappingVisible ? null : container,
    querySelectorAll: () => [] };
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
    querySelector: () => null,
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (documentListeners.get(type) === handler) documentListeners.delete(type);
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
          giftRecentList: recentList,
        }[id] || null
      );
    },
  };
  const window = {
    clearTimeout,
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (windowListeners.get(type) === handler) windowListeners.delete(type);
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
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            settings: { roomId: currentRoomId },
            blindBoxMapping: mappingState,
          },
        }),
      });
    }
    if (url === '/api/overtime/gifts/catalog') {
      if (catalogResponse) return catalogResponse.then(response);
      return Promise.resolve(
        response({
          ok: true,
          data: { schemaVersion: 2, gifts: [], blindBoxes: [] },
        }),
      );
    }
    if (url === '/api/overtime/gifts') return Promise.resolve(response({ ok: true, data: cachedSale }));
    if (url === '/api/overtime/gifts/refresh') {
      return new Promise((resolve) => refreshRequests.push({ resolve, options }));
    }
    return Promise.resolve(response({ ok: true, data: {} }));
  };

  window.fetch = fetch;
  const { giftBlindbox, giftNotification, initGiftPanel, renderGiftPanel, stateService, eventBus, findGiftArtwork } = await loadModuleExports(
    path.join(__dirname, 'gift-admin-graph.js'),
    {
      document,
      window,
      AbortController,
      clearTimeout,
      setTimeout,
      MutationObserver: class {
        constructor(callback) { this.callback = callback; }
        observe(target) { if (target === container) mappingObservers.add(this.callback); }
        disconnect() { mappingObservers.delete(this.callback); }
      },
      fetch,
      CustomEvent: class {
        constructor(type, { detail }) {
          this.type = type;
          this.detail = detail;
        }
      },
    },
  );
  initGiftPanel();
  await stateService.reloadState();
  await flushBlindboxTasks();
  giftBlindbox.renderBlindBoxList();

  return {
    container,
    setMappingVisible(visible) {
      mappingVisible = visible;
      for (const sync of mappingObservers) sync();
    },
    textarea,
    status,
    listToggle,
    visibleNames: () =>
      [
        ...container.innerHTML.matchAll(
          /<div class="blind-box-chip" data-blind-box-theme="[^"]+">[\s\S]*?<span class="bb-chip-name">([^<]+)<\/span>/g,
        ),
      ].map(([, name]) => name),
    window,
    document,
    fetchCalls,
    findGiftArtwork,
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
      eventBus.emit('state:saved', {
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
    module: giftBlindbox,
    stateService,
    eventBus,
    gifts: {
      blindbox: giftBlindbox,
      notification: giftNotification,
      renderGiftPanel,
    },
  };
}

module.exports = {
  createBlindboxFixture,
  flushBlindboxTasks,
};
