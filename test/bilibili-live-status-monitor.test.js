'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LiveStatusMonitor } = require('../src/bilibili/danmaku/live-status-monitor');

for (const liveStatus of [0, 1]) {
  test(`late live status ${liveStatus} cannot affect a restarted monitor`, async (t) => {
    let resolveRoom;
    const statuses = [];
    const restarts = [];
    const monitor = new LiveStatusMonitor(
      {
        resolveRoomInfo: () => new Promise((resolve) => {
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
