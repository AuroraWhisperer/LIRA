'use strict';

function createSystemNotifications({ Notification, getMainWindow, icon, writeLog, scope, timedOutLimit = 0 }) {
  const notifications = new Set();
  const timedOut = new Set();

  function forget(notification) {
    timedOut.delete(notification);
    notifications.delete(notification);
  }

  function dismiss(notification) {
    forget(notification);
    notification.removeAllListeners();
    notification.close();
  }

  function show(title, body) {
    let notification;
    try {
      notification = new Notification({ title, body, ...(icon ? { icon } : {}) });
      notifications.add(notification);
      notification.once('click', () => {
        if (timedOut.has(notification)) dismiss(notification);
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      });
      notification.on('close', (event) => {
        if (!timedOutLimit || event?.reason !== 'timedOut') return forget(notification);
        // Windows can keep a timed-out banner in Action Center until we close its handle.
        timedOut.add(notification);
        if (timedOut.size > timedOutLimit) dismiss(timedOut.values().next().value);
      });
      notification.once('failed', () => {
        forget(notification);
        writeLog(scope, { error: 'NOTIFICATION_FAILED' });
      });
      notification.show();
    } catch {
      if (notification) forget(notification);
      writeLog(scope, { error: 'NOTIFICATION_FAILED' });
    }
  }

  function clear() {
    for (const notification of notifications) dismiss(notification);
  }

  return { show, clear };
}

module.exports = { createSystemNotifications };
