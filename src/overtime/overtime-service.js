'use strict';

const { randomInt: cryptoRandomInt } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createOvertimeStore } = require('./overtime-store');
const {
  MAX_OVERTIME_SECONDS,
  validateTimeInput,
  validateAction,
  validateBackground,
  validateRules
} = require('./overtime-contract');

const MAX_OVERTIME_MS = MAX_OVERTIME_SECONDS * 1000;
const MAX_TIMER_CHUNK_MS = 24 * 60 * 60 * 1000;

function createOvertimeService(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const monotonicNow = typeof options.monotonicNow === 'function'
    ? options.monotonicNow
    : () => performance.now();
  const scheduleTimeout = options.setTimeout || setTimeout;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  const randomInt = typeof options.randomInt === 'function' ? options.randomInt : cryptoRandomInt;
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
  const store = options.store || createOvertimeStore(options.giftDb);
  let state = normalizeState(store.getState() || store.ensureState(toIso(now())));
  let monotonicAnchorMs = monotonicNow();
  let zeroTimer = null;
  let retryTimer = null;
  let recovering = false;
  let disposed = false;

  recoverPersistedClock();
  recoverSettlements();

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
      rules: store.listRules()
    };
  }

  function getCurrentEpoch() {
    return state.enabled ? state.enableEpoch : 0;
  }

  function getOverview() {
    return {
      ...getSnapshot(),
      pendingCount: store.countPending(),
      settlements: store.listRecent(20)
    };
  }

  function setTime(input) {
    const value = validateTimeInput(input);
    materialize();
    if (Object.hasOwn(value, 'initialSeconds')) state.initialSeconds = value.initialSeconds;
    if (Object.hasOwn(value, 'remainingSeconds')) {
      state.remainingMs = value.remainingSeconds * 1000;
      state.status = state.enabled && state.remainingMs === 0 ? 'finished' : 'paused';
    }
    commit('manual');
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
    materialize();
    state.enabled = true;
    state.enableEpoch += 1;
    state.status = 'paused';
    commit('manual');
    return getSnapshot();
  }

  function disable() {
    if (!state.enabled) return getSnapshot();
    materialize();
    state.enabled = false;
    state.status = 'paused';
    commit('manual', { ignorePending: true });
    return getSnapshot();
  }

  function start() {
    if (!state.enabled) throw new Error('overtime must be enabled before start.');
    materialize();
    if (state.remainingMs <= 0) state.status = 'finished';
    else state.status = 'running';
    commit('manual');
    return getSnapshot();
  }

  function pause() {
    if (!state.enabled) return getSnapshot();
    materialize();
    state.status = state.remainingMs <= 0 ? 'finished' : 'paused';
    commit('manual');
    return getSnapshot();
  }

  function reset() {
    materialize();
    state.remainingMs = state.initialSeconds * 1000;
    state.status = state.enabled && state.remainingMs === 0 ? 'finished' : 'paused';
    commit('manual');
    return getSnapshot();
  }

  function setBackground(input) {
    const background = validateBackground(input);
    materialize();
    state.backgroundPath = background.path;
    state.backgroundFit = background.fit;
    commit('config');
    return getSnapshot();
  }

  function replaceRules(input) {
    const rules = validateRules(input);
    store.replaceRules(rules, toIso(now()));
    materialize();
    commit('rules');
    return getSnapshot();
  }

  function observeGift(event) {
    const giftEventId = getGiftEventId(event);
    if (giftEventId === 0) return false;
    try {
      const result = store.observeGift(giftEventId, toIso(now()));
      return result.kind === 'pending';
    } catch (error) {
      scheduleRecovery(Math.floor(now()) + 1000);
      throw error;
    }
  }

  function finalizeGift(event) {
    const giftEventId = getGiftEventId(event);
    if (giftEventId === 0) return false;

    try {
      const observed = store.observeGift(giftEventId, toIso(now()));
      if (observed.kind === 'complete' || observed.kind === 'ineligible' || observed.kind === 'missing') {
        scheduleNextRecovery();
        return false;
      }

      materialize();
      const materializedState = { ...state };
      const updatedAt = toIso(now());
      const result = store.settleFinal(
        giftEventId,
        materializedState,
        updatedAt,
        ({ gift, rule }) => resolveGiftSettlement(giftEventId, gift, rule, materializedState, updatedAt)
      );
      if (result.kind !== 'applied') {
        scheduleNextRecovery();
        return false;
      }

      state = result.state;
      monotonicAnchorMs = monotonicNow();
      scheduleZeroTimer();
      scheduleNextRecovery();
      onUpdate({ reason: 'gift', state: getSnapshot(), adjustment: result.adjustment });
      return true;
    } catch (error) {
      const currentMs = Math.floor(now());
      let retry = null;
      try {
        retry = store.recordFailure(giftEventId, error, currentMs, toIso(currentMs));
      } catch (_) {
        retry = null;
      }
      scheduleRecovery(retry?.settleAfterMs || currentMs + 1000);
      throw error;
    }
  }

  function resolveGiftSettlement(giftEventId, gift, rule, currentState, updatedAt) {
    const selection = selectRuleResult(rule);
    const requestedDeltaSeconds = selection.seconds;
    const beforeMs = clampMs(currentState.remainingMs);
    const afterMs = clampMs(beforeMs + requestedDeltaSeconds * 1000);
    const appliedDeltaSeconds = Math.trunc((afterMs - beforeMs) / 1000);
    const nextState = { ...currentState, remainingMs: afterMs };

    if (afterMs === 0) nextState.status = 'finished';
    else if (requestedDeltaSeconds > 0 && currentState.status === 'finished') nextState.status = 'running';
    nextState.revision += 1;
    nextState.updatedAt = updatedAt;

    const ruleSnapshot = {
      version: 1,
      mode: rule.mode,
      fixedSeconds: rule.mode === 'fixed' ? rule.fixedSeconds : null,
      outcomes: rule.mode === 'random' ? rule.outcomes : [],
      ruleUpdatedAt: rule.updatedAt
    };
    const adjustment = {
      giftEventId,
      giftId: String(gift.gift_id || ''),
      giftName: String(gift.gift_name || ''),
      quantity: Math.max(1, Math.floor(Number(gift.num) || 1)),
      totalPrice: Number(gift.total_price) || 0,
      imagePath: rule.imagePath,
      mode: rule.mode,
      requestedDeltaSeconds,
      appliedDeltaSeconds,
      resultSeconds: requestedDeltaSeconds,
      result: selection.outcome
    };

    return {
      state: nextState,
      ruleMode: rule.mode,
      ruleSnapshotJson: JSON.stringify(ruleSnapshot),
      requestedDeltaSeconds,
      appliedDeltaSeconds,
      outcomesJson: selection.outcome ? JSON.stringify(selection.outcome) : '',
      adjustment
    };
  }

  function selectRuleResult(rule) {
    if (rule.mode === 'fixed') return { seconds: Number(rule.fixedSeconds) || 0, outcome: null };
    const totalWeight = rule.outcomes.reduce((sum, outcome) => sum + Number(outcome.weight), 0);
    const draw = randomInt(totalWeight);
    let cumulative = 0;
    for (let index = 0; index < rule.outcomes.length; index += 1) {
      const outcome = rule.outcomes[index];
      cumulative += Number(outcome.weight);
      if (draw < cumulative) {
        const result = {
          version: 1,
          selectedIndex: index,
          selectedSeconds: Number(outcome.seconds),
          totalWeight
        };
        return { seconds: result.selectedSeconds, outcome: result };
      }
    }
    throw new Error('Overtime random rule has no selectable outcome.');
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

  function getEffectiveRemainingMs() {
    if (state.status !== 'running') return clampMs(state.remainingMs);
    const elapsedMs = Math.max(0, Math.floor(monotonicNow() - monotonicAnchorMs));
    return clampMs(state.remainingMs - elapsedMs);
  }

  function materialize() {
    const currentWallMs = Math.floor(now());
    state.remainingMs = getEffectiveRemainingMs();
    state.anchorAtMs = Math.max(0, currentWallMs);
    monotonicAnchorMs = monotonicNow();
    if (state.status === 'running' && state.remainingMs === 0) state.status = 'finished';
  }

  function commit(reason, options = {}) {
    state.remainingMs = clampMs(state.remainingMs);
    state.revision += 1;
    state.updatedAt = toIso(now());
    if (options.ignorePending) store.saveStateAndIgnorePending(state);
    else store.saveState(state);
    scheduleZeroTimer();
    if (!state.enabled) clearRetryTimer();
    onUpdate({ reason, state: getSnapshot() });
  }

  function recoverSettlements() {
    if (disposed || recovering || !state.enabled) return;
    recovering = true;
    try {
      const giftEventIds = store.listRecoverableFinal(state.enableEpoch, Math.floor(now()));
      for (const giftEventId of giftEventIds) {
        try {
          finalizeGift({ giftEventId, phase: 'final' });
        } catch (_) {
          // The retry checkpoint and timer are written by finalizeGift.
        }
      }
    } finally {
      recovering = false;
      scheduleNextRecovery();
    }
  }

  function scheduleNextRecovery() {
    if (recovering || disposed || !state.enabled) return;
    const nextAt = store.getNextPendingAt(state.enableEpoch);
    if (nextAt !== null) scheduleRecovery(nextAt);
  }

  function scheduleRecovery(atMs) {
    if (disposed || !state.enabled) return;
    clearRetryTimer();
    const delay = Math.max(0, Math.floor(atMs) - Math.floor(now()));
    retryTimer = scheduleTimeout(() => {
      retryTimer = null;
      recoverSettlements();
    }, delay);
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
  }

  function clearRetryTimer() {
    if (retryTimer) cancelTimeout(retryTimer);
    retryTimer = null;
  }

  function scheduleZeroTimer() {
    if (zeroTimer) {
      cancelTimeout(zeroTimer);
      zeroTimer = null;
    }
    if (disposed || !state.enabled || state.status !== 'running') return;
    const remainingMs = getEffectiveRemainingMs();
    const delay = Math.min(MAX_TIMER_CHUNK_MS, Math.max(0, remainingMs));
    zeroTimer = scheduleTimeout(handleZeroTimer, delay);
    if (zeroTimer && typeof zeroTimer.unref === 'function') zeroTimer.unref();
  }

  function handleZeroTimer() {
    zeroTimer = null;
    if (disposed || !state.enabled || state.status !== 'running') return;
    if (getEffectiveRemainingMs() > 0) {
      scheduleZeroTimer();
      return;
    }
    materialize();
    state.remainingMs = 0;
    state.status = 'finished';
    commit('finished');
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
    dispose
  };
}

function getGiftEventId(event) {
  const giftEventId = Math.floor(Number(event?.giftEventId) || 0);
  return giftEventId > 0 ? giftEventId : 0;
}

function normalizeState(row) {
  return {
    enabled: Number(row.enabled) === 1,
    enableEpoch: Math.max(0, Number(row.enable_epoch) || 0),
    initialSeconds: Math.max(0, Number(row.initial_seconds) || 0),
    remainingMs: clampMs(row.remaining_ms),
    anchorAtMs: Math.max(0, Number(row.anchor_at_ms) || 0),
    status: ['paused', 'running', 'finished'].includes(row.status) ? row.status : 'paused',
    backgroundPath: String(row.background_path || ''),
    backgroundFit: ['cover', 'contain', 'fill'].includes(row.background_fit) ? row.background_fit : 'cover',
    revision: Math.max(0, Number(row.revision) || 0),
    updatedAt: String(row.updated_at || '')
  };
}

function clampMs(value) {
  const number = Math.floor(Number(value) || 0);
  return Math.min(MAX_OVERTIME_MS, Math.max(0, number));
}

function toIso(value) {
  return new Date(Math.max(0, Number(value) || 0)).toISOString();
}

module.exports = { createOvertimeService };
