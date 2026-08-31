'use strict';

const DEFAULT_INTERVAL_MS = 600_000;
const STREAM_RETRY_MIN_MS = 1_000;
const STREAM_RETRY_MAX_MS = 60_000;
const VALID_SCOPES = new Set(['settings', 'songs', 'bilibili']);

function createCloudSyncController(options = {}) {
  const licenseManager = options.licenseManager;
  const runtime = options.runtime;
  const bilibiliAuth = options.bilibiliAuth;
  if (!licenseManager || !runtime || !bilibiliAuth) {
    throw new Error('Cloud sync controller dependencies are required.');
  }
  const suppliedTimers = options.timers || {};
  const timers = {
    setTimeout: suppliedTimers.setTimeout || setTimeout,
    clearTimeout: suppliedTimers.clearTimeout || clearTimeout,
  };
  const intervalMs = Math.max(
    5_000,
    Number(options.intervalMs) || DEFAULT_INTERVAL_MS,
  );
  const revisions = { settings: null, songs: null, bilibili: null };
  const dirty = new Set();
  let timer = null;
  let disposed = false;
  let active = false;
  let operation = Promise.resolve();
  let streamAbortController = null;
  let streamReconnectTimer = null;
  let streamRetryMs = STREAM_RETRY_MIN_MS;
  let streamConnections = 0;

  const removeLocalListener = runtime.onCloudSyncRequested?.((scope) => {
    markDirty(scope);
  });
  const removeLicenseListener = licenseManager.onStateChanged?.((snapshot) => {
    if (snapshot?.state === licenseManager.LicenseState.AUTHORIZED) {
      start().catch((error) => {
        void error;
      });
    } else {
      stop();
    }
  });

  function isAuthorized() {
    return (
      !disposed &&
      licenseManager.getState() === licenseManager.LicenseState.AUTHORIZED
    );
  }

  function clearTimer() {
    if (!timer) return;
    timers.clearTimeout(timer);
    timer = null;
  }

  function clearStreamReconnectTimer() {
    if (!streamReconnectTimer) return;
    timers.clearTimeout(streamReconnectTimer);
    streamReconnectTimer = null;
  }

  function schedule() {
    clearTimer();
    if (!active || !isAuthorized()) return;
    timer = timers.setTimeout(() => {
      timer = null;
      syncNow().catch((error) => {
        void error;
      });
    }, intervalMs);
    timer.unref?.();
  }

  function enqueue(task) {
    const next = operation.then(task, task);
    operation = next.catch((error) => {
      void error;
    });
    return next;
  }

  function hasNewCloudRevision(event) {
    return Object.entries(event?.scopes || {}).some(([scope, revision]) => {
      if (!VALID_SCOPES.has(scope)) return false;
      const incoming = Number(revision);
      const current = revisions[scope];
      return (
        Number.isSafeInteger(incoming) &&
        incoming >= 0 &&
        (current === null || incoming > current)
      );
    });
  }

  function scheduleStreamReconnect() {
    clearStreamReconnectTimer();
    if (!active || !isAuthorized()) return;
    const delay = streamRetryMs;
    streamRetryMs = Math.min(STREAM_RETRY_MAX_MS, streamRetryMs * 2);
    streamReconnectTimer = timers.setTimeout(() => {
      streamReconnectTimer = null;
      startEventStream();
    }, delay);
    streamReconnectTimer.unref?.();
  }

  function startEventStream() {
    if (
      streamAbortController ||
      !active ||
      !isAuthorized() ||
      typeof licenseManager.watchCloudStateChangesInternal !== 'function'
    ) {
      return;
    }
    const controller = new AbortController();
    streamAbortController = controller;
    licenseManager
      .watchCloudStateChangesInternal({
        signal: controller.signal,
        onOpen() {
          streamRetryMs = STREAM_RETRY_MIN_MS;
          streamConnections += 1;
          if (streamConnections > 1) {
            syncNow().catch((error) => {
              void error;
            });
          }
        },
        onChange(event) {
          if (!hasNewCloudRevision(event)) return;
          syncNow().catch((error) => {
            void error;
          });
        },
      })
      .catch((error) => {
        void error;
      })
      .finally(() => {
        if (streamAbortController !== controller) return;
        streamAbortController = null;
        if (!controller.signal.aborted) scheduleStreamReconnect();
      });
  }

  function stopEventStream() {
    clearStreamReconnectTimer();
    streamAbortController?.abort();
    streamAbortController = null;
    streamRetryMs = STREAM_RETRY_MIN_MS;
    streamConnections = 0;
  }

  async function flushScope(scope) {
    if (!dirty.has(scope) || !isAuthorized()) return false;
    if (scope === 'settings') {
      const result = await licenseManager.updateCloudSettings(
        runtime.getCloudSettingsSnapshot(),
      );
      revisions.settings = Number(result?.revision) || revisions.settings;
    } else if (scope === 'songs') {
      const result = await licenseManager.syncSongs(
        runtime.getCloudSongsSnapshot(),
      );
      revisions.songs = Number(result?.revision) || revisions.songs;
    } else {
      const state = await bilibiliAuth.getAuthState();
      let result;
      if (state?.loggedIn) {
        const cookie = await bilibiliAuth.getCookieHeader();
        result = await licenseManager.setBilibiliCredentialsInternal(cookie);
      } else {
        result = await licenseManager.clearBilibiliCredentialsInternal();
      }
      revisions.bilibili = Number(result?.revision) || revisions.bilibili;
    }
    dirty.delete(scope);
    return true;
  }

  async function flushDirty() {
    for (const scope of VALID_SCOPES) {
      if (!dirty.has(scope)) continue;
      try {
        await flushScope(scope);
      } catch (error) {
        // Keep the scope dirty. The next scheduled or explicit sync retries it.
        void error;
      }
    }
  }

  async function seedScope(scope) {
    dirty.add(scope);
    try {
      await flushScope(scope);
    } catch (error) {
      // The dirty scope remains protected from cloud pulls until retry succeeds.
      void error;
    }
  }

  function shouldApply(scope, cloudRevision) {
    if (dirty.has(scope)) return false;
    const incoming = Number(cloudRevision) || 0;
    const current = revisions[scope];
    return current === null || incoming > current;
  }

  async function reconcileSettings(state) {
    if (!state?.initialized) {
      await seedScope('settings');
      return;
    }
    if (!shouldApply('settings', state.revision)) return;
    const values = state.values || {};
    const isMissingBlindBoxConfig = !Object.prototype.hasOwnProperty.call(
      values,
      'giftBlindBoxConfig',
    );
    await runtime.applyCloudSettingsSnapshot(values);
    revisions.settings = Number(state.revision) || 0;
    if (isMissingBlindBoxConfig) await seedScope('settings');
  }

  async function reconcileSongs(state) {
    if (!state?.initialized) {
      await seedScope('songs');
      return;
    }
    if (!shouldApply('songs', state.revision)) return;
    const result = await licenseManager.getCloudSongs();
    await runtime.replaceCloudSongsSnapshot(
      Array.isArray(result?.songs) ? result.songs : [],
    );
    revisions.songs = Math.max(
      Number(state.revision) || 0,
      Number(result?.revision) || 0,
    );
  }

  async function reconcileBilibili(state) {
    if (!state?.initialized) {
      await seedScope('bilibili');
      return;
    }
    if (!shouldApply('bilibili', state.revision)) return;
    const result = await licenseManager.getBilibiliCredentialsInternal();
    if (result?.loggedIn && result.cookie) {
      await bilibiliAuth.replaceCookieHeader(result.cookie);
    } else {
      await bilibiliAuth.logout();
    }
    revisions.bilibili = Math.max(
      Number(state.revision) || 0,
      Number(result?.revision) || 0,
    );
  }

  async function runSync() {
    if (!active || !isAuthorized()) return false;
    clearTimer();
    try {
      await flushDirty();
      if (!isAuthorized()) return false;
      const state = await licenseManager.getCloudState();
      await reconcileSettings(state?.settings);
      await reconcileSongs(state?.songs);
      await reconcileBilibili(state?.bilibili);
      return true;
    } finally {
      schedule();
    }
  }

  function syncNow() {
    return enqueue(runSync);
  }

  function start() {
    if (disposed) return Promise.resolve(false);
    active = true;
    startEventStream();
    return syncNow();
  }

  function stop() {
    active = false;
    clearTimer();
    stopEventStream();
  }

  function markDirty(scope) {
    if (disposed || !VALID_SCOPES.has(scope)) return;
    dirty.add(scope);
    if (isAuthorized()) {
      active = true;
      syncNow().catch((error) => {
        void error;
      });
    }
  }

  function whenIdle() {
    return operation;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    removeLocalListener?.();
    removeLicenseListener?.();
  }

  return {
    dispose,
    markDirty,
    start,
    stop,
    syncNow,
    whenIdle,
  };
}

module.exports = { createCloudSyncController };
