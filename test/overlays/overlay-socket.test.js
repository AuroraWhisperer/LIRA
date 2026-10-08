'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');
const SOCKET_ENTRY = path.join(ROOT_DIR, 'public', 'js', 'overlays', 'socket-client.js');

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.closed = false;
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  close() {
    this.closed = true;
    this.emit('close', {});
  }
}

function createTimers() {
  const timers = [];
  return {
    timers,
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cancelled = true;
    },
    runNext() {
      const timer = timers.find((entry) => !entry.cancelled && !entry.ran);
      assert.ok(timer, 'expected a pending timer');
      timer.ran = true;
      timer.callback();
    },
  };
}

async function loadSocketModule() {
  FakeWebSocket.instances = [];
  return loadModuleExports(SOCKET_ENTRY, {
    WebSocket: FakeWebSocket,
    location: { protocol: 'https:', host: 'overlay.test' },
    window: { __API_TOKEN__: 'token value' },
  });
}

test('overlay socket builds the tokenized URL and starts idempotently', async () => {
  const { buildOverlaySocketUrl, createOverlaySocket } = await loadSocketModule();
  assert.equal(buildOverlaySocketUrl(), 'wss://overlay.test/ws?token=token%20value');

  const timers = createTimers();
  const controller = createOverlaySocket({
    WebSocketClass: FakeWebSocket,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const socket = controller.connect();
  assert.ok(socket);
  assert.equal(controller.start(), false);
  assert.equal(controller.connect(), socket);
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(FakeWebSocket.instances[0].url, 'wss://overlay.test/ws?token=token%20value');
});

test('overlay socket preserves and encodes its subscription topic across reconnects', async () => {
  const { buildOverlaySocketUrl, createOverlaySocket } = await loadSocketModule();
  assert.equal(buildOverlaySocketUrl({ token: '', topic: 'danmaku' }), 'wss://overlay.test/ws?topic=danmaku');
  assert.equal(
    buildOverlaySocketUrl({ topic: 'gift & chat' }),
    'wss://overlay.test/ws?token=token%20value&topic=gift%20%26%20chat',
  );
  const timers = createTimers();
  const controller = createOverlaySocket({
    topic: 'danmaku',
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  controller.start();
  const first = FakeWebSocket.instances[0];
  assert.equal(first.url, 'wss://overlay.test/ws?token=token%20value&topic=danmaku');
  first.emit('close');
  timers.runNext();
  assert.equal(FakeWebSocket.instances[1].url, first.url);
  controller.dispose();
});

test('closeOnError reconnects the current socket and ignores obsolete errors', async () => {
  const { createOverlaySocket } = await loadSocketModule();
  const timers = createTimers();
  let errors = 0;
  const controller = createOverlaySocket({
    closeOnError: true,
    reconnectBaseDelayMs: 1000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onError: () => { errors += 1; },
  });
  controller.start();
  const first = FakeWebSocket.instances[0];
  first.emit('error');
  assert.equal(first.closed, true);
  assert.equal(errors, 1);
  assert.equal(timers.timers.length, 1);
  assert.equal(timers.timers[0].delay, 1000);
  timers.runNext();
  const second = FakeWebSocket.instances[1];
  first.emit('error');
  assert.equal(second.closed, false);
  assert.equal(errors, 1);
  second.emit('error');
  assert.equal(second.closed, true);
  assert.equal(errors, 2, 'errors from subsequent connections remain observable');
  assert.equal(timers.timers[1].delay, 2000);
  controller.dispose();
  assert.equal(timers.timers[1].cancelled, true);
});

test('overlay socket leaves error handling to its caller unless closeOnError is enabled', async () => {
  const { createOverlaySocket } = await loadSocketModule();
  const timers = createTimers();
  const controller = createOverlaySocket({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  controller.start();
  const socket = FakeWebSocket.instances[0];
  socket.emit('error');
  assert.equal(socket.closed, false);
  assert.equal(timers.timers.length, 0);
  controller.dispose();
});

test('overlay socket retries with bounded exponential backoff and notifies recovery', async () => {
  const { createOverlaySocket } = await loadSocketModule();
  const timers = createTimers();
  let reconnects = 0;
  const controller = createOverlaySocket({
    WebSocketClass: FakeWebSocket,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onReconnect: () => {
      reconnects += 1;
    },
  });

  controller.start();
  for (const expectedDelay of [800, 1600, 3200, 6400, 12800, 25600, 30000]) {
    const socket = FakeWebSocket.instances.at(-1);
    socket.emit('close');
    assert.equal(timers.timers.at(-1).delay, expectedDelay);
    timers.runNext();
  }
  assert.equal(FakeWebSocket.instances.length, 8);

  FakeWebSocket.instances.at(-1).emit('open');
  assert.equal(reconnects, 1);
  FakeWebSocket.instances.at(-1).emit('close');
  assert.equal(timers.timers.at(-1).delay, 800);
});

test('overlay socket isolates parse failures and stale socket callbacks', async () => {
  const { createOverlaySocket } = await loadSocketModule();
  const timers = createTimers();
  const messages = [];
  let parseErrors = 0;
  const controller = createOverlaySocket({
    WebSocketClass: FakeWebSocket,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onMessage: (payload) => messages.push({ ...payload }),
    onParseError: () => {
      parseErrors += 1;
    },
  });

  controller.start();
  const firstSocket = FakeWebSocket.instances[0];
  firstSocket.emit('message', { data: '{invalid' });
  firstSocket.emit('message', { data: '{"type":"snapshot"}' });
  assert.equal(parseErrors, 1);
  assert.deepEqual(messages, [{ type: 'snapshot' }]);

  firstSocket.emit('close');
  timers.runNext();
  const secondSocket = FakeWebSocket.instances[1];
  firstSocket.emit('message', { data: '{"stale":true}' });
  secondSocket.emit('message', { data: '{"fresh":true}' });
  assert.deepEqual(messages, [{ type: 'snapshot' }, { fresh: true }]);
});

test('overlay socket dispose cancels reconnect and ignores the old close event', async () => {
  const { createOverlaySocket } = await loadSocketModule();
  const timers = createTimers();
  let closes = 0;
  const controller = createOverlaySocket({
    WebSocketClass: FakeWebSocket,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onClose: () => {
      closes += 1;
    },
  });

  controller.start();
  const socket = FakeWebSocket.instances[0];
  socket.emit('close');
  const reconnectTimer = timers.timers[0];
  controller.dispose();
  assert.equal(reconnectTimer.cancelled, true);
  socket.emit('close');
  assert.equal(closes, 1);
  assert.equal(controller.start(), false);
  assert.equal(FakeWebSocket.instances.length, 1);
});
