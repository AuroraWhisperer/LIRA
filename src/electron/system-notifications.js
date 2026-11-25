'use strict';

function createSystemNotifications({ Notification, getMainWindow, icon, writeLog, scope }) {
  const notifications = new Set();

  function show(title, body) {
    let notification;
    try {
      notification = new Notification({ title, body, ...(icon ? { icon } : {}) });
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
        writeLog(scope, { error: 'NOTIFICATION_FAILED' });
      });
      notification.show();
    } catch {
      if (notification) notifications.delete(notification);
      writeLog(scope, { error: 'NOTIFICATION_FAILED' });
    }
  }

  function clear() {
    for (const notification of notifications) {
      notification.removeAllListeners();
      notification.close();
    }
    notifications.clear();
  }

  return { show, clear };
}

module.exports = { createSystemNotifications };
