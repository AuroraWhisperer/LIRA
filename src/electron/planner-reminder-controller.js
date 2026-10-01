'use strict';

const REMINDER_FIELDS = new Set(['id', 'title', 'detail', 'remindAt']);

function validateReminders(values) {
  if (!Array.isArray(values) || values.length > 1000) return null;
  const ids = new Set();
  const reminders = [];
  for (const value of values) {
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).some((key) => !REMINDER_FIELDS.has(key)) ||
      typeof value.id !== 'string' || !value.id || value.id.length > 128 || ids.has(value.id) ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 80 ||
      typeof value.detail !== 'string' || value.detail.length > 500 ||
      !Number.isSafeInteger(value.remindAt) || !Number.isFinite(new Date(value.remindAt).getTime())
    ) return null;
    ids.add(value.id);
    reminders.push({ id: value.id, title: value.title, detail: value.detail, remindAt: value.remindAt });
  }
  return reminders;
}

function createPlannerReminderController({
  Notification,
  powerMonitor,
  getMainWindow,
  icon,
  writeLog = () => {},
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let reminders = new Map();
  const notifications = new Set();
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
    if (disposed) return;
    const pending = [...reminders.values()].filter((reminder) => !reminder.fired);
    if (!pending.length) return;
    const next = Math.min(...pending.map((reminder) => reminder.remindAt));
    // Recheck the clock at least once a minute without overflowing long timeouts.
    timer = setTimer(checkDue, Math.min(60000, Math.max(0, next - now())));
    timer?.unref?.();
  }

  function showReminder(reminder) {
    let notification;
    try {
      const time = new Intl.DateTimeFormat('zh-CN', {
        month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(reminder.remindAt));
      notification = new Notification({
        title: 'LIRA · 日程提醒',
        body: [reminder.title, time, reminder.detail].filter(Boolean).join('\n'),
        ...(icon ? { icon } : {}),
      });
      notifications.add(notification);
      notification.once('click', () => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      });
      notification.once('close', () => notifications.delete(notification));
      notification.once('failed', () => {
        notifications.delete(notification);
        writeLog('planner-reminder', { error: 'NOTIFICATION_FAILED' });
      });
      notification.show();
    } catch {
      if (notification) notifications.delete(notification);
      writeLog('planner-reminder', { error: 'NOTIFICATION_FAILED' });
    }
  }

  function checkDue() {
    if (disposed) return;
    cancelTimer();
    const time = now();
    for (const reminder of reminders.values()) {
      if (reminder.fired || reminder.remindAt > time) continue;
      reminder.fired = true;
      if (Notification.isSupported()) showReminder(reminder);
    }
    schedule();
  }

  function sync(values) {
    if (disposed) return { ok: false, error: 'PLANNER_REMINDERS_STOPPED' };
    const normalized = validateReminders(values);
    if (!normalized) return { ok: false, error: 'PLANNER_REMINDERS_INVALID' };
    const state = getState();
    const time = now();
    const next = new Map();
    if (state.supported) {
      for (const reminder of normalized) {
        const previous = reminders.get(reminder.id);
        next.set(reminder.id, {
          ...reminder,
          fired: previous?.remindAt === reminder.remindAt ? previous.fired : reminder.remindAt <= time,
        });
      }
    }
    reminders = next;
    schedule();
    return state;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelTimer();
    powerMonitor.removeListener('resume', checkDue);
    reminders.clear();
    for (const notification of notifications) {
      notification.removeAllListeners();
      notification.close();
    }
    notifications.clear();
  }

  powerMonitor.on('resume', checkDue);
  return { getState, sync, dispose };
}

module.exports = { createPlannerReminderController };
