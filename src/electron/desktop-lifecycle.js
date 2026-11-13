'use strict';

function createDesktopLifecycle({
  app, hasRuntime, restartApp,
  stopResourceIntegrity, drainBeforeRuntimeStop, stopRuntime,
  disposeRequestAuth, disposeLicense, disposeDiagnostics, writeLog,
  timers = { setTimeout, clearTimeout },
}) {
  let shutdownPromise = null;

  function requestClose() {
    return requestShutdown();
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
      let updateStarted = false;
      try {
        if (restart) updateStarted = restartApp() === 'update';
        else app.releaseSingleInstanceLock();
      } catch (error) {
        logError(error);
      } finally {
        const exit = () => {
          disposeDiagnostics();
          app.exit(exitCode);
          resolve();
        };
        // NSIS spawn fallbacks and before-quit-for-update run asynchronously.
        if (updateStarted) setImmediate(exit);
        else exit();
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
