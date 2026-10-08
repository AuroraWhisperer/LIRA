'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');

const sandbox = {};
vm.runInNewContext(
  `${readJsModuleBundle('public', 'js', 'admin', 'streamer-planner-reminders.js')}\nthis.createReminderSync = createPlannerReminderSync;`,
  sandbox,
);
const createReminderSync = sandbox.createReminderSync;
const event = { id: 'event-1', title: '学歌', detail: '', date: '2026-10-02', reminderTime: '20:00' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('missing desktop bridge remains unsupported without publishing status changes', async () => {
  const statuses = [];
  const reminders = createReminderSync({
    getBridge: () => undefined,
    onStatusChange: (...status) => statuses.push(status),
  });
  assert.equal(reminders.getStatus(), 'unsupported');
  await reminders.sync([event]);
  assert.deepEqual(statuses, []);
});

test('unsupported native notifications preserve the unsupported status', async () => {
  const statuses = [];
  const reminders = createReminderSync({
    getBridge: () => ({ sync: async () => ({ ok: true, supported: false }) }),
    onStatusChange: (...status) => statuses.push(status),
  });
  assert.equal(reminders.getStatus(), 'loading');
  await reminders.sync([event]);
  assert.equal(reminders.getStatus(), 'unsupported');
  assert.deepEqual(statuses, [['unsupported', 'loading']]);
});

test('duplicate snapshots share the pending sync and do not invalidate its result', async () => {
  const pending = deferred();
  const calls = [];
  const statuses = [];
  const reminders = createReminderSync({
    getBridge: () => ({ sync(value) { calls.push(value); return pending.promise; } }),
    onStatusChange: (...status) => statuses.push(status),
  });
  const first = reminders.sync([event, { ...event, id: 'no-reminder', reminderTime: '' }]);
  await reminders.sync([{ ...event }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(calls[0][0].remindAt, new Date('2026-10-02T20:00:00').getTime());
  assert.equal(reminders.getStatus(), 'loading');
  pending.resolve({ ok: true, supported: true });
  await first;
  await reminders.sync([event]);
  assert.equal(calls.length, 1);
  assert.deepEqual(statuses, [['ready', 'loading']]);
});

test('a stale sync rejection cannot overwrite a newer successful snapshot', async () => {
  const older = deferred();
  const newer = deferred();
  const pending = [older, newer];
  const statuses = [];
  const reminders = createReminderSync({
    getBridge: () => ({ sync: () => pending.shift().promise }),
    onStatusChange: (...status) => statuses.push(status),
  });
  const first = reminders.sync([event]);
  const second = reminders.sync([{ ...event, title: '新日程' }]);
  newer.resolve({ ok: true, supported: true });
  await second;
  older.reject(new Error('Old sync failed'));
  await first;
  assert.equal(reminders.getStatus(), 'ready');
  assert.deepEqual(statuses, [['ready', 'loading']]);
});

test('a stale successful reply cannot hide the current error or prevent a retry', async () => {
  const older = deferred();
  const newer = deferred();
  const retry = deferred();
  const pending = [older, newer, retry];
  const statuses = [];
  const reminders = createReminderSync({
    getBridge: () => ({ sync: () => pending.shift().promise }),
    onStatusChange: (...status) => statuses.push(status),
  });
  const changed = [{ ...event, title: '新日程' }];
  const first = reminders.sync([event]);
  const second = reminders.sync(changed);
  newer.resolve({ ok: false });
  await second;
  older.resolve({ ok: true, supported: true });
  await first;
  assert.equal(reminders.getStatus(), 'error');
  assert.deepEqual(statuses, [['error', 'loading']]);
  const third = reminders.sync(changed);
  assert.equal(pending.length, 0);
  retry.resolve({ ok: true, supported: true });
  await third;
  assert.equal(reminders.getStatus(), 'ready');
  assert.deepEqual(statuses, [['error', 'loading'], ['ready', 'error']]);
});

test('a rejected sync allows the unchanged snapshot to be saved again', async () => {
  let calls = 0;
  const reminders = createReminderSync({
    getBridge: () => ({ async sync() {
      if (++calls === 1) throw new Error('IPC failed');
      return { ok: true, supported: true };
    } }),
    onStatusChange() {},
  });
  await reminders.sync([event]);
  assert.equal(reminders.getStatus(), 'error');
  await reminders.sync([event]);
  assert.equal(calls, 2);
  assert.equal(reminders.getStatus(), 'ready');
});
