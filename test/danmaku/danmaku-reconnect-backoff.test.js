'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BilibiliDanmakuClient } = require('../../src/bilibili/danmaku-client');

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(t, { liveStatus = 1 } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 10000 });
  const sockets = [];
  const control = { autoOpen: true };
  class Socket {
    static OPEN = 1;
    constructor() {
      this.listeners = new Map();
      this.readyState = 0;
      sockets.push(this);
      queueMicrotask(() => {
        if (control.autoOpen && this.readyState === 0) this.open();
      });
    }
    addEventListener(name, handler) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(handler);
    }
    removeEventListener(name, handler) {
      this.listeners.get(name)?.delete(handler);
    }
    emit(name, value) {
      for (const handler of this.listeners.get(name) || []) handler(value);
    }
    open() {
      this.readyState = 1;
      this.emit('open', {});
    }
    send() {}
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      queueMicrotask(() => this.emit('close', { code: 1000 }));
    }
    disconnect() {
      this.readyState = 3;
      this.emit('close', { code: 1006 });
    }
    packet(operation, body) {
      const payload = Buffer.from(JSON.stringify(body));
      const data = Buffer.alloc(16 + payload.length);
      data.writeUInt32BE(data.length, 0);
      data.writeUInt16BE(16, 4);
      data.writeUInt16BE(1, 6);
      data.writeUInt32BE(operation, 8);
      payload.copy(data, 16);
      this.emit('message', { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.length) });
    }
  }
  const original = global.WebSocket;
  global.WebSocket = Socket;
  const statuses = [];
  const client = new BilibiliDanmakuClient('123', { onStatus: (status) => statuses.push(status) });
  t.after(() => {
    client.stop();
    global.WebSocket = original;
  });
  for (const method of ['info', 'warn', 'log']) t.mock.method(console, method, () => {});
  client.apiClient.resolveRoomInfo = async () => ({ roomId: 123, uid: 456, liveStatus });
  client.apiClient.resolveDanmuInfo = async () => ({ token: 'synthetic', host_list: [{ host: 'synthetic.invalid' }] });
  for (const poller of [client.onlineRankPoller, client.fansMedalPoller]) {
    poller.start = () => {};
  }
  client.historyPoller.start = () => {
    client.historyPoller.timer = {};
  };
  client.historyPoller.stop = () => {
    client.historyPoller.timer = null;
  };
  client.start();
  await flush();
  return { client, sockets, control, statuses };
}

test('open-close failures back off 1/2/4/8/16/30 seconds and remain capped', async (t) => {
  const { client, sockets } = await fixture(t);
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    client.ws.disconnect();
    const count = sockets.length;
    t.mock.timers.tick(delay - 1);
    await flush();
    assert.equal(sockets.length, count, `no retry before ${delay}ms`);
    assert.ok(client.historyPoller.timer);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(sockets.length, count + 1);
    assert.equal(client.historyPoller.timer, null);
  }
});

test('a stable authenticated connection with heartbeat evidence resets the backoff', async (t) => {
  const { client, sockets } = await fixture(t);
  for (const delay of [1000, 2000]) {
    client.ws.disconnect();
    t.mock.timers.tick(delay);
    await flush();
  }
  const socket = client.ws;
  socket.packet(8, { code: 0 });
  for (let index = 0; index < 2; index += 1) {
    t.mock.timers.tick(30000);
    socket.packet(3, {});
  }
  socket.disconnect();
  const count = sockets.length;
  t.mock.timers.tick(999);
  await flush();
  assert.equal(sockets.length, count);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(sockets.length, count + 1);
});

test('duplicate scheduling retains the deadline, stop cancels and stale generation cannot revive it', async (t) => {
  const { client, sockets } = await fixture(t);
  const generation = client.connectionGeneration;
  client.ws.disconnect();
  const timer = client.reconnectTimer;
  t.mock.timers.tick(500);
  client.scheduleReconnect(generation);
  assert.equal(client.reconnectTimer, timer);
  t.mock.timers.tick(500);
  await flush();
  assert.equal(sockets.length, 2);
  client.ws.disconnect();
  client.stop();
  client.scheduleReconnect(generation);
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(sockets.length, 2);
  assert.equal(client.reconnectTimer, null);
});

test('manual restart cancels the old recovery timer and resets the failure count', async (t) => {
  const { client, sockets } = await fixture(t);
  client.ws.disconnect();
  const staleGeneration = client.connectionGeneration;
  await client.restart();
  assert.equal(sockets.length, 2);
  client.ws.disconnect();
  client.scheduleReconnect(staleGeneration);
  t.mock.timers.tick(999);
  await flush();
  assert.equal(sockets.length, 2);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(sockets.length, 3);
});

for (const outcome of ['success', 'failure']) {
  test(`live-start connection survives a superseded room lookup ${outcome}`, async (t) => {
    const { client, sockets, statuses } = await fixture(t, { liveStatus: 0 });
    const monitorLookup = Promise.withResolvers();
    const reconnectLookup = Promise.withResolvers();
    const pendingLookups = [monitorLookup.promise, reconnectLookup.promise];
    const liveRoom = { roomId: 123, uid: 456, liveStatus: 1, ownerName: 'current' };
    client.apiClient.resolveRoomInfo = () => pendingLookups.shift() || Promise.resolve(liveRoom);

    const liveCheck = client.liveStatusMonitor.checkLiveStatus();
    client.ws.disconnect();
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(pendingLookups.length, 0);
    monitorLookup.resolve(liveRoom);
    await liveCheck;
    const healthySocket = client.ws;
    healthySocket.packet(8, { code: 0 });
    const statusCount = statuses.length;

    if (outcome === 'success') reconnectLookup.resolve({ ...liveRoom, ownerName: 'superseded' });
    else reconnectLookup.reject(new Error('superseded request failed'));
    await flush();

    assert.equal(client.ws, healthySocket);
    assert.equal(healthySocket.readyState, 1);
    assert.equal(client.ownerName, 'current');
    assert.equal(statuses.length, statusCount);
    assert.equal(client.reconnectTimer, null);
    assert.equal(client.reconnecting, false);
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(sockets.length, 2);
  });
}

test('a superseded pending socket cannot schedule another retry after live-start reconnect succeeds', async (t) => {
  const { client, sockets, control, statuses } = await fixture(t);
  control.autoOpen = false;
  client.ws.disconnect();
  t.mock.timers.tick(1000);
  await flush();
  const supersededSocket = client.ws;
  assert.equal(supersededSocket.readyState, 0);

  const liveReconnect = client.reconnectAfterLiveStarted(123);
  await flush();
  const healthySocket = client.ws;
  assert.notEqual(healthySocket, supersededSocket);
  assert.equal(supersededSocket.readyState, 3);
  healthySocket.open();
  healthySocket.packet(8, { code: 0 });
  await liveReconnect;
  await flush();

  assert.equal(client.reconnectTimer, null);
  assert.equal(statuses.at(-1).connected, true);
  assert.equal(client.reconnecting, false);
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(client.ws, healthySocket);
  assert.equal(healthySocket.readyState, 1);
  assert.equal(sockets.length, 3);
});

test('closing the previous socket during live-start lookup leaves retry ownership with the new attempt', async (t) => {
  const { client, sockets } = await fixture(t, { liveStatus: 0 });
  const reconnectLookup = Promise.withResolvers();
  const liveRoom = { roomId: 123, uid: 456, liveStatus: 1 };
  let lookups = 0;
  client.apiClient.resolveRoomInfo = () => ++lookups === 1 ? Promise.resolve(liveRoom) : reconnectLookup.promise;
  const previousSocket = client.ws;
  const liveCheck = client.liveStatusMonitor.checkLiveStatus();
  await flush();
  assert.equal(lookups, 2);
  assert.equal(client.ws, previousSocket);

  previousSocket.disconnect();
  reconnectLookup.resolve(liveRoom);
  await liveCheck;
  const healthySocket = client.ws;
  assert.equal(client.reconnectTimer, null);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(client.ws, healthySocket);
  assert.equal(healthySocket.readyState, 1);
  assert.equal(sockets.length, 2);
});
