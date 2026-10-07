'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LiveStatusMonitor } = require('../../src/bilibili/danmaku/live-status-monitor');

for (const liveStatus of [0, 1]) {
  test(`late live status ${liveStatus} cannot affect a restarted monitor`, async (t) => {
    let resolveRoom;
    const statuses = [];
    const restarts = [];
    const monitor = new LiveStatusMonitor(
      {
        resolveRoomInfo: () =>
          new Promise((resolve) => {
            resolveRoom = resolve;
          }),
      },
      (room) => restarts.push(room),
      (status) => statuses.push(status),
    );
    t.after(() => monitor.stop());
    monitor.start({ roomId: '1', ownerName: 'old', liveStatus: 0 });
    const pending = monitor.checkLiveStatus();
    monitor.stop();
    monitor.start({ roomId: '2', ownerName: 'current', liveStatus: 0 });
    resolveRoom({ roomId: '1', ownerName: 'stale', liveStatus });
    await pending;
    assert.deepEqual(statuses, []);
    assert.deepEqual(restarts, []);
    assert.equal(monitor.ownerName, 'current');
    assert.equal(monitor.stopped, false);
  });
}

test('polling reports offline rooms, then reconnects exactly once when the room goes live', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  t.mock.method(console, 'log', () => {});
  const rooms = [{ roomId: '1', ownerName: '主播', liveStatus: 0 }, { roomId: '1', ownerName: '主播', liveStatus: 1 }];
  const pendingRooms = [];
  const statuses = [];
  const started = [];
  let finishReconnect;
  const monitor = new LiveStatusMonitor(
    {
      resolveRoomInfo: () => new Promise((resolve) => pendingRooms.push(() => resolve(rooms.shift()))),
    },
    (roomId) => new Promise((resolve) => {
      started.push(roomId);
      finishReconnect = resolve;
    }),
    (status) => statuses.push(status),
  );
  t.after(() => monitor.stop());
  monitor.start({ roomId: '1', ownerName: '旧名', liveStatus: 1 });
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(pendingRooms.length, 0, 'a room that is already live is not polled');

  monitor.start({ roomId: '1', ownerName: '旧名', liveStatus: 0 });
  t.mock.timers.tick(10 * 60 * 1000 - 1);
  assert.equal(pendingRooms.length, 0);
  t.mock.timers.tick(1);
  assert.equal(pendingRooms.length, 1);
  const overlapping = monitor.checkLiveStatus();
  assert.equal(pendingRooms.length, 1, 'an overlapping check does not issue a second lookup');
  pendingRooms.shift()();
  await overlapping;
  await new Promise(setImmediate);
  assert.deepEqual(statuses, [{ roomId: '1', isLive: false, ownerName: '主播', message: '未开播，历史消息监听中' }]);

  t.mock.timers.tick(10 * 60 * 1000);
  pendingRooms.shift()();
  await new Promise(setImmediate);
  assert.deepEqual(started, ['1']);
  assert.deepEqual(statuses.at(-1), { roomId: '1', isLive: true, ownerName: '主播', message: '已开播，正在重连礼物监听' });
  assert.equal(monitor.stopped, true, 'the poller stops before reconnecting');
  await monitor.checkLiveStatus();
  monitor.triggerLiveStarted('1');
  await new Promise(setImmediate);
  t.mock.timers.tick(30 * 60 * 1000);
  assert.equal(pendingRooms.length, 0);
  assert.deepEqual(started, ['1'], 'the live start reconnects once');
  monitor.start({ roomId: '1', ownerName: '主播', liveStatus: 0 });
  t.mock.timers.tick(10 * 60 * 1000);
  monitor.triggerLiveStarted('1');
  await new Promise(setImmediate);
  assert.equal(pendingRooms.length, 0, 'a restarted poller waits for the reconnect in flight');
  assert.deepEqual(started, ['1']);
  finishReconnect();
  await new Promise(setImmediate);
  assert.equal(monitor.reconnectInFlight, false);

  monitor.start({ roomId: '1', ownerName: '主播', liveStatus: 0 });
  monitor.setReconnectInFlight(true);
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(pendingRooms.length, 0, 'a client reconnect in flight suspends polling');
});
