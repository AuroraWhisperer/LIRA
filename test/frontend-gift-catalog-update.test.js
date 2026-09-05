'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');
const TOAST_MODULE = path.join(
  ROOT_DIR,
  'public',
  'js',
  'admin',
  'gifts',
  'catalog-update-toast.js',
);

function createNode(tagName) {
  const classes = new Set();
  const node = {
    tagName,
    children: [],
    attributes: new Map(),
    className: '',
    parentNode: null,
    textContent: '',
    removed: false,
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      },
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    append(...children) {
      children.forEach((child) => {
        child.parentNode = this;
        this.children.push(child);
      });
    },
    prepend(child) {
      child.parentNode = this;
      this.children.unshift(child);
    },
    remove() {
      this.removed = true;
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter(
          (child) => child !== this,
        );
        this.parentNode = null;
      }
    },
  };
  return node;
}

function createDom() {
  const container = createNode('div');
  const documentRef = {
    getElementById(id) {
      return id === 'toast' ? container : null;
    },
    createElement(tagName) {
      return createNode(tagName);
    },
  };
  const windowListeners = new Map();
  const windowRef = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
  };
  return { container, documentRef, windowRef, windowListeners };
}

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
  });
}

function createTimers() {
  const timers = [];
  const cleared = [];
  return {
    timers,
    cleared,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout(id) {
      cleared.push(id);
    },
  };
}

test('gift catalog update toast stays silent for first init and catalog-only checks', async () => {
  const { createGiftCatalogUpdateToast } = await loadToastFactory();
  const { documentRef, windowRef } = createDom();
  const controller = createGiftCatalogUpdateToast({
    document: documentRef,
    window: windowRef,
  });

  controller.handleState({ status: 'running', phase: 'images', total: 4 });
  controller.handleState({ status: 'updating', phase: 'catalog', total: 4 });
  controller.handleState({ status: 'ready', phase: 'complete', total: 4 });

  assert.equal(controller.getNode(), null);
});

test('gift catalog update toast shows a background completion without prior progress', async () => {
  const { createGiftCatalogUpdateToast } = await loadToastFactory();
  const { container, documentRef, windowRef } = createDom();
  const timers = createTimers();
  const controller = createGiftCatalogUpdateToast({
    document: documentRef,
    window: windowRef,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  const state = {
    status: 'ready',
    phase: 'complete',
    background: true,
    completed: 1,
    total: 1,
    available: 1,
    failed: 0,
    completedAt: '2026-09-05T01:02:03.000Z',
  };
  controller.handleState(state);
  controller.handleState(state);

  assert.equal(container.children.length, 1);
  assert.equal(controller.getNode().children[0].textContent, '礼物图片更新完成');
  assert.equal(timers.timers.length, 1);
});

test('gift catalog update toast warns instead of reporting success for a fatal background error', async () => {
  const { createGiftCatalogUpdateToast } = await loadToastFactory();
  const { documentRef, windowRef } = createDom();
  const controller = createGiftCatalogUpdateToast({
    document: documentRef,
    window: windowRef,
  });

  controller.handleState({
    status: 'ready',
    phase: 'complete',
    background: true,
    completed: 1,
    total: 1,
    available: 1,
    failed: 0,
    completedAt: '2026-09-05T01:02:03.000Z',
    error: 'CATALOG_ASSET_STATE_WRITE_FAILED',
  });

  assert.equal(controller.getNode().children[0].textContent, '礼物图片更新失败');
  assert.equal(controller.getNode().children[1].textContent, '下次检查时重试');
});

test('gift catalog update toast updates one node while image progress advances', async () => {
  const { createGiftCatalogUpdateToast } = await loadToastFactory();
  const { container, documentRef, windowRef } = createDom();
  const controller = createGiftCatalogUpdateToast({
    document: documentRef,
    window: windowRef,
  });

  controller.handleState({
    status: 'updating',
    phase: 'images',
    completed: 2,
    total: 5,
    available: 2,
    failed: 0,
  });
  const node = controller.getNode();
  assert.equal(container.children.length, 1);
  assert.equal(node.children[0].textContent, '正在更新礼物图片');
  assert.match(node.children[1].textContent, /已处理 2 \/ 5/);
  assert.equal(node.children[2].tagName, 'progress');
  assert.equal(node.children[2].max, 5);
  assert.equal(node.children[2].value, 2);

  controller.handleState({
    status: 'updating',
    phase: 'images',
    completed: 3,
    total: 5,
    available: 3,
    failed: 0,
  });
  assert.equal(controller.getNode(), node);
  assert.equal(container.children.length, 1);
  assert.match(node.children[1].textContent, /已处理 3 \/ 5/);
  assert.equal(node.children[2].value, 3);
});

test('gift catalog update toast reports success and partial completion', async () => {
  const { createGiftCatalogUpdateToast } = await loadToastFactory();
  const { documentRef, windowRef } = createDom();
  const timers = createTimers();
  const controller = createGiftCatalogUpdateToast({
    document: documentRef,
    window: windowRef,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  controller.handleState({
    status: 'updating',
    phase: 'images',
    completed: 2,
    total: 2,
    available: 2,
    failed: 0,
  });
  controller.handleState({
    status: 'ready',
    phase: 'complete',
    completed: 2,
    total: 2,
    available: 2,
    failed: 0,
  });
  const node = controller.getNode();
  assert.equal(node.children[0].textContent, '礼物图片更新完成');
  assert.equal(timers.timers.length, 1);

  controller.handleState({
    status: 'updating',
    phase: 'images',
    completed: 1,
    total: 2,
    available: 0,
    failed: 1,
  });
  controller.handleState({
    status: 'ready',
    phase: 'complete',
    completed: 2,
    total: 2,
    available: 1,
    failed: 1,
  });
  assert.equal(controller.getNode(), node);
  assert.equal(node.children[0].textContent, '部分图片暂未更新');
  assert.equal(node.children[1].textContent, '下次检查时重试');
  assert.equal(timers.timers.length, 2);
});

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

  assert.match(controller.getNode().children[1].textContent, /已处理 2 \/ 5/);
});

test('gift catalog update toast cleans up bridge, shutdown, pagehide, and completion timers', async () => {
  const { createGiftCatalogUpdateToast } = await loadToastFactory();
  const { container, documentRef, windowRef, windowListeners } = createDom();
  const eventBus = createEventBus();
  const timers = createTimers();
  let bridgeUnsubscribed = false;
  const licenseBridge = {
    onGiftCatalogStateChanged() {
      return () => {
        bridgeUnsubscribed = true;
      };
    },
    getGiftCatalogState: async () => ({
      status: 'updating',
      phase: 'catalog',
      total: 0,
    }),
  };
  const controller = createGiftCatalogUpdateToast({
    document: documentRef,
    window: windowRef,
    eventBus,
    licenseBridge,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  await controller.init();
  controller.handleState({
    status: 'updating',
    phase: 'images',
    completed: 1,
    total: 1,
    available: 1,
    failed: 0,
  });
  controller.handleState({
    status: 'ready',
    phase: 'complete',
    completed: 1,
    total: 1,
    available: 1,
    failed: 0,
  });
  assert.equal(container.children.length, 1);

  controller.dispose();

  assert.equal(bridgeUnsubscribed, true);
  assert.equal(eventBus.handlers.size, 0);
  assert.equal(windowListeners.size, 0);
  assert.deepEqual(timers.cleared, [1]);
  assert.equal(container.children.length, 0);
});
