'use strict';

const { createSystemNotifications } = require('./system-notifications');

const MAX_FUTURE = 1000;
// Electron's 100 MiB DOM storage quota counts UTF-16. Each wire row is smaller than its saved event.
const MAX_AGENDA_CHARS = 50 * 1024 * 1024;
// JSON escaping uses at most six characters per code unit of id/title/detail, plus the fixed fields.
const MAX_ROW_CHARS = 6 * (128 + 80 + 500) + 128;
const LEGACY_FIELDS = new Set(['id', 'title', 'detail', 'remindAt']);
const LOCAL_FIELDS = new Set([...LEGACY_FIELDS, 'localAt']);

function isTimestamp(value) {
  return Number.isSafeInteger(value) && Math.abs(value) <= 8.64e15;
}

function isLocalMinute(value, remindAt) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(`${value}Z`);
  // The epoch sampled by the renderer can be in a different zone from the one in effect at receipt.
  return Math.abs(date.getTime() - remindAt) <= 86400000 && date.toISOString().slice(0, 16) === value;
}

function* readAgenda(agenda) {
  for (let start = 0; start < agenda.length;) {
    const newline = agenda.indexOf('\n', start);
    const end = newline < 0 ? agenda.length : newline;
    if (end - start > MAX_ROW_CHARS) {
      yield null;
      return;
    }
    try {
      yield JSON.parse(agenda.slice(start, end));
    } catch {
      yield null;
      return;
    }
    start = end + 1;
  }
}

function readSnapshot(input, now) {
  if (Array.isArray(input)) {
    return input.length <= MAX_FUTURE ? { entries: input, capturedAt: now, fields: LEGACY_FIELDS } : null;
  }
  if (!input || typeof input !== 'object' || !isTimestamp(input.capturedAt) ||
      typeof input.agenda !== 'string' || input.agenda.length > MAX_AGENDA_CHARS ||
      Object.keys(input).some(key => key !== 'agenda' && key !== 'capturedAt')) return null;
  return { entries: readAgenda(input.agenda), capturedAt: input.capturedAt, fields: LOCAL_FIELDS };
}

function validReminder(value, { fields, capturedAt }) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !fields.has(key)) ||
      typeof value.id !== 'string' || !value.id || value.id.length > 128 || !isTimestamp(value.remindAt) ||
      (fields === LOCAL_FIELDS && !isLocalMinute(value.localAt, value.remindAt))) return false;
  if (fields === LOCAL_FIELDS && value.title === undefined && value.detail === undefined) {
    return Date.parse(`${value.localAt}Z`) + 86400000 <= capturedAt;
  }
  return typeof value.title === 'string' && value.title.trim() && value.title.length <= 80 &&
    typeof value.detail === 'string' && value.detail.length <= 500;
}

function deadline(reminder) {
  return reminder.localAt ? Date.parse(reminder.localAt) : reminder.remindAt;
}

function sameAppointment(key, { localAt, remindAt }) {
  if (localAt) return key === localAt || key === remindAt;
  return key === remindAt || (typeof key === 'string' && Date.parse(key) === remindAt);
}

function createPlannerReminderController({
  Notification,
  powerMonitor,
  getMainWindow,
  icon,
  writeLog = () => {},
  enabled = true,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let pending = new Map();
  // Only identities are needed for delivered or skipped entries still on the calendar.
  let settled = new Map();
  const notifications = createSystemNotifications({ Notification, getMainWindow, icon, writeLog, scope: 'planner-reminder' });
  let timer = null;
  let disposed = false;

  function getState() {
    return { ok: true, supported: Notification.isSupported() };
  }

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    cancelTimer();
    if (disposed || !enabled || !pending.size) return;
    let next = Infinity;
    for (const reminder of pending.values()) next = Math.min(next, deadline(reminder));
    // Recheck the clock at least once a minute without overflowing long timeouts.
    timer = setTimer(checkDue, Math.min(60000, Math.max(0, next - now())));
    timer?.unref?.();
  }

  function showReminder(reminder, at) {
    const time = new Intl.DateTimeFormat('zh-CN', {
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(at));
    notifications.show('LIRA · 日程提醒', [reminder.title, time, reminder.detail].filter(Boolean).join('\n'));
  }

  function settleDue(deliver) {
    const time = now();
    for (const [id, reminder] of pending) {
      const at = deadline(reminder);
      if (at > time) continue;
      pending.delete(id);
      settled.set(id, reminder.localAt ?? reminder.remindAt);
      if (deliver && Notification.isSupported()) showReminder(reminder, at);
    }
  }

  function checkDue() {
    if (disposed || !enabled) return;
    settleDue(true);
    schedule();
  }

  function sync(input) {
    if (disposed) return { ok: false, error: 'PLANNER_REMINDERS_STOPPED' };
    const time = now();
    const snapshot = readSnapshot(input, time);
    if (!snapshot) return { ok: false, error: 'PLANNER_REMINDERS_INVALID' };
    const state = getState();
    const next = new Map();
    const nextSettled = new Map();
    let futureAtCapture = 0;
    let futureAtReceipt = 0;
    for (const value of snapshot.entries) {
      if (!validReminder(value, snapshot) || next.has(value.id) || nextSettled.has(value.id)) {
        return { ok: false, error: 'PLANNER_REMINDERS_INVALID' };
      }
      const { id, localAt, remindAt } = value;
      const key = localAt ?? remindAt;
      const previous = pending.get(id);
      const wasPending = previous && sameAppointment(previous.localAt ?? previous.remindAt, value);
      const wasFuture = remindAt > snapshot.capturedAt;
      const isFuture = deadline(value) > time;
      const newlyPending = value.title !== undefined && (wasFuture || isFuture);
      if (!state.supported || sameAppointment(settled.get(id), value) || (!wasPending && !newlyPending)) {
        nextSettled.set(id, key);
        continue;
      }
      // A queued save can cross a deadline or a zone change. Bound both sets before replacing either map.
      if (wasFuture) futureAtCapture++;
      if (isFuture) futureAtReceipt++;
      if (futureAtCapture > MAX_FUTURE || futureAtReceipt > MAX_FUTURE) return { ok: false, error: 'PLANNER_REMINDERS_LIMIT' };
      next.set(id, { title: value.title ?? previous.title, detail: value.detail ?? previous.detail, localAt, remindAt });
    }
    pending = next;
    settled = state.supported ? nextSettled : new Map();
    // Leave notification delivery to the timer/resume, after queued edits can replace this snapshot.
    schedule();
    return state;
  }

  function setEnabled(value) {
    if (disposed || enabled === value) return;
    enabled = value;
    cancelTimer();
    if (enabled) {
      // Reminders that expired while disabled must not be replayed on enable.
      settleDue(false);
      schedule();
    } else {
      notifications.clear();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelTimer();
    powerMonitor.removeListener('resume', checkDue);
    pending.clear();
    settled.clear();
    notifications.clear();
  }

  powerMonitor.on('resume', checkDue);
  return { getState, sync, setEnabled, dispose };
}

module.exports = { createPlannerReminderController };
