'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');
const TOAST_MODULE = path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'catalog-update-toast.js');

const { createDom } = require('../helpers/toast-dom');

function createEventBus() {
  const handlers = new Map();
  return {
    handlers,
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  };
}

async function loadToastFactory() {
  return loadModuleExports(TOAST_MODULE, {
    document: {},
    window: {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
}

test('gift catalog update toast subscribes before reading state and ignores a stale startup response', async () => {
  const { createGiftCatalogUpdateToast } = await loadToastFactory();
  const { documentRef, windowRef } = createDom();
  const eventBus = createEventBus();
  const calls = [];
  let stateListener = null;
  let resolveState;
  const licenseBridge = {
    onGiftCatalogStateChanged(listener) {
      calls.push('subscribe');
      stateListener = listener;
      return () => {
        stateListener = null;
      };
    },
    getGiftCatalogState() {
      calls.push('get');
      return new Promise((resolve) => {
        resolveState = resolve;
      });
    },
  };
  const controller = createGiftCatalogUpdateToast({
    document: documentRef,
    window: windowRef,
    eventBus,
    licenseBridge,
  });

  const initPromise = controller.init();
  assert.deepEqual(calls, ['subscribe', 'get']);
  stateListener({
    status: 'updating',
    phase: 'images',
    completed: 2,
    total: 5,
    available: 2,
    failed: 0,
  });
  resolveState({
    status: 'updating',
    phase: 'images',
    completed: 1,
    total: 5,
    available: 1,
    failed: 0,
  });
  await initPromise;

  assert.match(controller.getNode().children[0].children[1].textContent, /已处理 2 \/ 5/);
});
