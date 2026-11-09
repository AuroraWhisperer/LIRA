'use strict';

const { createCancellableDelay } = require('../shared/cancellable-delay');
const { createCloudSettingsSyncController } = require('./cloud-settings-sync-controller');
const { createCloudSongSyncController } = require('./cloud-song-sync-controller');
const { createCloudBilibiliSyncController } = require('./cloud-bilibili-sync-controller');
const { createGiftInteractionController, assertGiftInteractionResult } = require('./gift-interaction-controller');

const DEFAULT_INTERVAL_MS = 600_000;
const STREAM_RETRY_MIN_MS = 1_000;
const STREAM_RETRY_MAX_MS = 60_000;
const VALID_SCOPES = new Set(['settings', 'songs', 'bilibili']);

function createCloudSyncController(options = {}) {
  const licenseManager = options.licenseManager;
  const runtime = options.runtime;
  const bilibiliAuth = options.bilibiliAuth;
  if (!licenseManager || !runtime || !bilibiliAuth || typeof runtime.prepareCloudRoomAccount !== 'function') {
    throw new Error('Cloud sync controller dependencies are required.');
  }
  const suppliedTimers = options.timers || {};
  const now = options.now || Date.now;
  const timers = {
    setTimeout: suppliedTimers.setTimeout || setTimeout,
    clearTimeout: suppliedTimers.clearTimeout || clearTimeout,
  };
  const intervalMs = Math.max(5_000, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
  const revisions = { settings: null, songs: null, bilibili: null };
  const dirty = new Set();
  const dirtyGenerations = { settings: 0, songs: 0, bilibili: 0 };
  const settingsSync = createCloudSettingsSyncController({
    runtime,
    licenseManager,
    isCurrent,
    shouldApply,
    seedScope,
    getDirtyGeneration: () => dirtyGenerations.settings,
    recordRevision: (revision) => { revisions.settings = revision; },
    confirmState: (values) => giftInteraction.confirmState(values),
  });
  const songSync = createCloudSongSyncController({
    runtime,
    licenseManager,
    isCurrent,
    shouldApply,
    seedScope,
  });
  const bilibiliSync = createCloudBilibiliSyncController({
    licenseManager,
    bilibiliAuth,
    isCurrent,
    shouldApply,
    recordRevision: (revision) => { revisions.bilibili = revision; },
  });
  let timer = null;
  let disposed = false;
  let active = false;
  let lifecycleGeneration = 0;
  let accountKey = null;
  let requestController = null;
  let operation = Promise.resolve();
  let pendingSync = null;
  let streamAbortController = null;
  const streamReconnect = createCancellableDelay(timers);
  let streamRetryMs = STREAM_RETRY_MIN_MS;
  let streamRetryNotBefore = 0;
  let streamConnections = 0;
  let retryNotBefore = 0;
  let retryError = null;
  const giftInteraction = createGiftInteractionController({
    prepareWork() {
      if (!isAuthorized() || !prepareAccount() || !active) return null;
      return { generation: lifecycleGeneration, accountKey, signal: requestController?.signal };
    },
    enqueue,
    write: writeGiftInteraction,
    isCurrent,
    async refresh() {
      if (!isAuthorized()) {
        giftInteraction.fail({ code: 'LICENSE_NOT_AUTHORIZED' });
        return;
      }
      const pending = start();
      const work = { generation: lifecycleGeneration, accountKey, signal: requestController?.signal };
      try {
        await pending;
      } catch (error) {
        if (isCurrent(work)) giftInteraction.fail(error);
      }
    },
  });

  async function writeGiftInteraction(work, intent) {
    try {
      if (!isCurrent(work)) throw Object.assign(new Error(), { code: 'CLOUD_SETTINGS_CHANGED' });
      if (retryNotBefore > now()) throw retryError;
      const dirtyGeneration = dirtyGenerations.settings;
      const pending = settingsSync.getPending(work.accountKey);
      // Omit the untouched flag: the server preserves its current value.
      const result = await settingsSync.upload(
        { ...settingsSync.uploadValues(pending, work.accountKey), [intent.key]: intent.key === 'giftThanksTemplates' ? intent.value : intent.enabled },
        pending, dirtyGeneration, work,
      );
      if (!isCurrent(work)) return null;
      assertGiftInteractionResult(result);
      await settingsSync.acceptUpload(result, pending, dirtyGeneration, work);
      if (!isCurrent(work)) return null;
      if (dirtyGeneration === dirtyGenerations.settings && !settingsSync.getPending(work.accountKey)) {
        dirty.delete('settings');
      }
      revisions.settings = Number(result.revision) || revisions.settings;
      return result.values;
    } catch (error) {
      if (isCurrent(work) && retryNotBefore <= now()) rememberRetry(error);
      throw error;
    }
  }

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
    return !disposed && licenseManager.getState() === licenseManager.LicenseState.AUTHORIZED;
  }

  function isCurrent(work) {
    return (
      active &&
      isAuthorized() &&
      work.accountKey === accountKey &&
      accountKey === getAccountKey() &&
      work.generation === lifecycleGeneration &&
      !work.signal?.aborted
    );
  }

  function getAccountKey() {
    const identity = licenseManager.getCloudSyncIdentity?.();
    const accountName = String(identity?.accountName || '')
      .trim()
      .toLowerCase();
    const streamerId = identity?.streamerId;
    if (!accountName || !Number.isSafeInteger(streamerId) || streamerId <= 0) return null;
    try {
      return JSON.stringify([new URL(licenseManager.getRemoteBaseUrl()).origin, accountName, streamerId]);
    } catch {
      return null;
    }
  }

  function prepareAccount() {
    const nextAccountKey = getAccountKey();
    if (!nextAccountKey) {
      stop();
      return false;
    }
    if (accountKey === nextAccountKey) return true;
    if (accountKey !== null) stop();
    const roomChanged = runtime.prepareCloudRoomAccount(nextAccountKey);
    if (accountKey !== null) {
      dirty.clear();
      for (const scope of VALID_SCOPES) revisions[scope] = null;
    } else if (roomChanged) {
      dirty.delete('settings');
    }
    const pendingSettings = settingsSync.getPending(nextAccountKey);
    if (pendingSettings) {
      runtime.applyCloudSettingsSnapshot(pendingSettings.values, nextAccountKey);
      markScopeDirty('settings');
    }
    if (songSync.restorePending(nextAccountKey)) markScopeDirty('songs');
    accountKey = nextAccountKey;
    retryNotBefore = 0;
    retryError = null;
    streamRetryNotBefore = 0;
    giftInteraction.reset();
    return true;
  }

  function clearTimer() {
    if (!timer) return;
    timers.clearTimeout(timer);
    timer = null;
  }

  function rememberRetry(error) {
    if (!(error?.retryAfterMs > 0)) return;
    retryNotBefore = Math.max(retryNotBefore, now() + error.retryAfterMs);
    retryError = error;
  }

  function clearStreamReconnectTimer() {
    streamReconnect.cancel();
  }

  function schedule() {
    clearTimer();
    if (!active || !isAuthorized()) return;
    timer = timers.setTimeout(
      () => {
        timer = null;
        syncNow().catch((error) => {
          void error;
        });
      },
      Math.min(2 ** 31 - 1, Math.max(intervalMs, retryNotBefore - now())),
    );
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
      return Number.isSafeInteger(incoming) && incoming >= 0 && (current === null || incoming > current);
    });
  }

  function scheduleStreamReconnect(retryAfterMs = 0) {
    clearStreamReconnectTimer();
    if (!active || !isAuthorized()) return;
    const delay = Math.max(streamRetryMs, retryAfterMs);
    streamRetryNotBefore = now() + delay;
    streamRetryMs = Math.min(STREAM_RETRY_MAX_MS, streamRetryMs * 2);
    streamReconnect.schedule(() => {
      streamRetryNotBefore = 0;
      startEventStream();
    }, delay);
  }

  function startEventStream() {
    if (
      streamAbortController ||
      streamReconnect.isPending() ||
      !active ||
      !isAuthorized() ||
      typeof licenseManager.watchCloudStateChangesInternal !== 'function'
    ) {
      return;
    }
    if (streamRetryNotBefore > now()) {
      scheduleStreamReconnect(streamRetryNotBefore - now());
      return;
    }
    const controller = new AbortController();
    streamAbortController = controller;
    let retryAfterMs = 0;
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
          if (pendingSync) {
            mergePendingRevisions(pendingSync, event);
            return;
          }
          syncNow(event).catch((error) => {
            void error;
          });
        },
      })
      .catch((error) => {
        retryAfterMs = error?.retryAfterMs || 0;
      })
      .finally(() => {
        if (streamAbortController !== controller) return;
        streamAbortController = null;
        if (!controller.signal.aborted) scheduleStreamReconnect(retryAfterMs);
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
    let result;
    let pendingSettings;
    if (scope === 'settings') {
      pendingSettings = settingsSync.getPending(work.accountKey);
      result = await settingsSync.upload(settingsSync.uploadValues(pendingSettings, work.accountKey), pendingSettings, dirtyGeneration, work);
    } else if (scope === 'songs') {
      result = await songSync.upload(work);
    } else {
      result = await bilibiliSync.upload(work);
    }
    if (!isCurrent(work)) return false;
    if (scope === 'settings' && result?.values) giftInteraction.confirmState(result.values);
    if (scope === 'settings') {
      const applied = await settingsSync.acceptUpload(result, pendingSettings, dirtyGeneration, work);
      if (!isCurrent(work)) return false;
      if (applied) runtime.setBlindBoxMappingState?.(result?.blindBoxMapping || null);
    }
    revisions[scope] = Number(result?.revision) || revisions[scope];
    if (dirtyGenerations[scope] === dirtyGeneration
      && (scope !== 'settings' || !settingsSync.getPending(work.accountKey))
      && (scope !== 'songs' || !songSync.hasPending(work.accountKey)))
      dirty.delete(scope);
    return result;
  }

  async function flushDirty(work) {
    let conflict = null;
    for (const scope of VALID_SCOPES) {
      if (!isCurrent(work)) return;
      if (!dirty.has(scope)) continue;
      try {
        await flushScope(scope, work);
      } catch (error) {
        // Menu-only notifications cannot protect a previous account's settings from restoration.
        if (scope === 'settings' && error?.code === 'CLOUD_SETTINGS_NOT_READY' && isCurrent(work)) dirty.delete(scope);
        // Other failed uploads remain dirty for the next scheduled or explicit retry.
        if (error?.retryAfterMs > 0) throw error;
        if (error?.code === 'INVALID_GIFT_BLIND_BOX_CONFIG') conflict = error;
        void error;
      }
    }
    if (conflict) throw conflict;
  }

  async function seedScope(scope, work) {
    if (!isCurrent(work)) return;
    markScopeDirty(scope);
    try {
      await flushScope(scope, work);
    } catch (error) {
      // The dirty scope remains protected from cloud pulls until retry succeeds.
      if (error?.retryAfterMs > 0 || error?.code === 'INVALID_GIFT_BLIND_BOX_CONFIG') throw error;
      void error;
    }
  }

  function shouldApply(scope, cloudRevision, work) {
    if (!isCurrent(work) || dirty.has(scope)) return false;
    if (scope === 'settings' && settingsSync.getPending(work.accountKey)) return false;
    if (scope === 'songs' && songSync.hasPending(work.accountKey)) return false;
    const incoming = Number(cloudRevision) || 0;
    const current = revisions[scope];
    return current === null || incoming > current;
  }

  function markScopeDirty(scope) {
    dirtyGenerations[scope] += 1;
    dirty.add(scope);
  }

  async function runSync(work) {
    if (!isCurrent(work)) return false;
    if (retryNotBefore > now()) {
      schedule();
      return false;
    }
    clearTimer();
    try {
      if (settingsSync.getPending(work.accountKey) && !dirty.has('settings')) markScopeDirty('settings');
      if (songSync.hasPending(work.accountKey) && !dirty.has('songs')) markScopeDirty('songs');
      await flushDirty(work);
      if (!isCurrent(work)) return false;
      const state = await licenseManager.getCloudState({ signal: work.signal });
      if (!isCurrent(work)) return false;
      for (const scope of VALID_SCOPES) {
        const snapshot = state?.[scope];
        if (
          !snapshot ||
          Array.isArray(snapshot) ||
          typeof snapshot.initialized !== 'boolean' ||
          !Number.isSafeInteger(snapshot.revision) ||
          snapshot.revision < 0 ||
          (scope === 'settings' &&
            snapshot.initialized &&
            (!snapshot.values || typeof snapshot.values !== 'object' || Array.isArray(snapshot.values)))
        ) {
          throw Object.assign(new Error('Invalid cloud state snapshot.'), { code: 'INVALID_RESPONSE' });
        }
      }
      await settingsSync.reconcile(state?.settings, work);
      const songsRevision = await songSync.reconcile(state?.songs, work);
      if (songsRevision !== null) revisions.songs = songsRevision;
      await bilibiliSync.reconcile(state?.bilibili, work);
      return isCurrent(work);
    } catch (error) {
      if (isCurrent(work)) rememberRetry(error);
      if (isCurrent(work)) giftInteraction.fail(error);
      throw error;
    } finally {
      if (isCurrent(work)) schedule();
    }
  }

  function mergePendingRevisions(pending, event) {
    for (const [scope, revision] of Object.entries(event?.scopes || {})) {
      if (!VALID_SCOPES.has(scope) || !Number.isSafeInteger(Number(revision)) || Number(revision) < 0) continue;
      pending.scopes[scope] = Math.max(pending.scopes[scope] ?? 0, Number(revision));
    }
  }

  function syncNow(event) {
    if (pendingSync) {
      if (!event) pendingSync.force = true;
      else mergePendingRevisions(pendingSync, event);
      return pendingSync.promise;
    }
    const work = {
      generation: lifecycleGeneration,
      accountKey,
      signal: requestController?.signal,
    };
    const pending = { force: !event, scopes: {} };
    mergePendingRevisions(pending, event);
    pendingSync = pending;
    pending.promise = enqueue(() => {
      if (pendingSync === pending) pendingSync = null;
      // An earlier upload/read may already have consumed this SSE revision.
      if (!pending.force && !hasNewCloudRevision(pending)) return false;
      return runSync(work);
    });
    return pending.promise;
  }

  async function start() {
    if (!isAuthorized() || !prepareAccount()) return false;
    if (!active) requestController = new AbortController();
    active = true;
    startEventStream();
    return syncNow();
  }

  function stop() {
    active = false;
    lifecycleGeneration += 1;
    pendingSync = null;
    settingsSync.reset();
    requestController?.abort();
    requestController = null;
    clearTimer();
    stopEventStream();
    runtime.setBlindBoxMappingState?.(null);
    runtime.applyCloudFixedReplySettingsSnapshot?.(null);
    giftInteraction.stop();
  }

  function markDirty(scope) {
    if (disposed || !VALID_SCOPES.has(scope)) return;
    if (scope !== 'songs' && !isAuthorized() && (!accountKey || accountKey !== getAccountKey())) return;
    if (isAuthorized() && !prepareAccount()) return;
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

  function prepareSongWork() {
    if (!isAuthorized()) throw Object.assign(new Error(), { code: 'LICENSE_NOT_AUTHORIZED' });
    if (!prepareAccount()) throw Object.assign(new Error(), { code: 'CLOUD_SONGS_CHANGED' });
    if (!active) requestController = new AbortController();
    active = true;
    startEventStream();
    return { generation: lifecycleGeneration, accountKey, signal: requestController.signal };
  }

  function getLocalSongCount() {
    if (!isAuthorized()) throw Object.assign(new Error(), { code: 'LICENSE_NOT_AUTHORIZED' });
    if (!prepareAccount()) throw Object.assign(new Error(), { code: 'CLOUD_SONGS_CHANGED' });
    return { count: runtime.getCloudSongsSnapshot(accountKey).length, generation: lifecycleGeneration };
  }

  async function syncSongs(songs, expectedGeneration) {
    const work = prepareSongWork();
    if (expectedGeneration !== undefined && expectedGeneration !== work.generation) {
      throw Object.assign(new Error(), { code: 'CLOUD_SONGS_CHANGED' });
    }
    const currentLibrary = songs === undefined;
    // Protect the local library from an already-running cloud pull immediately.
    if (currentLibrary) {
      runtime.getCloudSongsSnapshot(work.accountKey);
      markScopeDirty('songs');
    }
    return enqueue(async () => {
      try {
        if (!isCurrent(work)) throw Object.assign(new Error(), { code: 'CLOUD_SONGS_CHANGED' });
        if (retryNotBefore > now()) throw retryError;
        // Earlier queued work may have flushed this scope. Read a fresh snapshot
        // here, after confirmation and after that work has finished.
        if (currentLibrary) markScopeDirty('songs');
        const result = currentLibrary
          ? await flushScope('songs', work)
          : await licenseManager.syncSongs(songs, { signal: work.signal });
        if (!isCurrent(work)) throw Object.assign(new Error(), { code: 'CLOUD_SONGS_CHANGED' });
        return result;
      } catch (error) {
        if (isCurrent(work)) rememberRetry(error);
        throw error;
      } finally {
        if (isCurrent(work)) schedule();
      }
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    removeLocalListener?.();
    removeLicenseListener?.();
    giftInteraction.dispose();
  }

  return {
    dispose,
    getGiftInteractionState: giftInteraction.getState,
    onGiftInteractionStateChanged: giftInteraction.subscribe,
    refreshGiftInteractionState: giftInteraction.refresh,
    setGiftInteraction: giftInteraction.set,
    setGiftThanksTemplates: giftInteraction.setTemplates,
    markDirty,
    start,
    stop,
    syncNow,
    getLocalSongCount,
    syncCurrentSongs: (generation) => syncSongs(undefined, generation),
    syncSongs,
    whenIdle,
  };
}

module.exports = { createCloudSyncController };
