'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('calendar requests are shared, scoped to the active account and discarded on account change or disposal', async () => {
  const { createFanCalendar } = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/fans/calendar.js'));
  const requests = [], replies = [], rendered = [], listeners = new Map();
  let accountChanged, tick, unsubscribed = false, cleared = false, visible = true;
  const calendar = createFanCalendar({
    windowRef: {
      fanProfiles: { invoke: (request) => { requests.push(request); return new Promise((resolve) => replies.push(resolve)); } },
      liraLicense: { onStateChanged: (callback) => { accountChanged = callback; return () => { unsubscribed = true; }; } },
      setInterval: (callback) => { tick = callback; return 42; },
      clearInterval: (timer) => { assert.equal(timer, 42); cleared = true; },
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
      localStorage: { setItem: () => { throw new Error('Private reminders must not be persisted in planner storage'); } },
    },
    isVisible: () => visible,
    onChange: (events) => rendered.push(events),
  });
  const first = calendar.refresh();
  tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'calendar');
  accountChanged();
  assert.equal(requests.length, 2);
  replies[1]({ ok: true, data: [{ id: 'new-account' }] });
  await calendar.refresh();
  replies[0]({ ok: true, data: [{ id: 'old-account' }] });
  await first;
  assert.equal(calendar.getEvents()[0].id, 'new-account');
  assert.equal(rendered.some((items) => items[0]?.id === 'old-account'), false);
  const renderedCount = rendered.length;
  const unchanged = calendar.refresh();
  replies[2]({ ok: true, data: [{ id: 'new-account' }] });
  await unchanged;
  assert.equal(rendered.length, renderedCount, 'unchanged polls must not recreate calendar nodes');
  visible = false;
  await calendar.refresh();
  assert.equal(requests.length, 3);
  visible = true;
  const failed = calendar.refresh();
  replies[3]({ ok: false });
  await failed;
  assert.equal(calendar.getEvents().length, 0);
  const pending = calendar.refresh();
  listeners.get('pagehide')();
  replies[4]({ ok: true, data: [{ id: 'disposed' }] });
  await pending;
  tick();
  assert.equal(calendar.getEvents().length, 0);
  assert.equal(requests.length, 5);
  assert.equal(cleared, true);
  assert.equal(unsubscribed, true);
  assert.equal(listeners.size, 0);
});

test('profile changes clear hidden calendar data immediately and discard already pending results', async () => {
  const { createFanCalendar } = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/fans/calendar.js'));
  const listeners = new Map(), replies = [];
  let visible = true;
  const calendar = createFanCalendar({
    windowRef: {
      fanProfiles: { invoke: () => new Promise((resolve) => replies.push(resolve)) },
      setInterval: () => 1, clearInterval() {},
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
    },
    isVisible: () => visible, onChange() {},
  });
  const first = calendar.refresh();
  replies[0]({ ok: true, data: [{ id: 'fan' }] });
  await first;
  const pending = calendar.refresh();
  visible = false;
  listeners.get('fan-profiles-changed')();
  assert.equal(calendar.getEvents().length, 0);
  replies[1]({ ok: true, data: [{ id: 'fan' }] });
  await pending;
  assert.equal(calendar.getEvents().length, 0);
  visible = true;
  const fresh = calendar.refresh();
  replies[2]({ ok: true, data: [] });
  await fresh;
  calendar.dispose();
  assert.equal(listeners.size, 0);
});
