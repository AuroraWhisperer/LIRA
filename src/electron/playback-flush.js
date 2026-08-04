'use strict';

let pendingFlush = null;

function requestPlaybackFlush(mainWindow, timeoutMs = 2000) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ status: 'skipped' });
  }

  return new Promise((resolve) => {
    let timer = null;
    const finish = (status, message) => {
      if (!pendingFlush || pendingFlush.finish !== finish) return;
      if (timer) clearTimeout(timer);
      pendingFlush = null;
      resolve(message ? { status, message } : { status });
    };

    pendingFlush = { finish };
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    try {
      mainWindow.webContents.send('app:prepare-shutdown');
    } catch (error) {
      finish('error', error.message || String(error));
    }
  });
}

function acknowledgePlaybackFlush() {
  if (!pendingFlush) return false;
  pendingFlush.finish('ack');
  return true;
}

module.exports = { acknowledgePlaybackFlush, requestPlaybackFlush };
