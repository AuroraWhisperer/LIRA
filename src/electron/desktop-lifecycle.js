'use strict';

function createDesktopLifecycle({
  app, dialog, getMainWindow, hasRuntime, hasActiveOverlayConnections,
  stopResourceIntegrity, drainBeforeRuntimeStop, stopRuntime,
  disposeRequestAuth, disposeLicense, disposeDiagnostics, writeLog,
  timers = { setTimeout, clearTimeout },
}) {
  let shutdownPromise = null;
  let closePromptPromise = null;

  function requestClose() {
    if (shutdownPromise) return shutdownPromise;
    if (closePromptPromise) return closePromptPromise;
    if (!hasActiveOverlayConnections()) return requestShutdown();
    const options = {
      type: 'question',
      title: '退出 LIRA',
      message: '仍有浏览器源连接，确定退出？',
      detail: '退出后，连接中的本机画面将停止更新。',
      buttons: ['取消退出', '退出 LIRA'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const window = getMainWindow();
    const result = window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options);
    closePromptPromise = result.then(({ response }) => {
      if (response === 1) return requestShutdown();
    }).catch((error) => writeLog('close-prompt-error', error)).finally(() => {
      closePromptPromise = null;
    });
    return closePromptPromise;
  }

  function requestShutdown({ restart = false, exitCode = 0 } = {}) {
    if (shutdownPromise) return shutdownPromise;
    // The first request owns the final action and deadline, including reentry.
    const { promise, resolve } = Promise.withResolvers();
    shutdownPromise = promise;
    let finished = false;
    writeLog('lifecycle', { event: 'QUIT_BEGIN' });
    const deadline = timers.setTimeout(() => finish('QUIT_TIMEOUT'), 5000);

    function logError(error) {
      writeLog('shutdown-error', error);
      console.warn('Shutdown failed:', error.message);
    }

    function finish(event) {
      if (finished) return;
      finished = true;
      timers.clearTimeout(deadline);
      writeLog('lifecycle', { event });
      try { disposeRequestAuth(); } catch (error) { logError(error); }
      try { disposeLicense(); } catch (error) { logError(error); }
      try {
        app.releaseSingleInstanceLock();
        if (restart) app.relaunch();
      } catch (error) {
        logError(error);
      } finally {
        disposeDiagnostics();
        app.exit(exitCode);
        resolve();
      }
    }

    void (async () => {
      try {
        await drainBeforeRuntimeStop();
        if (finished) return;
        await stopRuntime();
      } catch (error) {
        if (!finished) logError(error);
      } finally {
        finish('QUIT_DONE');
      }
    })();
    return promise;
  }

  function beforeQuit(event) {
    if (!shutdownPromise && !hasRuntime()) {
      void stopResourceIntegrity();
      return;
    }
    event.preventDefault();
    return requestClose();
  }

  return { requestClose, requestShutdown, beforeQuit, isShuttingDown: () => shutdownPromise !== null };
}

module.exports = { createDesktopLifecycle };
