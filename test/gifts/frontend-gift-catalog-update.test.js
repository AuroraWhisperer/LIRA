'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { allNodes } = require('../helpers/fake-dom');

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

test('gift catalog progress ignores a stale startup response and completes in the same toast', async t => {
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
  t.after(() => controller.dispose());

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

  const node = controller.getNode();
  const progress = () => allNodes(node).find(child => child.tagName === 'progress');
  assert.equal(progress().value, 2);
  assert.ok(node.textContent.includes('40%'));
  stateListener({ status: 'ready', phase: 'complete', completed: 5, available: 5, total: 5 });
  assert.equal(controller.getNode(), node);
  assert.equal(progress().value, 5);
});
