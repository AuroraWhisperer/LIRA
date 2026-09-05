'use strict';

const {
  normalizeProcessedGiftEvent,
} = require('../shared/processed-gift-contract');
const { createRemoteGiftSourceKey } = require('./remote-gift-cursor-store');

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 60_000;
const REBUILD_ERROR_CODES = new Set([
  'SYNC_EPOCH_MISMATCH',
  'CURSOR_AHEAD',
  'CURSOR_TOO_OLD',
  'INVALID_BOOTSTRAP_TOKEN',
  'REBUILD_REQUIRED',
]);
const BOOTSTRAP_RESTART_CODES = new Set(['BOOTSTRAP_TOKEN_EXPIRED']);
const GiftSyncState = Object.freeze({
  SOURCE_SWITCHING: 'SOURCE_SWITCHING',
  BOOTSTRAPPING: 'BOOTSTRAPPING',
  CATCHING_UP: 'CATCHING_UP',
  LIVE: 'LIVE',
  OFFLINE: 'OFFLINE',
  LEGACY_PARTIAL: 'LEGACY_PARTIAL',
  ERROR: 'ERROR',
});

function createRemoteGiftController(options = {}) {
  const licenseManager = options.licenseManager;
  const runtime = options.runtime;
  if (
    !licenseManager ||
    !runtime?.resolveGiftSource ||
    !runtime?.getGiftSyncState ||
    !runtime?.commitGiftHistoryPage ||
    !runtime?.restartGiftHistoryBootstrap ||
    !runtime?.commitGiftCatchUpPage ||
    !runtime?.commitLegacyGiftPage ||
    !runtime?.resetGiftProjectionForRebuild
  ) {
    throw new Error('Remote gift controller dependencies are required.');
  }
  const suppliedTimers = options.timers || {};
  const timers = {
    setTimeout: suppliedTimers.setTimeout || setTimeout,
    clearTimeout: suppliedTimers.clearTimeout || clearTimeout,
  };
  const now = typeof options.now === 'function' ? options.now : nowIso;

  let active = false;
  let disposed = false;
  let controllerGeneration = 0;
  let authorizationEpoch = 0;
  let currentSource = null;
  let currentState = null;
  let syncState = GiftSyncState.OFFLINE;
  let expectedSyncEpoch = null;
  let latestCursor = null;
  let dirty = false;
  let epochValidated = false;
  let legacyMode = false;
  let initializing = false;
  let streamEpochMismatch = false;
  let operation = Promise.resolve();
  let reconcileTask = null;
  let reconcileGeneration = null;
  let generationController = null;
  let streamController = null;
  let streamTask = null;
  let reconnectTimer = null;
  let reconnectDelayMs = RECONNECT_MIN_MS;

  function isAuthorized() {
    return (
      !disposed &&
      licenseManager.getState() === licenseManager.LicenseState.AUTHORIZED
    );
  }

  function getAuthorizationEpoch() {
    const value = Number(licenseManager.getAuthorizationEpoch?.());
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function enqueue(task) {
    const next = operation.then(task, task);
    operation = next.catch(() => {});
    return next;
  }

  function start() {
    if (disposed) return Promise.resolve(false);
    beginGeneration();
    const generation = controllerGeneration;
    return enqueue(() => initializeGeneration(generation));
  }

  function resume() {
    return start();
  }

  function beginGeneration() {
    active = true;
    controllerGeneration += 1;
    reconcileTask = null;
    reconcileGeneration = null;
    abortRemoteWork();
    generationController = new AbortController();
    authorizationEpoch = getAuthorizationEpoch();
    currentSource = null;
    currentState = null;
    expectedSyncEpoch = null;
    latestCursor = null;
    dirty = true;
    epochValidated = false;
    legacyMode = false;
    streamEpochMismatch = false;
    setSyncState(GiftSyncState.SOURCE_SWITCHING);
  }

  async function initializeGeneration(generation) {
    initializing = true;
    try {
      if (!isGenerationActive(generation) || !isAuthorized()) return false;
      const sourceKey = createRemoteGiftSourceKey(
        licenseManager.getRemoteBaseUrl?.(),
        licenseManager.getSnapshot?.().streamer,
      );
      const sourceFence = captureFence();
      const source = await runtime.resolveGiftSource(sourceKey);
      if (!ensureFenceCurrent(sourceFence)) return false;
      currentSource = normalizeResolvedSource(source, sourceKey);
      currentState = runtime.getGiftSyncState(currentSource.id);
      publishContext();

      const discoveryFence = captureFence();
      const discovery = await licenseManager.getGiftEventsInternal({
        limit: 200,
        signal: generationController.signal,
      });
      if (!ensureFenceCurrent(discoveryFence)) return false;

      if (!hasHistoryCapability(discovery)) {
        legacyMode = true;
        expectedSyncEpoch = null;
        latestCursor = Number(discovery.nextCursor);
        currentState = runtime.commitLegacyGiftPage({
          sourceId: currentSource.id,
          projectionGeneration: currentState.projectionGeneration,
          events: discovery.events,
          nextCursor: discovery.nextCursor,
        });
        if (!ensureFenceCurrent(discoveryFence)) return false;
        dirty = false;
        startEventStream(generation);
        setSyncState(GiftSyncState.LEGACY_PARTIAL);
        return true;
      }

      expectedSyncEpoch = discovery.syncEpoch;
      latestCursor = discovery.latestCursor;
      if (requiresProjectionReplacement(currentState, discovery)) {
        currentState = runtime.resetGiftProjectionForRebuild(currentSource.id);
      }
      if (!currentState.bootstrapComplete) {
        const bootstrapped = await bootstrapHistory(discovery);
        if (!bootstrapped) return false;
      }
      startEventStream(generation);
      if (streamEpochMismatch) return await rebuildAfterStreamMismatch();
      const caughtUp = await catchUpCurrent();
      if (!caughtUp) return false;
      updateLiveState();
      return true;
    } catch (error) {
      return await handleGenerationError(error, generation);
    } finally {
      initializing = false;
    }
  }

  async function rebuildCurrentGeneration(generation) {
    if (!isGenerationActive(generation) || !currentSource) return false;
    if (!ensureFenceCurrent(captureFence())) return false;
    abortEventStream();
    currentState = runtime.resetGiftProjectionForRebuild(currentSource.id);
    dirty = true;
    epochValidated = false;
    streamEpochMismatch = false;
    const fence = captureFence();
    const discovery = await licenseManager.getGiftEventsInternal({
      limit: 200,
      signal: generationController.signal,
    });
    if (!ensureFenceCurrent(fence) || !hasHistoryCapability(discovery)) {
      return false;
    }
    expectedSyncEpoch = discovery.syncEpoch;
    latestCursor = discovery.latestCursor;
    const bootstrapped = await bootstrapHistory(discovery);
    if (!bootstrapped) return false;
    startEventStream(generation);
    if (streamEpochMismatch) {
      setSyncState(GiftSyncState.ERROR);
      return false;
    }
    const caughtUp = await catchUpCurrent();
    if (!caughtUp) return false;
    updateLiveState();
    return true;
  }

  async function handleGenerationError(error, generation) {
    let failure = error;
    if (!isGenerationActive(generation) || isAbortError(error)) return false;
    if (!ensureFenceCurrent(captureFence())) return false;
    if (REBUILD_ERROR_CODES.has(error?.code) && currentSource) {
      try {
        return await rebuildCurrentGeneration(generation);
      } catch (rebuildError) {
        if (
          !isGenerationActive(generation) ||
          isAbortError(rebuildError)
        ) {
          return false;
        }
        failure = rebuildError;
      }
    }
    setSyncState(GiftSyncState.ERROR);
    if (failure?.retryable === true) {
      abortEventStream();
      epochValidated = false;
      dirty = true;
      scheduleReconnect(generation, true);
    }
    return false;
  }

  async function bootstrapHistory(discovery) {
    setSyncState(GiftSyncState.BOOTSTRAPPING);
    let pageToken = currentState.bootstrapPageToken;
    const seenPageTokens = new Set(
      pageToken === null ? [] : [pageToken],
    );
    let restarted = false;
    while (active && isAuthorized()) {
      const fence = captureFence();
      let page;
      try {
        page = await licenseManager.getGiftHistoryInternal({
          pageToken,
          signal: generationController.signal,
        });
      } catch (error) {
        if (
          BOOTSTRAP_RESTART_CODES.has(error?.code) &&
          !restarted &&
          ensureFenceCurrent(fence)
        ) {
          currentState = runtime.restartGiftHistoryBootstrap(
            currentSource.id,
            fence.projectionGeneration,
          );
          if (!ensureFenceCurrent(fence)) return false;
          restarted = true;
          pageToken = null;
          continue;
        }
        throw error;
      }
      if (!ensureFenceCurrent(fence)) return false;
      if (
        page.syncEpoch !== discovery.syncEpoch ||
        (currentState.bootstrapRecoveryCursor !== null &&
          currentState.bootstrapRecoveryCursor !== page.recoveryCursor) ||
        (currentState.bootstrapSyncEpoch !== null &&
          currentState.bootstrapSyncEpoch !== page.syncEpoch)
      ) {
        const mismatch = new Error('GIFT_BOOTSTRAP_SNAPSHOT_MISMATCH');
        mismatch.code = 'REBUILD_REQUIRED';
        throw mismatch;
      }
      if (page.hasMore && seenPageTokens.has(page.nextPageToken)) {
        throw giftSyncStalledError();
      }
      currentState = runtime.commitGiftHistoryPage({
        sourceId: currentSource.id,
        projectionGeneration: fence.projectionGeneration,
        records: page.events,
        nextPageToken: page.nextPageToken,
        hasMore: page.hasMore,
        recoveryCursor: page.recoveryCursor,
        syncEpoch: page.syncEpoch,
      });
      if (!ensureFenceCurrent(fence)) return false;
      pageToken = page.nextPageToken;
      if (pageToken !== null) seenPageTokens.add(pageToken);
      if (!page.hasMore) return true;
    }
    return false;
  }

  async function catchUpCurrent() {
    if (!currentState?.bootstrapComplete) return false;
    setSyncState(GiftSyncState.CATCHING_UP);
    do {
      dirty = false;
      publishContext();
      let hasMore = true;
      while (hasMore && active && isAuthorized()) {
        const fence = captureFence();
        const previousCursor = currentState.finalCursor;
        const page = await licenseManager.getGiftEventsInternal({
          after: previousCursor,
          limit: 200,
          syncEpoch: currentState.syncEpoch,
          signal: generationController.signal,
        });
        if (!ensureFenceCurrent(fence)) return false;
        if (
          page.syncEpoch !== currentState.syncEpoch ||
          page.nextCursor < currentState.finalCursor
        ) {
          const mismatch = new Error('GIFT_SYNC_STATE_MISMATCH');
          mismatch.code = 'SYNC_EPOCH_MISMATCH';
          throw mismatch;
        }
        validateEpochAwareCursorPage(page, previousCursor);
        latestCursor = page.latestCursor;
        hasMore = page.hasMore;
        currentState = runtime.commitGiftCatchUpPage({
          sourceId: currentSource.id,
          projectionGeneration: fence.projectionGeneration,
          events: page.events,
          nextCursor: page.nextCursor,
          syncEpoch: page.syncEpoch,
          validatedAt: hasMore ? null : normalizeNow(now()),
        });
        if (!ensureFenceCurrent(fence)) return false;
      }
    } while (dirty && active && isAuthorized());
    return active && isAuthorized();
  }

  async function catchUpLegacy() {
    if (!legacyMode || currentState?.finalCursor === null) return false;
    do {
      dirty = false;
      let hasMore = true;
      while (hasMore && active && isAuthorized()) {
        const fence = captureFence();
        const previousCursor = currentState.finalCursor;
        const page = await licenseManager.getGiftEventsInternal({
          after: previousCursor,
          limit: 200,
          signal: generationController.signal,
        });
        if (!ensureFenceCurrent(fence)) return false;
        if (page.hasMore && page.nextCursor <= previousCursor) {
          throw giftSyncStalledError();
        }
        hasMore = page.hasMore;
        currentState = runtime.commitLegacyGiftPage({
          sourceId: currentSource.id,
          projectionGeneration: fence.projectionGeneration,
          events: page.events,
          nextCursor: page.nextCursor,
        });
        if (!ensureFenceCurrent(fence)) return false;
      }
    } while (dirty && active && isAuthorized());
    reconnectDelayMs = RECONNECT_MIN_MS;
    setSyncState(GiftSyncState.LEGACY_PARTIAL);
    return true;
  }

  function startEventStream(generation) {
    if (streamController || !isGenerationActive(generation)) return;
    const controller = new AbortController();
    streamController = controller;
    const streamFence = captureFence();
    const generationSignal = generationController.signal;
    const abortFromGeneration = () => controller.abort();
    generationSignal.addEventListener('abort', abortFromGeneration, {
      once: true,
    });
    let task;
    try {
      task = licenseManager.watchGiftEventsInternal({
        signal: controller.signal,
        onOpen(metadata = {}) {
          if (!ensureFenceCurrent(streamFence)) return;
          const streamEpoch = metadata.syncEpoch || null;
          if (
            !legacyMode &&
            expectedSyncEpoch &&
            streamEpoch !== expectedSyncEpoch
          ) {
            epochValidated = false;
            streamEpochMismatch = true;
            dirty = true;
            setSyncState(GiftSyncState.CATCHING_UP);
            if (!initializing) {
              requestReconcile(generation);
            }
            return;
          }
          epochValidated = legacyMode ? false : Boolean(streamEpoch);
          publishContext();
          if (!initializing) requestReconcile(generation);
        },
        onEvent(input) {
          if (!ensureFenceCurrent(streamFence)) return;
          let event;
          try {
            event = normalizeProcessedGiftEvent(input);
          } catch {
            return;
          }
          if (event.phase === 'progress' && syncState === GiftSyncState.LIVE) {
            const fence = captureFence();
            enqueue(async () => {
              if (!ensureFenceCurrent(fence)) return false;
              await runtime.importProcessedGiftEvent?.(
                event,
                currentSource.id,
              );
              return ensureFenceCurrent(fence);
            });
            return;
          }
          dirty = true;
          if (legacyMode) publishContext();
          else setSyncState(GiftSyncState.CATCHING_UP);
          requestReconcile(generation);
        },
      });
    } catch (error) {
      task = Promise.reject(error);
    }
    streamTask = Promise.resolve(task)
      .catch(() => {})
      .finally(() => {
        generationSignal.removeEventListener('abort', abortFromGeneration);
        if (streamController !== controller) return;
        streamController = null;
        streamTask = null;
        if (controller.signal.aborted) return;
        if (!ensureFenceCurrent(streamFence)) return;
        epochValidated = false;
        dirty = true;
        setSyncState(GiftSyncState.OFFLINE);
        scheduleReconnect(generation);
      });
  }

  async function rebuildAfterStreamMismatch() {
    if (!active || legacyMode || !currentSource) return false;
    return rebuildCurrentGeneration(controllerGeneration);
  }

  async function reconcileDirtyState() {
    if (!active || !currentSource) return false;
    if (legacyMode) return catchUpLegacy();
    if (streamEpochMismatch) return rebuildAfterStreamMismatch();
    if (!currentState?.bootstrapComplete) return false;
    const caughtUp = await catchUpCurrent();
    updateLiveState();
    return caughtUp;
  }

  async function reconcileSafely(generation) {
    try {
      return await reconcileDirtyState();
    } catch (error) {
      return handleGenerationError(error, generation);
    }
  }

  function requestReconcile(generation) {
    dirty = true;
    if (reconcileTask && reconcileGeneration === generation) return reconcileTask;
    const task = enqueue(async () => {
      try {
        let result = false;
        do {
          if (!isGenerationActive(generation)) return false;
          result = await reconcileSafely(generation);
        } while (result && dirty && isGenerationActive(generation));
        return result;
      } finally {
        if (reconcileTask === task) {
          reconcileTask = null;
          reconcileGeneration = null;
        }
      }
    });
    reconcileTask = task;
    reconcileGeneration = generation;
    return task;
  }

  function updateLiveState() {
    if (
      active &&
      !legacyMode &&
      currentState?.bootstrapComplete &&
      epochValidated &&
      !dirty &&
      currentState.finalCursor === latestCursor
    ) {
      reconnectDelayMs = RECONNECT_MIN_MS;
      setSyncState(GiftSyncState.LIVE);
    } else if (
      active &&
      !legacyMode &&
      streamController &&
      syncState !== GiftSyncState.OFFLINE
    ) {
      setSyncState(GiftSyncState.CATCHING_UP);
    } else if (active && !legacyMode) {
      setSyncState(GiftSyncState.OFFLINE);
    }
  }

  function scheduleReconnect(generation, initialize = false) {
    clearReconnectTimer();
    if (!isGenerationActive(generation) || !isAuthorized()) return;
    const delay = reconnectDelayMs;
    reconnectDelayMs = Math.min(RECONNECT_MAX_MS, reconnectDelayMs * 2);
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      if (!ensureFenceCurrent(captureFence()) || !isGenerationActive(generation)) return;
      if (initialize) enqueue(() => initializeGeneration(generation));
      else startEventStream(generation);
    }, delay);
    reconnectTimer.unref?.();
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    timers.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function abortRemoteWork() {
    clearReconnectTimer();
    generationController?.abort();
    generationController = null;
    abortEventStream();
    reconnectDelayMs = RECONNECT_MIN_MS;
  }

  function abortEventStream() {
    streamController?.abort();
    streamController = null;
    streamTask = null;
  }

  function stop() {
    if (disposed) return;
    active = false;
    controllerGeneration += 1;
    reconcileTask = null;
    reconcileGeneration = null;
    abortRemoteWork();
    dirty = false;
    epochValidated = false;
    legacyMode = false;
    streamEpochMismatch = false;
    currentSource = null;
    currentState = null;
    expectedSyncEpoch = null;
    latestCursor = null;
    setSyncState(GiftSyncState.OFFLINE);
  }

  function setSyncState(nextState) {
    syncState = nextState;
    publishContext();
  }

  function publishContext() {
    runtime.setActiveGiftSource?.({
      sourceId: currentSource?.id ?? null,
      syncState,
      partial:
        syncState !== GiftSyncState.LIVE || dirty || !epochValidated,
      syncedThroughCursor: currentState?.finalCursor ?? null,
      syncedAt: currentState?.lastValidatedAt ?? null,
      latestCursor,
      dirty,
      epochValidated,
    });
  }

  function captureFence() {
    return Object.freeze({
      sourceId: currentSource?.id ?? null,
      authorizationEpoch,
      controllerGeneration,
      projectionGeneration: currentState?.projectionGeneration ?? null,
    });
  }

  function isFenceCurrent(fence) {
    return (
      active &&
      isAuthorized() &&
      fence.sourceId === (currentSource?.id ?? null) &&
      fence.authorizationEpoch === getAuthorizationEpoch() &&
      fence.controllerGeneration === controllerGeneration &&
      fence.projectionGeneration ===
        (currentState?.projectionGeneration ?? null)
    );
  }

  function ensureFenceCurrent(fence) {
    if (isFenceCurrent(fence)) return true;
    const nextAuthorizationEpoch = getAuthorizationEpoch();
    if (
      active &&
      !disposed &&
      isAuthorized() &&
      fence.controllerGeneration === controllerGeneration &&
      fence.authorizationEpoch !== nextAuthorizationEpoch
    ) {
      beginGeneration();
      const generation = controllerGeneration;
      enqueue(() => initializeGeneration(generation));
    }
    return false;
  }

  function isGenerationActive(generation) {
    return active && !disposed && generation === controllerGeneration;
  }

  function getCursor() {
    return currentState?.finalCursor ?? null;
  }

  function getStatus() {
    return Object.freeze({
      state: syncState,
      sourceId: currentSource?.id ?? null,
      cursor: getCursor(),
      projectionGeneration: currentState?.projectionGeneration ?? null,
      dirty,
      epochValidated,
      latestCursor,
    });
  }

  function whenIdle() {
    return operation;
  }

  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
  }

  return {
    dispose,
    getCursor,
    getStatus,
    resume,
    start,
    stop,
    whenIdle,
  };
}

function normalizeResolvedSource(source, expectedKey) {
  const id = Number(source?.id);
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    source?.sourceKey !== expectedKey
  ) {
    throw new Error('INVALID_GIFT_SOURCE');
  }
  return Object.freeze({ id, sourceKey: expectedKey });
}

function hasHistoryCapability(discovery) {
  return (
    discovery?.historyBootstrapVersion === 1 &&
    typeof discovery.syncEpoch === 'string' &&
    discovery.syncEpoch.length > 0 &&
    discovery.syncEpoch.length <= 128
  );
}

function requiresProjectionReplacement(state, discovery) {
  if (state.bootstrapComplete) {
    return (
      state.syncEpoch !== discovery.syncEpoch ||
      !Number.isSafeInteger(state.finalCursor) ||
      state.finalCursor > discovery.latestCursor ||
      state.finalCursor < discovery.earliestCursor - 1
    );
  }
  const hasPageToken = state.bootstrapPageToken !== null;
  const hasRecoveryCursor = state.bootstrapRecoveryCursor !== null;
  const hasBootstrapEpoch = state.bootstrapSyncEpoch !== null;
  return (
    (hasPageToken && (!hasRecoveryCursor || !hasBootstrapEpoch)) ||
    (!hasPageToken && (hasRecoveryCursor || hasBootstrapEpoch)) ||
    (state.bootstrapSyncEpoch !== null &&
      state.bootstrapSyncEpoch !== discovery.syncEpoch) ||
    (state.finalCursor !== null && !Number.isSafeInteger(state.finalCursor))
  );
}

function validateEpochAwareCursorPage(page, currentCursor) {
  let previous = currentCursor;
  for (const event of page.events) {
    if (event.cursor !== previous + 1) throw cursorGapError();
    previous = event.cursor;
  }
  if (
    currentCursor < page.earliestCursor - 1 ||
    currentCursor > page.latestCursor ||
    previous !== page.nextCursor ||
    page.nextCursor > page.latestCursor ||
    (page.hasMore && page.nextCursor <= currentCursor) ||
    (page.hasMore && page.nextCursor >= page.latestCursor) ||
    (!page.hasMore && page.nextCursor !== page.latestCursor)
  ) {
    throw cursorGapError();
  }
}

function giftSyncStalledError() {
  const error = new Error('GIFT_SYNC_STALLED');
  error.code = 'GIFT_SYNC_STALLED';
  return error;
}

function cursorGapError() {
  const error = new Error('GIFT_CURSOR_GAP');
  error.code = 'REBUILD_REQUIRED';
  return error;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function normalizeNow(value) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds)) throw new Error('INVALID_GIFT_TIMESTAMP');
  return new Date(milliseconds).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  GiftSyncState,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  createRemoteGiftController,
};
