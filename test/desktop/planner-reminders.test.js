'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const { createPlannerReminderController } = require('../../src/electron/planner-reminder-controller');
const { registerPlannerReminderIpc } = require('../../src/electron/ipc/planner-reminder-ipc');
const { loadModuleExports } = require('../helpers/frontend-modules');

function fixture(supported = true) {
  let time = new Date('2026-10-02T09:00:00').getTime();
  let nextTimer = 0;
  const timers = new Map();
  const notifications = [];
  const powerMonitor = new EventEmitter();
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
    getMainWindow: () => null,
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
  const shown = () => notifications.map(notification => notification.options.body.split('\n')[0]);
  return { controller, powerMonitor, notifications, timers, logs, reminder, advance, shown,
    now: () => time, sleep: ms => { time += ms; } };
}

const event = (id, reminderTime, date = '2026-10-02') => ({ id, title: id, detail: '', date, reminderTime });

async function renderer(f, sync = input => f.controller.sync(input)) {
  const { createPlannerReminderSync } = await loadModuleExports(
    path.join(__dirname, '../../public/js/admin/streamer-planner-reminders.js'),
    { Date: class extends Date { static now() { return f.now(); } } },
  );
  return createPlannerReminderSync({ getBridge: () => ({ sync }), onStatusChange() {} });
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

test('a full future agenda preserves selected wake-up notifications, reschedules and cancellations after historical overflow', async t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  let delay = 0;
  const sync = await renderer(f, input => {
    f.sleep(delay);
    delay = 0;
    const result = f.controller.sync(input);
    f.advance(0); // A timer can run before the renderer receives this IPC reply.
    return result;
  });
  const history = Array.from({ length: 1000 }, (_, id) => event(`past-${id}`, '12:00', '2026-10-01'));
  const due = event('due', '09:01');
  await sync.sync([...history, event('move', '09:02'), event('cancel', '09:01'), due]);
  assert.equal(sync.getStatus(), 'ready');
  f.sleep(119990);
  const later = Array.from({ length: 998 }, (_, id) => event(`later-${id}`, '09:05'));
  const future = [event('move', '09:03'), event('new', '09:02'), ...later];
  delay = 20;
  await sync.sync([...history, ...future, due]);
  assert.equal(sync.getStatus(), 'ready');
  f.powerMonitor.emit('resume');
  assert.deepEqual(f.shown().sort(), ['due', 'new']);
  await sync.sync([...future, event('one-more', '09:04'), event('beyond-capacity', '09:04')]);
  assert.equal(sync.getStatus(), 'limit');
  f.advance(60000);
  assert.deepEqual(f.shown().sort(), ['due', 'move', 'new']);
  f.advance(2 * 60000);
  assert.deepEqual(f.shown().sort(), ['due', ...future.map(item => item.id)].sort());
});

test('queued saves may cross the deadline before the native timer gets a turn', async t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  const due = event('remove', '09:01');
  const other = event('other', '12:00');
  const queue = [];
  const page = await renderer(f, input => new Promise(resolve => queue.push(() => resolve(f.controller.sync(input)))));
  const initial = page.sync([due, other]);
  queue.shift()();
  await initial;
  f.sleep(59990);
  const edited = { ...other, title: 'edited' };
  const saves = [page.sync([due, edited]), page.sync([edited])];
  f.sleep(20);
  for (const accept of queue) accept();
  await Promise.all(saves);
  f.advance(0);
  assert.deepEqual(f.shown(), []);
});

test('renderer reload retains only armed overdue entries across wake and clock rollback', async t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  const history = Array.from({ length: 1000 }, (_, id) => event(String(id), '08:59'));
  const due = event('due', '09:01');
  const saved = [...history, due];
  await (await renderer(f)).sync(saved);
  f.sleep(60000);
  const reloaded = await renderer(f);
  await reloaded.sync(saved);
  f.powerMonitor.emit('resume');
  f.advance(0);
  assert.deepEqual(f.shown(), ['due']);
  f.sleep(-60000);
  // 1,000 new appointments fit even when a delivered reminder looks future again.
  const future = Array.from({ length: 1000 }, (_, id) => event(`later-${id}`, '10:00'));
  await reloaded.sync([...saved, ...future]);
  assert.equal(reloaded.getStatus(), 'ready');
  f.advance(60000);
  assert.deepEqual(f.shown(), ['due']);
});

test('local appointments follow the current zone on resume and a clicked appointment stays delivered', async t => {
  const previousZone = process.env.TZ;
  t.after(() => {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  });
  process.env.TZ = 'Asia/Shanghai';
  const f = fixture();
  t.after(() => f.controller.dispose());
  const saved = [event('travel', '11:00')];
  const page = await renderer(f);
  await page.sync(saved);
  process.env.TZ = 'Asia/Tokyo';
  f.powerMonitor.emit('resume');
  f.advance(Date.parse('2026-10-02T11:00+09:00') - f.now());
  assert.deepEqual(f.shown(), ['travel']);
  f.notifications[0].emit('click');
  f.notifications[0].close();
  process.env.TZ = 'Asia/Bangkok';
  f.powerMonitor.emit('resume');
  await page.sync([...saved, event('other', '15:00')]);
  f.advance(Date.parse('2026-10-02T11:00+07:00') - f.now());
  assert.deepEqual(f.shown(), ['travel']);
});

test('an in-flight zone change or inconsistent sampled deadline cannot admit a 1001st native candidate', async t => {
  const previousZone = process.env.TZ;
  t.after(() => {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  });
  for (const changeZone of [true, false]) {
    process.env.TZ = 'Asia/Shanghai';
    const f = fixture();
    t.after(() => f.controller.dispose());
    const travel = event('original', '09:01');
    await (await renderer(f)).sync([travel]);
    if (changeZone) f.sleep(120000);
    const page = await renderer(f, snapshot => {
      if (changeZone) {
        process.env.TZ = 'Asia/Bangkok'; // 09:02 at capture, 08:02 at receipt.
      } else {
        const rows = snapshot.agenda.split('\n').map(JSON.parse);
        rows[0].remindAt = f.now() - 60000; // The sampled instant says past but local 09:01 is still future.
        snapshot.agenda = rows.map(row => JSON.stringify(row)).join('\n');
      }
      return f.controller.sync(snapshot);
    });
    await page.sync([travel, ...Array.from({ length: 1000 }, (_, id) => event(`new-${id}`, '10:00'))]);
    assert.equal(page.getStatus(), 'limit');
    f.advance(Date.parse('2026-10-02T10:01') - f.now());
    assert.deepEqual(f.shown(), ['original']);
  }
});

test('long historical bodies stay off the wire and a reloaded overdue reminder retains its body', async t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  const due = { ...event('due', '09:01'), detail: '唤醒时送达' };
  const history = Array.from({ length: 16000 }, (_, id) => ({
    ...event(`old-${id}`, '08:00', '2025-10-01'), title: '旧'.repeat(80), detail: '史'.repeat(500),
  }));
  assert.ok(JSON.stringify(history).length > 8 * 1024 * 1024);
  const saved = [...history, due];
  await (await renderer(f)).sync(saved);
  f.sleep(3 * 86400000);
  const page = await renderer(f, snapshot => {
    for (const row of snapshot.agenda.split('\n').map(JSON.parse)) {
      assert.equal(Object.hasOwn(row, 'title') || Object.hasOwn(row, 'detail'), false);
    }
    return f.controller.sync(snapshot);
  });
  await page.sync(saved);
  f.powerMonitor.emit('resume');
  assert.deepEqual(f.shown(), ['due']);
  assert.match(f.notifications[0].options.body, /唤醒时送达/);
});

test('legacy fixed-epoch schedules survive replacement by the matching local appointment across its deadline', async t => {
  const f = fixture();
  t.after(() => f.controller.dispose());
  const original = f.reminder({ id: 'due' });
  f.controller.sync([original]);
  f.sleep(60000);
  await (await renderer(f)).sync([event('due', '09:01')]);
  f.powerMonitor.emit('resume');
  f.sleep(-60000);
  f.controller.sync([original]);
  f.advance(60000);
  assert.deepEqual(f.shown(), ['due']);
});

test('the workbench switch cancels reminders without losing future schedules or replaying disabled deadlines', () => {
  const f = fixture();
  const first = f.reminder();
  const later = f.reminder({ id: 'later', remindAt: first.remindAt + 60000 });
  f.controller.sync([first, later]);
  f.controller.setEnabled(false);
  assert.equal(f.timers.size, 0);
  f.advance(60000);
  f.powerMonitor.emit('resume');
  f.controller.sync([first, later]);
  assert.equal(f.notifications.length, 0);
  assert.equal(f.timers.size, 0);
  f.controller.setEnabled(true);
  f.advance(60000);
  assert.equal(f.notifications.length, 1);
  f.controller.setEnabled(false);
  assert.equal(f.notifications[0].closed, true);
  f.controller.dispose();
});

test('invalid snapshots are rejected atomically without cancelling valid reminders', () => {
  const f = fixture();
  const valid = f.reminder();
  f.controller.sync([valid]);
  for (const input of [
    null,
    '[]',
    { capturedAt: f.now(), agenda: '', path: '/admin' },
    { capturedAt: 'now', agenda: '' },
    { capturedAt: f.now(), agenda: ' '.repeat(50 * 1024 * 1024 + 1) },
    { capturedAt: f.now(), agenda: JSON.stringify({ ...valid, localAt: '2026-02-30T09:01' }) },
    { capturedAt: f.now(), agenda: JSON.stringify({ ...valid, localAt: '2026-12-01T09:01' }) },
    { capturedAt: f.now(), agenda: JSON.stringify({ id: valid.id, remindAt: valid.remindAt, localAt: '2026-10-02T09:01' }) },
    Array(1001).fill(valid),
    [valid, valid],
    [{ ...valid, remindAt: 'tomorrow' }],
    [{ ...valid, title: 'x'.repeat(81) }],
    [{ ...valid, icon: 'C:/private/file' }],
    [{ ...valid, localAt: '2026-10-02T09:01' }],
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
    assert.deepEqual(handler(undefined, []), { ok: false, error: 'IPC_SOURCE_INVALID' });
    // The shared registrar permits /songs; planner reminders deliberately require /admin.
    mainFrame.url = `${baseUrl}/songs`;
    assert.deepEqual(handler(event, []), { ok: false, error: 'IPC_SOURCE_INVALID' });
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
