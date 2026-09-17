'use strict';

const DEFAULT_INTERVAL_MS = 600_000;
const STREAM_RETRY_MIN_MS = 1_000;
const STREAM_RETRY_MAX_MS = 60_000;
const VALID_SCOPES = new Set(['settings', 'songs', 'bilibili']);
const GIFT_INTERACTION_KEYS = ['giftAutoThanksEnabled', 'giftStatsQueryEnabled'];

function createCloudSyncController(options = {}) {
  const licenseManager = options.licenseManager;
  const runtime = options.runtime;
  const bilibiliAuth = options.bilibiliAuth;
  if (
    !licenseManager ||
    !runtime ||
    !bilibiliAuth ||
    typeof runtime.prepareCloudRoomAccount !== 'function'
  ) {
    throw new Error('Cloud sync controller dependencies are required.');
  }
  const suppliedTimers = options.timers || {};
  const now = options.now || Date.now;
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
  let accountKey = null;
  let requestController = null;
  let operation = Promise.resolve();
  let streamAbortController = null;
  let streamReconnectTimer = null;
  let streamRetryMs = STREAM_RETRY_MIN_MS;
  let streamRetryNotBefore = 0;
  let streamConnections = 0;
  let retryNotBefore = 0;
  let retryError = null;
  let interactionState = emptyInteractionState();
  let interactionSaving = false;
  const interactionListeners = new Set();

  function emptyInteractionState() {
    return {
      values: { giftAutoThanksEnabled: false, giftStatsQueryEnabled: false },
      status: 'unconfirmed',
      error: null,
    };
  }

  function getGiftInteractionState() {
    return { ...interactionState, values: { ...interactionState.values } };
  }

  function publishInteractionState(patch) {
    interactionState = { ...interactionState, ...patch };
    for (const listener of interactionListeners) {
      listener(getGiftInteractionState());
    }
  }

  function confirmInteractionState(values) {
    publishInteractionState({
      values: Object.fromEntries(
        GIFT_INTERACTION_KEYS.map((key) => [key, values?.[key] === true]),
      ),
      status: interactionSaving ? 'pending' : 'confirmed',
      error: null,
    });
  }

  function onGiftInteractionStateChanged(listener) {
    interactionListeners.add(listener);
    return () => interactionListeners.delete(listener);
  }

  async function refreshGiftInteractionState() {
    try {
      if (!isAuthorized()) throw Object.assign(new Error(), { code: 'LICENSE_NOT_AUTHORIZED' });
      await start();
    } catch (error) {
      publishInteractionState({ status: 'unconfirmed', error: interactionError(error) });
    }
    return getGiftInteractionState();
  }

  function interactionError(error) {
    const code = String(error?.code || 'CLOUD_SYNC_FAILED');
    return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'CLOUD_SYNC_FAILED';
  }

  async function setGiftInteraction(intent) {
    if (
      !intent || typeof intent !== 'object' || Array.isArray(intent) ||
      Object.keys(intent).length !== 2 ||
      !GIFT_INTERACTION_KEYS.includes(intent.key) ||
      typeof intent.enabled !== 'boolean'
    ) {
      throw Object.assign(new Error(), { code: 'INVALID_GIFT_INTERACTION' });
    }
    if (interactionSaving) {
      throw Object.assign(new Error(), { code: 'GIFT_INTERACTION_PENDING' });
    }
    if (!isAuthorized() || !prepareAccount() || !active) {
      publishInteractionState({ status: 'unconfirmed', error: 'LICENSE_NOT_AUTHORIZED' });
      return { ok: false, ...getGiftInteractionState() };
    }
    const work = {
      generation: lifecycleGeneration,
      accountKey,
      signal: requestController?.signal,
    };
    interactionSaving = true;
    publishInteractionState({ status: 'pending', error: null });
    return enqueue(async () => {
      try {
        if (!isCurrent(work)) throw Object.assign(new Error(), { code: 'CLOUD_SETTINGS_CHANGED' });
        if (retryNotBefore > now()) throw retryError;
        const dirtyGeneration = dirtyGenerations.settings;
        // Omit the untouched flag: the server preserves its current value.
        const result = await licenseManager.updateCloudSettings(
          { ...runtime.getCloudSettingsSnapshot(), [intent.key]: intent.enabled },
          { signal: work.signal },
        );
        if (!isCurrent(work)) return { ok: false, ...getGiftInteractionState() };
        if (result?.ok === false || !GIFT_INTERACTION_KEYS.every(
          (key) => typeof result?.values?.[key] === 'boolean',
        )) {
          throw Object.assign(new Error(), { code: 'INVALID_RESPONSE' });
        }
        if (dirtyGeneration === dirtyGenerations.settings) {
          await runtime.applyCloudSettingsSnapshot(result.values);
          if (!isCurrent(work)) return { ok: false, ...getGiftInteractionState() };
          dirty.delete('settings');
        }
        revisions.settings = Number(result.revision) || revisions.settings;
        interactionSaving = false;
        confirmInteractionState(result.values);
        const matched = result.values[intent.key] === intent.enabled;
        return {
          ...getGiftInteractionState(),
          ok: matched,
          error: matched ? null : 'CLOUD_SETTINGS_CHANGED',
        };
      } catch (error) {
        interactionSaving = false;
        if (isCurrent(work) && retryNotBefore <= now()) rememberRetry(error);
        if (isCurrent(work)) publishInteractionState({ status: 'unconfirmed', error: interactionError(error) });
        return { ok: false, ...getGiftInteractionState() };
      } finally {
        interactionSaving = false;
      }
    });
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
    return (
      !disposed &&
      licenseManager.getState() === licenseManager.LicenseState.AUTHORIZED
    );
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
    if (!accountName || !Number.isSafeInteger(streamerId) || streamerId <= 0)
      return null;
    try {
      return JSON.stringify([
        new URL(licenseManager.getRemoteBaseUrl()).origin,
        accountName,
        streamerId,
      ]);
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
    accountKey = nextAccountKey;
    retryNotBefore = 0;
    retryError = null;
    streamRetryNotBefore = 0;
    publishInteractionState(emptyInteractionState());
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
    }, Math.min(2 ** 31 - 1, Math.max(intervalMs, retryNotBefore - now())));
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

  function scheduleStreamReconnect(retryAfterMs = 0) {
    clearStreamReconnectTimer();
    if (!active || !isAuthorized()) return;
    const delay = Math.max(streamRetryMs, retryAfterMs);
    streamRetryNotBefore = now() + delay;
    streamRetryMs = Math.min(STREAM_RETRY_MAX_MS, streamRetryMs * 2);
    const timer = timers.setTimeout(() => {
      if (streamReconnectTimer !== timer) return;
      streamReconnectTimer = null;
      if (delay > 2 ** 31 - 1) {
        scheduleStreamReconnect(delay - (2 ** 31 - 1));
        return;
      }
      streamRetryNotBefore = 0;
      startEventStream();
    }, Math.min(delay, 2 ** 31 - 1));
    streamReconnectTimer = timer;
    streamReconnectTimer.unref?.();
  }

  function startEventStream() {
    if (
      streamAbortController ||
      streamReconnectTimer ||
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
          if (streamAbortController !== controller || controller.signal.aborted)
            return;
          streamRetryMs = STREAM_RETRY_MIN_MS;
          streamConnections += 1;
          if (streamConnections > 1) {
            syncNow().catch((error) => {
              void error;
            });
          }
        },
        onChange(event) {
          if (streamAbortController !== controller || controller.signal.aborted)
            return;
          if (!hasNewCloudRevision(event)) return;
          syncNow().catch((error) => {
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
        result = await licenseManager.setBilibiliCredentialsInternal(
          cookie,
          requestOptions,
        );
      } else {
        result =
          await licenseManager.clearBilibiliCredentialsInternal(requestOptions);
      }
    }
    if (!isCurrent(work)) return false;
    if (scope === 'settings' && result?.values) confirmInteractionState(result.values);
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
        if (error?.retryAfterMs > 0) throw error;
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
      if (error?.retryAfterMs > 0) throw error;
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
    if (state?.initialized) confirmInteractionState(state.values);
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
    if (!Array.isArray(result?.songs)) {
      throw Object.assign(new Error('Invalid cloud song snapshot.'), {
        code: 'INVALID_RESPONSE',
      });
    }
    await runtime.replaceCloudSongsSnapshot(result.songs);
    if (!isCurrent(work)) return;
    revisions.songs = cloudRevision;
  }

  async function reconcileBilibili(state, work) {
    if (!isCurrent(work)) return;
    if (!state?.initialized) {
      if (!shouldApply('bilibili', 0, work)) return;
      // An unowned local Cookie must never seed a newly authorized account.
      await bilibiliAuth.logout();
      if (isCurrent(work)) revisions.bilibili = 0;
      return;
    }
    if (!shouldApply('bilibili', state.revision, work)) return;
    const result = await licenseManager.getBilibiliCredentialsInternal({
      signal: work.signal,
    });
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
    if (retryNotBefore > now()) {
      schedule();
      return false;
    }
    clearTimer();
    try {
      await flushDirty(work);
      if (!isCurrent(work)) return false;
      const state = await licenseManager.getCloudState({ signal: work.signal });
      await reconcileSettings(state?.settings, work);
      await reconcileSongs(state?.songs, work);
      await reconcileBilibili(state?.bilibili, work);
      return isCurrent(work);
    } catch (error) {
      if (isCurrent(work)) rememberRetry(error);
      if (isCurrent(work)) publishInteractionState({ status: 'unconfirmed', error: interactionError(error) });
      throw error;
    } finally {
      if (isCurrent(work)) schedule();
    }
  }

  function syncNow() {
    const work = {
      generation: lifecycleGeneration,
      accountKey,
      signal: requestController?.signal,
    };
    return enqueue(() => runSync(work));
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
    requestController?.abort();
    requestController = null;
    clearTimer();
    stopEventStream();
    runtime.setBlindBoxMappingState?.(null);
    publishInteractionState({ status: 'unconfirmed' });
  }

  function markDirty(scope) {
    if (disposed || !VALID_SCOPES.has(scope)) return;
    if (
      scope !== 'songs' &&
      !isAuthorized() &&
      (!accountKey || accountKey !== getAccountKey())
    )
      return;
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

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    removeLocalListener?.();
    removeLicenseListener?.();
    interactionListeners.clear();
  }

  return {
    dispose,
    getGiftInteractionState,
    onGiftInteractionStateChanged,
    refreshGiftInteractionState,
    setGiftInteraction,
    markDirty,
    start,
    stop,
    syncNow,
    whenIdle,
  };
}

module.exports = { createCloudSyncController };
