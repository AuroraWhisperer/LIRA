'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createPlannerReminderController } = require('../../src/electron/planner-reminder-controller');
const { registerPlannerReminderIpc } = require('../../src/electron/ipc/planner-reminder-ipc');

function fixture(supported = true) {
  let time = new Date('2026-10-02T09:00:00').getTime();
  let nextTimer = 0;
  const timers = new Map();
  const notifications = [];
  const powerMonitor = new EventEmitter();
  const focus = [];
  const logs = [];
  class Notification extends EventEmitter {
    static isSupported() {
      return supported;
    }
    constructor(options) {
      super();
      this.options = options;
    }
    show() {
      notifications.push(this);
    }
    close() {
      this.closed = true;
      this.emit('close');
    }
  }
  const controller = createPlannerReminderController({
    Notification,
    powerMonitor,
    getMainWindow: () => ({
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: () => focus.push('restore'),
      show: () => focus.push('show'),
      focus: () => focus.push('focus'),
    }),
    writeLog: (...args) => logs.push(args),
    now: () => time,
    setTimer(callback, delay) {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const reminder = (patch = {}) => ({ id: 'event-1', title: '学歌', detail: '练习新歌', remindAt: time + 60000, ...patch });
  function advance(ms) {
    time += ms;
    const queued = [...timers.values()];
    timers.clear();
    for (const timer of queued) timer.callback();
  }
  return { controller, powerMonitor, notifications, timers, focus, logs, reminder, advance };
}

test('native reminders wait for their deadline, retain the latest content and fire once', () => {
  const f = fixture();
  const reminder = f.reminder();
  assert.deepEqual(f.controller.sync([reminder]), { ok: true, supported: true });
  assert.equal(f.timers.size, 1);
  assert.equal(f.notifications.length, 0);
  f.advance(30000);
  assert.equal(f.notifications.length, 0);
  f.controller.sync([{ ...reminder, title: '新歌练习' }]);
  assert.equal(f.timers.size, 1);
  f.advance(30000);
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0].options.body, /新歌练习/);
  f.controller.sync([reminder]);
  f.powerMonitor.emit('resume');
  assert.equal(f.notifications.length, 1);
  assert.equal(f.timers.size, 0);
  f.notifications[0].emit('click');
  assert.deepEqual(f.focus, ['restore', 'show', 'focus']);
  f.controller.dispose();
});

test('rescheduling replaces the old deadline; removing or disabling cancels pending reminders', () => {
  const f = fixture();
  const original = f.reminder();
  f.controller.sync([original]);
  f.controller.sync([{ ...original, remindAt: original.remindAt + 60000 }]);
  f.advance(60000);
  assert.equal(f.notifications.length, 0);
  f.controller.sync([]);
  assert.equal(f.timers.size, 0);
  f.advance(60000);
  assert.equal(f.notifications.length, 0);
  f.controller.dispose();
});

test('startup skips past schedules but resume delivers already scheduled reminders once', () => {
  const f = fixture();
  const pending = f.reminder();
  f.controller.sync([
    f.reminder({ id: 'past', remindAt: pending.remindAt - 120000 }),
    f.reminder({ id: 'historic', remindAt: -315619200000 }),
    f.reminder({ id: 'epoch', remindAt: 0 }),
    pending,
  ]);
  f.advance(4 * 60 * 60 * 1000);
  f.powerMonitor.emit('resume');
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0].options.body, /学歌/);
  f.controller.sync([pending]);
  f.powerMonitor.emit('resume');
  assert.equal(f.notifications.length, 1);
  f.controller.dispose();
});

test('invalid snapshots are rejected atomically without cancelling valid reminders', () => {
  const f = fixture();
  const valid = f.reminder();
  f.controller.sync([valid]);
  for (const input of [
    null,
    {},
    [null],
    [valid, valid],
    [{ ...valid, remindAt: 'tomorrow' }],
    [{ ...valid, remindAt: Infinity }],
    [{ ...valid, title: 'x'.repeat(81) }],
    [{ ...valid, detail: 'x'.repeat(501) }],
    [{ ...valid, icon: 'C:/private/file' }],
  ]) {
    assert.deepEqual(f.controller.sync(input), { ok: false, error: 'PLANNER_REMINDERS_INVALID' });
  }
  f.advance(60000);
  assert.equal(f.notifications.length, 1);
  f.controller.dispose();
});

test('unsupported systems do not schedule; disposal clears timers, notifications and resume listeners', () => {
  const unsupported = fixture(false);
  assert.deepEqual(unsupported.controller.getState(), { ok: true, supported: false });
  assert.deepEqual(unsupported.controller.sync([unsupported.reminder()]), { ok: true, supported: false });
  assert.equal(unsupported.timers.size, 0);
  unsupported.controller.dispose();
  const f = fixture();
  f.controller.sync([f.reminder(), f.reminder({ id: 'later', remindAt: f.reminder().remindAt + 86400000 })]);
  f.advance(60000);
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.powerMonitor.listenerCount('resume'), 0);
  assert.equal(f.notifications[0].closed, true);
  f.powerMonitor.emit('resume');
  assert.equal(f.notifications.length, 1);
});

test('notification failure is logged without including private schedule content or retrying', () => {
  const f = fixture();
  f.controller.sync([f.reminder()]);
  f.advance(60000);
  f.notifications[0].emit('failed', {}, 'sensitive operating-system error');
  assert.equal(f.logs.length, 1);
  assert.doesNotMatch(JSON.stringify(f.logs), /学歌|练习|sensitive/);
  f.powerMonitor.emit('resume');
  assert.equal(f.notifications.length, 1);
  f.controller.dispose();
});

test('planner IPC accepts only the main admin frame and disposes both fixed channels', () => {
  const handlers = new Map();
  const calls = [];
  const baseUrl = 'http://127.0.0.1:31001';
  const mainFrame = { url: `${baseUrl}/admin` };
  const webContents = { mainFrame };
  const win = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: mainFrame };
  const dispose = registerPlannerReminderIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) },
    controller: {
      getState: () => ({ ok: true, supported: true }),
      sync: (value) => { calls.push(value); return { ok: true, supported: true }; },
    },
    getMainWindow: () => win,
    getDesktopBaseUrl: () => baseUrl,
  });
  assert.equal(handlers.size, 2);
  for (const handler of handlers.values()) {
    for (const source of [undefined, {}, { ...event, sender: {} }, { ...event, senderFrame: { url: mainFrame.url } }]) {
      assert.deepEqual(handler(source, []), { ok: false, error: 'IPC_SOURCE_INVALID' });
    }
    for (const url of [`${baseUrl}/license`, `${baseUrl}/songs`, `${baseUrl}/clock`, 'https://example.com/admin']) {
      mainFrame.url = url;
      assert.deepEqual(handler(event, []), { ok: false, error: 'IPC_SOURCE_INVALID' });
    }
    mainFrame.url = `${baseUrl}/admin`;
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(handlers.get('planner-reminders:get-state')(event), { ok: true, supported: true });
  assert.deepEqual(handlers.get('planner-reminders:get-state')(event, {}), { ok: false, error: 'IPC_ARGUMENTS_INVALID' });
  assert.deepEqual(handlers.get('planner-reminders:sync')(event), { ok: false, error: 'IPC_ARGUMENTS_INVALID' });
  assert.deepEqual(handlers.get('planner-reminders:sync')(event, [], {}), { ok: false, error: 'IPC_ARGUMENTS_INVALID' });
  assert.deepEqual(handlers.get('planner-reminders:sync')(event, []), { ok: true, supported: true });
  assert.deepEqual(calls, [[]]);
  dispose();
  assert.equal(handlers.size, 0);
});
