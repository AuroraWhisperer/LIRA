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
  const dirtyGenerations = { settings: 0, songs: 0, bilibili: 0 };
  let timer = null;
  let disposed = false;
  let active = false;
  let lifecycleGeneration = 0;
  let requestController = null;
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

  function isCurrent(work) {
    return active && isAuthorized() &&
      work.generation === lifecycleGeneration && !work.signal?.aborted;
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
          if (streamAbortController !== controller || controller.signal.aborted) return;
          streamRetryMs = STREAM_RETRY_MIN_MS;
          streamConnections += 1;
          if (streamConnections > 1) {
            syncNow().catch((error) => {
              void error;
            });
          }
        },
        onChange(event) {
          if (streamAbortController !== controller || controller.signal.aborted) return;
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

  async function flushScope(scope, work) {
    if (!dirty.has(scope) || !isCurrent(work)) return false;
    const dirtyGeneration = dirtyGenerations[scope];
    const requestOptions = { signal: work.signal };
    let result;
    if (scope === 'settings') {
      result = await licenseManager.updateCloudSettings(
        runtime.getCloudSettingsSnapshot(),
        requestOptions,
      );
    } else if (scope === 'songs') {
      result = await licenseManager.syncSongs(
        runtime.getCloudSongsSnapshot(),
        requestOptions,
      );
    } else {
      const state = await bilibiliAuth.getAuthState();
      if (!isCurrent(work)) return false;
      if (state?.loggedIn) {
        const cookie = await bilibiliAuth.getCookieHeader();
        if (!isCurrent(work)) return false;
        result = await licenseManager.setBilibiliCredentialsInternal(cookie, requestOptions);
      } else {
        result = await licenseManager.clearBilibiliCredentialsInternal(requestOptions);
      }
    }
    if (!isCurrent(work)) return false;
    if (
      scope === 'settings' &&
      dirtyGenerations.settings === dirtyGeneration &&
      result?.values
    ) {
      await runtime.applyCloudSettingsSnapshot(result.values);
      if (!isCurrent(work)) return false;
      runtime.setBlindBoxMappingState?.(result?.blindBoxMapping || null);
    }
    revisions[scope] = Number(result?.revision) || revisions[scope];
    if (dirtyGenerations[scope] === dirtyGeneration) dirty.delete(scope);
    return true;
  }

  async function flushDirty(work) {
    for (const scope of VALID_SCOPES) {
      if (!isCurrent(work)) return;
      if (!dirty.has(scope)) continue;
      try {
        await flushScope(scope, work);
      } catch (error) {
        // Keep the scope dirty. The next scheduled or explicit sync retries it.
        void error;
      }
    }
  }

  async function seedScope(scope, work) {
    if (!isCurrent(work)) return;
    markScopeDirty(scope);
    try {
      await flushScope(scope, work);
    } catch (error) {
      // The dirty scope remains protected from cloud pulls until retry succeeds.
      void error;
    }
  }

  function shouldApply(scope, cloudRevision, work) {
    if (!isCurrent(work) || dirty.has(scope)) return false;
    const incoming = Number(cloudRevision) || 0;
    const current = revisions[scope];
    return current === null || incoming > current;
  }

  function markScopeDirty(scope) {
    dirtyGenerations[scope] += 1;
    dirty.add(scope);
  }

  async function reconcileSettings(state, work) {
    if (!isCurrent(work)) return;
    if (!state?.initialized) {
      await seedScope('settings', work);
      return;
    }
    if (!shouldApply('settings', state.revision, work)) return;
    const values = state.values || {};
    const isMissingBlindBoxConfig = !Object.prototype.hasOwnProperty.call(
      values,
      'giftBlindBoxConfig',
    );
    await runtime.applyCloudSettingsSnapshot(values);
    if (!isCurrent(work)) return;
    runtime.setBlindBoxMappingState?.(state.blindBoxMapping || null);
    revisions.settings = Number(state.revision) || 0;
    if (isMissingBlindBoxConfig) await seedScope('settings', work);
  }

  async function reconcileSongs(state, work) {
    if (!isCurrent(work)) return;
    if (!state?.initialized) {
      await seedScope('songs', work);
      return;
    }
    if (!shouldApply('songs', state.revision, work)) return;
    const result = await licenseManager.getCloudSongs({ signal: work.signal });
    const cloudRevision = Math.max(
      Number(state.revision) || 0,
      Number(result?.revision) || 0,
    );
    if (!shouldApply('songs', cloudRevision, work)) return;
    await runtime.replaceCloudSongsSnapshot(
      Array.isArray(result?.songs) ? result.songs : [],
    );
    if (!isCurrent(work)) return;
    revisions.songs = cloudRevision;
  }

  async function reconcileBilibili(state, work) {
    if (!isCurrent(work)) return;
    if (!state?.initialized) {
      await seedScope('bilibili', work);
      return;
    }
    if (!shouldApply('bilibili', state.revision, work)) return;
    const result = await licenseManager.getBilibiliCredentialsInternal({ signal: work.signal });
    const cloudRevision = Math.max(
      Number(state.revision) || 0,
      Number(result?.revision) || 0,
    );
    if (!shouldApply('bilibili', cloudRevision, work)) return;
    if (result?.loggedIn && result.cookie) {
      await bilibiliAuth.replaceCookieHeader(result.cookie);
    } else {
      await bilibiliAuth.logout();
    }
    if (isCurrent(work)) revisions.bilibili = cloudRevision;
  }

  async function runSync(work) {
    if (!isCurrent(work)) return false;
    clearTimer();
    try {
      await flushDirty(work);
      if (!isCurrent(work)) return false;
      const state = await licenseManager.getCloudState({ signal: work.signal });
      await reconcileSettings(state?.settings, work);
      await reconcileSongs(state?.songs, work);
      await reconcileBilibili(state?.bilibili, work);
      return isCurrent(work);
    } finally {
      if (isCurrent(work)) schedule();
    }
  }

  function syncNow() {
    const work = { generation: lifecycleGeneration, signal: requestController?.signal };
    return enqueue(() => runSync(work));
  }

  function start() {
    if (disposed) return Promise.resolve(false);
    if (!active) requestController = new AbortController();
    active = true;
    startEventStream();
    return syncNow();
  }

  function stop() {
    active = false;
    lifecycleGeneration += 1;
    requestController?.abort();
    requestController = null;
    clearTimer();
    stopEventStream();
    runtime.setBlindBoxMappingState?.(null);
  }

  function markDirty(scope) {
    if (disposed || !VALID_SCOPES.has(scope)) return;
    markScopeDirty(scope);
    if (isAuthorized()) {
      start().catch((error) => {
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
