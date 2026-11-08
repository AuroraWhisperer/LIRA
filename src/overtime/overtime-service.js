'use strict';

const { randomInt: cryptoRandomInt } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const {
  MAX_OVERTIME_SECONDS,
  MAX_EFFECT_FACTOR,
  MAX_RANDOM_WEIGHT,
  MAX_ENABLED_RULES,
  MIN_RANDOM_OUTCOMES,
  MAX_RANDOM_OUTCOMES,
  MAX_RANDOM_APPLICATIONS,
  MAX_DISPLAY_TEXT_LENGTH,
  validateTimeInput,
  validateAction,
  validateBackground,
  validateRules,
} = require('./overtime-contract');
const overtimeEffects = require('./overtime-effects');
const { resolveGiftSettlement } = require('./overtime-settlement');
const {
  clampMs,
  getGiftEventId,
  isLegacyGiftImagePath,
  isRemoteGiftImagePath,
  normalizeState,
  toIso,
} = overtimeEffects;

const MAX_TIMER_CHUNK_MS = 24 * 60 * 60 * 1000;
const OVERTIME_LIMITS = Object.freeze({
  maxSeconds: MAX_OVERTIME_SECONDS,
  maxEffectFactor: MAX_EFFECT_FACTOR,
  maxRandomWeight: MAX_RANDOM_WEIGHT,
  maxEnabledRules: MAX_ENABLED_RULES,
  minRandomOutcomes: MIN_RANDOM_OUTCOMES,
  maxRandomOutcomes: MAX_RANDOM_OUTCOMES,
  maxRandomApplications: MAX_RANDOM_APPLICATIONS,
  maxDisplayTextLength: MAX_DISPLAY_TEXT_LENGTH,
});

function createOvertimeService(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const monotonicNow = typeof options.monotonicNow === 'function' ? options.monotonicNow : () => performance.now();
  const scheduleTimeout = options.setTimeout || setTimeout;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  const randomInt = typeof options.randomInt === 'function' ? options.randomInt : cryptoRandomInt;
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
  const store = options.store;
  let state = normalizeState(store.getState() || store.ensureState(toIso(now())));
  let monotonicAnchorMs = monotonicNow();
  let zeroTimer = null;
  let retryTimer = null;
  let retryAtMs = null;
  let retryWithoutCheckpoint = false;
  let recoveryAfterId = 0;
  let recovering = false;
  let recoveryPaused = false;
  let disposed = false;

  try {
    recoverPersistedClock();
    recoverSettlements();
  } catch (error) {
    dispose();
    throw error;
  }

  function getSnapshot() {
    const serverNowMs = Math.floor(now());
    return {
      enabled: state.enabled,
      enableEpoch: state.enableEpoch,
      status: state.enabled ? state.status : 'disabled',
      initialSeconds: state.initialSeconds,
      effectiveRemainingMs: getEffectiveRemainingMs(),
      serverNowMs,
      revision: state.revision,
      background: { path: state.backgroundPath, fit: state.backgroundFit },
      rules: migrateRuleImages(store.listRules()),
      limits: { ...OVERTIME_LIMITS },
    };
  }

  function getCurrentEpoch() {
    return state.enabled ? state.enableEpoch : 0;
  }

  function getOverview() {
    return {
      ...getSnapshot(),
      pendingCount: store.countPending(),
      quantityLimitedCount: store.countQuantityLimited(),
      settlements: store.listRecent(20),
    };
  }

  function setTime(input) {
    const value = validateTimeInput(input);
    const nextState = materialize();
    if (Object.hasOwn(value, 'initialSeconds')) nextState.initialSeconds = value.initialSeconds;
    if (Object.hasOwn(value, 'remainingSeconds')) {
      nextState.remainingMs = value.remainingSeconds * 1000;
      nextState.status = nextState.enabled && nextState.remainingMs === 0 ? 'finished' : 'paused';
    }
    commit('manual', nextState);
    return getSnapshot();
  }

  function act(input) {
    const action = validateAction(input);
    if (action === 'enable') return enable();
    if (action === 'disable') return disable();
    if (action === 'start') return start();
    if (action === 'pause') return pause();
    return reset();
  }

  function enable() {
    if (state.enabled) return getSnapshot();
    const nextState = materialize();
    nextState.enabled = true;
    nextState.enableEpoch += 1;
    nextState.status = 'paused';
    commit('manual', nextState);
    return getSnapshot();
  }

  function disable() {
    if (!state.enabled) return getSnapshot();
    const nextState = materialize();
    nextState.enabled = false;
    nextState.status = 'paused';
    commit('manual', nextState, { ignorePending: true });
    return getSnapshot();
  }

  function start() {
    if (!state.enabled) throw new Error('overtime must be enabled before start.');
    const nextState = materialize();
    if (nextState.remainingMs <= 0) nextState.status = 'finished';
    else nextState.status = 'running';
    commit('manual', nextState);
    return getSnapshot();
  }

  function pause() {
    if (!state.enabled) return getSnapshot();
    const nextState = materialize();
    nextState.status = nextState.remainingMs <= 0 ? 'finished' : 'paused';
    commit('manual', nextState);
    return getSnapshot();
  }

  function reset() {
    const nextState = materialize();
    nextState.remainingMs = nextState.initialSeconds * 1000;
    nextState.status = nextState.enabled && nextState.remainingMs === 0 ? 'finished' : 'paused';
    commit('manual', nextState);
    return getSnapshot();
  }

  function setBackground(input) {
    const background = validateBackground(input);
    const nextState = materialize();
    nextState.backgroundPath = background.path;
    nextState.backgroundFit = background.fit;
    commit('config', nextState);
    return getSnapshot();
  }

  function replaceRules(input) {
    const rules = validateRules(migrateRuleImages(input), {
      allowedRemoteImageOrigins: options.allowedRemoteImageOrigins,
    });
    commit('rules', materialize(), { rules });
    return getSnapshot();
  }

  function migrateRuleImages(input) {
    if (!Array.isArray(input) || typeof options.resolveGiftImagePath !== 'function') return input;
    return input.map((rule) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return rule;
      const imagePath = String(rule.imagePath ?? rule.image_path ?? '').trim();
      const giftId = String(rule.giftId ?? rule.gift_id ?? '').trim();
      if (!giftId || (!isRemoteGiftImagePath(imagePath) && !isLegacyGiftImagePath(imagePath))) return rule;
      let replacement = '';
      try {
        replacement = String(options.resolveGiftImagePath(giftId, imagePath, rule) || '').trim();
      } catch (_) {
        replacement = '';
      }
      if (!replacement || replacement === imagePath) return rule;
      return { ...rule, imagePath: replacement };
    });
  }

  function observeGift(event) {
    if (recoveryPaused) return false;
    const giftEventId = getGiftEventId(event);
    if (giftEventId === 0) return false;
    try {
      const result = store.observeGift(giftEventId, toIso(now()));
      return result.kind === 'pending';
    } catch (error) {
      scheduleRecovery(Math.floor(now()) + 1000, true);
      throw error;
    }
  }

  function finalizeGift(event) {
    if (recoveryPaused) return false;
    const giftEventId = getGiftEventId(event);
    if (giftEventId === 0) return false;

    try {
      const observed = store.observeGift(giftEventId, toIso(now()));
      if (observed.kind === 'complete' || observed.kind === 'ineligible' || observed.kind === 'missing') {
        scheduleNextRecovery();
        return false;
      }

      const materializedState = materialize();
      const updatedAt = toIso(now());
      const result = store.settleFinal(giftEventId, materializedState, updatedAt, ({ gift, rule }) =>
        resolveGiftSettlement({
          giftEventId,
          gift,
          rule,
          currentState: materializedState,
          updatedAt,
          randomInt,
        }),
      );
      if (result.kind !== 'applied') {
        scheduleNextRecovery();
        return false;
      }

      state = result.state;
      monotonicAnchorMs = monotonicNow();
      scheduleZeroTimer();
      scheduleNextRecovery();
      onUpdate({
        reason: 'gift',
        state: getSnapshot(),
        adjustment: result.adjustment,
      });
      return true;
    } catch (error) {
      const currentMs = Math.floor(now());
      let retry = null;
      try {
        retry = store.recordFailure(giftEventId, error, currentMs, toIso(currentMs));
      } catch (_) {
        retry = null;
      }
      scheduleRecovery(retry?.settleAfterMs || currentMs + 1000, !retry);
      if (error.code === 'OVERTIME_QUANTITY_LIMIT' && retry) {
        onUpdate({
          reason: 'quantity-limit',
          state: {
            ...getSnapshot(),
            pendingCount: store.countPending(),
            quantityLimitedCount: store.countQuantityLimited(),
          },
        });
      }
      throw error;
    }
  }

  function recoverPersistedClock() {
    if (state.status !== 'running') {
      state.anchorAtMs = Math.max(0, state.anchorAtMs);
      monotonicAnchorMs = monotonicNow();
      scheduleZeroTimer();
      return;
    }

    const currentWallMs = Math.floor(now());
    const offlineElapsedMs = Math.max(0, currentWallMs - state.anchorAtMs);
    state.remainingMs = clampMs(state.remainingMs - offlineElapsedMs);
    state.anchorAtMs = currentWallMs;
    monotonicAnchorMs = monotonicNow();
    if (state.remainingMs === 0) {
      state.status = 'finished';
      state.revision += 1;
    }
    state.updatedAt = toIso(currentWallMs);
    store.saveState(state);
    scheduleZeroTimer();
  }

  function reloadState() {
    if (disposed) return;
    state = normalizeState(store.getState() || store.ensureState(toIso(now())));
    clearRetryTimer();
    recoveryAfterId = 0;
    recoverPersistedClock();
    recoverSettlements();
  }

  function getEffectiveRemainingMs() {
    if (state.status !== 'running') return clampMs(state.remainingMs);
    const elapsedMs = Math.max(0, Math.floor(monotonicNow() - monotonicAnchorMs));
    return clampMs(state.remainingMs - elapsedMs);
  }

  function materialize() {
    const currentWallMs = Math.floor(now());
    const nextState = {
      ...state,
      remainingMs: getEffectiveRemainingMs(),
      anchorAtMs: Math.max(0, currentWallMs),
    };
    if (nextState.status === 'running' && nextState.remainingMs === 0) nextState.status = 'finished';
    return nextState;
  }

  function commit(reason, nextState, options = {}) {
    const committedState = {
      ...nextState,
      remainingMs: clampMs(nextState.remainingMs),
      revision: nextState.revision + 1,
      updatedAt: toIso(now()),
    };
    const nextMonotonicAnchorMs = monotonicNow();
    if (options.rules) store.replaceRulesAndState(options.rules, committedState);
    else if (options.ignorePending) store.saveStateAndIgnorePending(committedState);
    else store.saveState(committedState);
    state = committedState;
    monotonicAnchorMs = nextMonotonicAnchorMs;
    scheduleZeroTimer();
    if (!state.enabled) {
      clearRetryTimer();
      recoveryAfterId = 0;
    }
    onUpdate({ reason, state: getSnapshot() });
  }

  function recoverSettlements() {
    if (disposed || recoveryPaused || recovering || !state.enabled) return;
    const epoch = state.enableEpoch;
    const afterId = recoveryAfterId;
    recoveryAfterId = 0;
    recovering = true;
    try {
      const giftEventIds = store.listRecoverableFinal(epoch, Math.floor(now()), afterId);
      let failed = false;
      for (const giftEventId of giftEventIds) {
        try {
          finalizeGift({ giftEventId, phase: 'final' });
        } catch (_) {
          // The retry checkpoint and timer are written by finalizeGift.
          failed = true;
        }
      }
      if (!failed && giftEventIds.length === 100 && !recoveryPaused && state.enabled && state.enableEpoch === epoch) {
        recoveryAfterId = giftEventIds.at(-1);
      }
    } finally {
      recovering = false;
    }
    // A completed sweep reconciles earlier late finals; failures retain their backoff.
    if (recoveryAfterId) scheduleRecovery(Math.floor(now()));
    else scheduleNextRecovery(!retryTimer);
  }

  function scheduleNextRecovery(includeUnobserved = false) {
    if (recovering || disposed || recoveryPaused || !state.enabled) return;
    const nextAt = store.getNextPendingAt(state.enableEpoch, includeUnobserved);
    if (nextAt !== null) scheduleRecovery(nextAt);
  }

  function scheduleRecovery(atMs, restartSweep = false) {
    if (disposed || recoveryPaused || !state.enabled) return;
    if (restartSweep) {
      // Without a retry checkpoint, another immediate batch would bypass backoff.
      recoveryAfterId = 0;
      if (!retryWithoutCheckpoint) clearRetryTimer();
      retryWithoutCheckpoint = true;
    }
    const nextAtMs = Math.floor(atMs);
    if (retryTimer && (retryWithoutCheckpoint || retryAtMs <= nextAtMs)) return;
    if (retryTimer) cancelTimeout(retryTimer);
    retryAtMs = nextAtMs;
    const delay = Math.max(0, nextAtMs - Math.floor(now()));
    retryTimer = scheduleTimeout(() => {
      retryTimer = null;
      retryAtMs = null;
      retryWithoutCheckpoint = false;
      try {
        recoverSettlements();
      } catch (error) {
        console.warn('[Overtime] automatic settlement recovery failed:', error);
        scheduleRecovery(Math.floor(now()) + 1000);
      }
    }, delay);
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
  }

  function clearRetryTimer() {
    if (retryTimer) cancelTimeout(retryTimer);
    retryTimer = null;
    retryAtMs = null;
    retryWithoutCheckpoint = false;
  }

  function scheduleZeroTimer() {
    if (zeroTimer) {
      cancelTimeout(zeroTimer);
      zeroTimer = null;
    }
    if (disposed || recoveryPaused || !state.enabled || state.status !== 'running') return;
    const remainingMs = getEffectiveRemainingMs();
    const delay = Math.min(MAX_TIMER_CHUNK_MS, Math.max(0, remainingMs));
    zeroTimer = scheduleTimeout(handleZeroTimer, delay);
    if (zeroTimer && typeof zeroTimer.unref === 'function') zeroTimer.unref();
  }

  function handleZeroTimer() {
    zeroTimer = null;
    if (disposed || recoveryPaused || !state.enabled || state.status !== 'running') return;
    if (getEffectiveRemainingMs() > 0) {
      scheduleZeroTimer();
      return;
    }
    const nextState = materialize();
    nextState.remainingMs = 0;
    nextState.status = 'finished';
    try {
      commit('finished', nextState);
    } catch (error) {
      console.warn('[Overtime] automatic countdown completion failed:', error);
      if (!disposed && !recoveryPaused && state.enabled && state.status === 'running') {
        zeroTimer = scheduleTimeout(handleZeroTimer, 1000);
        if (zeroTimer && typeof zeroTimer.unref === 'function') zeroTimer.unref();
      }
    }
  }

  function pauseRecovery() {
    if (disposed || recoveryPaused) return false;
    recoveryPaused = true;
    if (zeroTimer) cancelTimeout(zeroTimer);
    zeroTimer = null;
    clearRetryTimer();
    recoveryAfterId = 0;
    return true;
  }

  function resumeRecovery() {
    if (disposed || !recoveryPaused) return;
    recoveryPaused = false;
    try {
      scheduleZeroTimer();
      recoverSettlements();
    } catch (error) {
      pauseRecovery();
      throw error;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (zeroTimer) cancelTimeout(zeroTimer);
    zeroTimer = null;
    clearRetryTimer();
  }

  return {
    getSnapshot,
    getOverview,
    getCurrentEpoch,
    observeGift,
    finalizeGift,
    setTime,
    act,
    setBackground,
    replaceRules,
    reloadState,
    pauseRecovery,
    resumeRecovery,
    dispose,
  };
}

module.exports = { createOvertimeService };
