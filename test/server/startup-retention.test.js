'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startRetentionMaintenance } = require('../../src/server/startup-retention');

function fixture(t, enabled = 'true') {
  const settings = {
    autoRetentionOnStartup: enabled,
    giftEventRetentionDays: '0',
    superChatRetentionDays: '0',
    aiRequestLogRetentionDays: '30',
  };
  const result = {
    giftRawJsonCleared: 0, giftEventsDeleted: 0, requestsDeleted: 0,
    superChatsDeleted: 0, aiRequestLogsDeleted: 0, cooldownsDeleted: 0,
  };
  const timer = { unref: t.mock.fn() };
  const schedule = t.mock.method(global, 'setInterval', () => timer);
  const clear = t.mock.method(global, 'clearInterval', () => {});
  const log = t.mock.method(console, 'log', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  const settingsStore = { getSettings: t.mock.fn(() => settings) };
  const dataService = { runRetention: t.mock.fn(() => result) };
  return { settings, result, timer, schedule, clear, log, warn, settingsStore, dataService };
}

test('automatic retention checks existing policies at startup and hourly, respects dynamic settings and stops completely', (t) => {
  const f = fixture(t);
  const seen = [];
  f.dataService.runRetention.mock.mockImplementation(() => {
    seen.push({ ...f.settings });
    return f.result;
  });
  const stop = startRetentionMaintenance(f.settingsStore, f.dataService);
  assert.equal(f.dataService.runRetention.mock.callCount(), 1);
  assert.equal(f.schedule.mock.callCount(), 1);
  const [tick, intervalMs] = f.schedule.mock.calls[0].arguments;
  assert.equal(intervalMs, 60 * 60 * 1000);
  assert.equal(f.timer.unref.mock.callCount(), 1);
  f.settings.aiRequestLogRetentionDays = '7';
  tick();
  assert.equal(seen[1].aiRequestLogRetentionDays, '7');
  assert.equal(seen[1].giftEventRetentionDays, '0');
  assert.equal(seen[1].superChatRetentionDays, '0');
  assert.ok(f.dataService.runRetention.mock.calls.every((call) => call.arguments.length === 0),
    'the worker must not replace the configured retention policy');
  f.settings.autoRetentionOnStartup = 'false';
  tick();
  assert.equal(seen.length, 2);
  f.settings.autoRetentionOnStartup = 'true';
  tick();
  assert.equal(seen.length, 3);
  stop();
  stop();
  assert.equal(f.clear.mock.callCount(), 1);
  assert.equal(f.clear.mock.calls[0].arguments[0], f.timer);
  tick();
  assert.equal(seen.length, 3, 'an already queued callback cannot access disposed storage');
});

test('disabled automatic retention performs no work until enabled during the same runtime', (t) => {
  const f = fixture(t, 'false');
  const stop = startRetentionMaintenance(f.settingsStore, f.dataService);
  const [tick] = f.schedule.mock.calls[0].arguments;
  tick();
  assert.equal(f.dataService.runRetention.mock.callCount(), 0);
  f.settings.autoRetentionOnStartup = 'true';
  tick();
  assert.equal(f.dataService.runRetention.mock.callCount(), 1);
  stop();
});

test('settings and cleanup failures remain isolated and a later interval retries', (t) => {
  const f = fixture(t);
  f.settingsStore.getSettings.mock.mockImplementationOnce(() => { throw new Error('settings unavailable'); });
  const stop = startRetentionMaintenance(f.settingsStore, f.dataService);
  const [tick] = f.schedule.mock.calls[0].arguments;
  assert.equal(f.dataService.runRetention.mock.callCount(), 0);
  f.dataService.runRetention.mock.mockImplementationOnce(() => { throw new Error('cleanup failed'); });
  assert.doesNotThrow(tick);
  assert.doesNotThrow(tick);
  assert.equal(f.dataService.runRetention.mock.callCount(), 2);
  assert.deepEqual(f.warn.mock.calls.map((call) => call.arguments[1]), ['settings unavailable', 'cleanup failed']);
  stop();
});

test('retention logging includes compacted tables while accepting older result shapes', (t) => {
  const f = fixture(t);
  f.result.cooldownsDeleted = 1;
  const stop = startRetentionMaintenance(f.settingsStore, f.dataService);
  assert.match(f.log.mock.calls[0].arguments[0], /cooldowns=1 importBatches=0 songCooldowns=0/);
  f.result.cooldownsDeleted = 0;
  f.result.importBatchesDeleted = 2;
  f.result.songCooldownsDeleted = 3;
  f.schedule.mock.calls[0].arguments[0]();
  assert.match(f.log.mock.calls[1].arguments[0], /importBatches=2 songCooldowns=3/);
  assert.equal(f.warn.mock.callCount(), 0);
  stop();
});
