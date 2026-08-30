'use strict';

const { randomInt: cryptoRandomInt } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createOvertimeStore } = require('./overtime-store');
const {
  MAX_OVERTIME_SECONDS,
  MAX_EFFECT_FACTOR,
  MAX_RANDOM_WEIGHT,
  MAX_ENABLED_RULES,
  MIN_RANDOM_OUTCOMES,
  MAX_RANDOM_OUTCOMES,
  MAX_DISPLAY_TEXT_LENGTH,
  validateTimeInput,
  validateAction,
  validateBackground,
  validateRules,
} = require('./overtime-contract');
const overtimeEffects = require('./overtime-effects');
const {
  applyEffect,
  applyFixedEffectRepeatedly,
  clampMs,
  getGiftEventId,
  isRemoteGiftImagePath,
  normalizeQuantity,
  normalizeState,
  requestedDelta,
  requestedRepeatedDelta,
  summarizeRandomOutcomes,
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
  maxDisplayTextLength: MAX_DISPLAY_TEXT_LENGTH,
});

function createOvertimeService(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const monotonicNow =
    typeof options.monotonicNow === 'function'
      ? options.monotonicNow
      : () => performance.now();
  const scheduleTimeout = options.setTimeout || setTimeout;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  const randomInt =
    typeof options.randomInt === 'function'
      ? options.randomInt
      : cryptoRandomInt;
  const onUpdate =
    typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
  const store = options.store || createOvertimeStore(options.giftDb);
  let state = normalizeState(
    store.getState() || store.ensureState(toIso(now())),
  );
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
      rules: store.listRules(),
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
      settlements: store.listRecent(20),
    };
  }

  function setTime(input) {
    const value = validateTimeInput(input);
    materialize();
    if (Object.hasOwn(value, 'initialSeconds'))
      state.initialSeconds = value.initialSeconds;
    if (Object.hasOwn(value, 'remainingSeconds')) {
      state.remainingMs = value.remainingSeconds * 1000;
      state.status =
        state.enabled && state.remainingMs === 0 ? 'finished' : 'paused';
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
    if (!state.enabled)
      throw new Error('overtime must be enabled before start.');
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
    state.status =
      state.enabled && state.remainingMs === 0 ? 'finished' : 'paused';
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
    const rules = validateRules(migrateRemoteRuleImages(input), {
      allowedRemoteImageOrigins: options.allowedRemoteImageOrigins,
    });
    store.replaceRules(rules, toIso(now()));
    materialize();
    commit('rules');
    return getSnapshot();
  }

  function migrateRemoteRuleImages(input) {
    if (
      !Array.isArray(input) ||
      typeof options.resolveGiftImagePath !== 'function'
    )
      return input;
    return input.map((rule) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return rule;
      const imagePath = String(rule.imagePath ?? rule.image_path ?? '').trim();
      const giftId = String(rule.giftId ?? rule.gift_id ?? '').trim();
      if (!giftId || !isRemoteGiftImagePath(imagePath)) return rule;
      let replacement = '';
      try {
        replacement = String(
          options.resolveGiftImagePath(giftId, imagePath, rule) || '',
        ).trim();
      } catch (_) {
        replacement = '';
      }
      if (!replacement || replacement === imagePath) return rule;
      return { ...rule, imagePath: replacement };
    });
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
      if (
        observed.kind === 'complete' ||
        observed.kind === 'ineligible' ||
        observed.kind === 'missing'
      ) {
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
        ({ gift, rule }) =>
          resolveGiftSettlement(
            giftEventId,
            gift,
            rule,
            materializedState,
            updatedAt,
          ),
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
        retry = store.recordFailure(
          giftEventId,
          error,
          currentMs,
          toIso(currentMs),
        );
      } catch (_) {
        retry = null;
      }
      scheduleRecovery(retry?.settleAfterMs || currentMs + 1000);
      throw error;
    }
  }

  function resolveGiftSettlement(
    giftEventId,
    gift,
    rule,
    currentState,
    updatedAt,
  ) {
    const quantity = normalizeQuantity(gift.num);
    const applicationCount = rule.quantityMode === 'item' ? quantity : 1;
    const beforeMs = clampMs(currentState.remainingMs);
    const resolution = applyRule(rule, applicationCount, beforeMs);
    const afterMs = resolution.afterMs;
    const appliedDeltaSeconds = Math.trunc((afterMs - beforeMs) / 1000);
    const nextState = { ...currentState, remainingMs: afterMs };

    if (afterMs === 0) nextState.status = 'finished';
    else if (afterMs > beforeMs && currentState.status === 'finished')
      nextState.status = 'running';
    nextState.revision += 1;
    nextState.updatedAt = updatedAt;

    const ruleSnapshot = {
      version: 2,
      mode: rule.mode,
      quantityMode: rule.quantityMode,
      fixedEffect: rule.mode === 'fixed' ? rule.fixedEffect : null,
      outcomes: rule.mode === 'random' ? rule.outcomes : [],
      ruleUpdatedAt: rule.updatedAt,
    };
    const adjustment = {
      giftEventId,
      giftId: String(gift.gift_id || ''),
      giftName: String(gift.gift_name || ''),
      quantity,
      quantityMode: rule.quantityMode,
      applicationCount,
      totalPrice: Number(gift.total_price) || 0,
      imagePath: rule.imagePath,
      mode: rule.mode,
      effect: resolution.effect,
      beforeSeconds: Math.floor(beforeMs / 1000),
      afterSeconds: Math.floor(afterMs / 1000),
      requestedDeltaSeconds: resolution.requestedDeltaSeconds,
      appliedDeltaSeconds,
      resultSeconds: appliedDeltaSeconds,
      result: resolution.outcome,
    };
    if (rule.mode === 'display') {
      ruleSnapshot.displayText = rule.displayText;
      adjustment.displayText = rule.displayText;
    }

    return {
      state: nextState,
      ruleMode: rule.mode,
      ruleSnapshotJson: JSON.stringify(ruleSnapshot),
      requestedDeltaSeconds: resolution.requestedDeltaSeconds,
      appliedDeltaSeconds,
      outcomesJson: resolution.outcome
        ? JSON.stringify(resolution.outcome)
        : '',
      adjustment,
    };
  }

  function applyRule(rule, applicationCount, beforeMs) {
    if (rule.mode === 'display') {
      return {
        afterMs: beforeMs,
        requestedDeltaSeconds: 0,
        effect: null,
        outcome: null,
      };
    }
    if (rule.mode === 'fixed') {
      const afterMs = applyFixedEffectRepeatedly(
        beforeMs,
        rule.fixedEffect,
        applicationCount,
      );
      const appliedDeltaSeconds = Math.trunc((afterMs - beforeMs) / 1000);
      return {
        afterMs,
        requestedDeltaSeconds: requestedRepeatedDelta(
          rule.fixedEffect,
          applicationCount,
          appliedDeltaSeconds,
        ),
        effect: rule.fixedEffect,
        outcome: null,
      };
    }

    let afterMs = beforeMs;
    let requestedDeltaSeconds = 0;
    const outcomes = [];
    for (let index = 0; index < applicationCount; index += 1) {
      const selection = selectRuleResult(rule);
      const nextMs = applyEffect(afterMs, selection.effect);
      const appliedDeltaSeconds = Math.trunc((nextMs - afterMs) / 1000);
      requestedDeltaSeconds += requestedDelta(
        selection.effect,
        appliedDeltaSeconds,
      );
      afterMs = nextMs;
      outcomes.push(selection.outcome);
    }
    return {
      afterMs,
      requestedDeltaSeconds,
      effect: applicationCount === 1 ? outcomes[0].selectedEffect : null,
      outcome: summarizeRandomOutcomes(outcomes),
    };
  }

  function selectRuleResult(rule) {
    if (rule.mode === 'fixed')
      return { effect: rule.fixedEffect, outcome: null };
    const totalWeight = rule.outcomes.reduce(
      (sum, outcome) => sum + Number(outcome.weight),
      0,
    );
    const draw = randomInt(totalWeight);
    let cumulative = 0;
    for (let index = 0; index < rule.outcomes.length; index += 1) {
      const outcome = rule.outcomes[index];
      cumulative += Number(outcome.weight);
      if (draw < cumulative) {
        const result = {
          version: 2,
          selectedIndex: index,
          selectedEffect: {
            operation: outcome.operation,
            value: Number(outcome.value),
          },
          totalWeight,
        };
        return { effect: result.selectedEffect, outcome: result };
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
    const elapsedMs = Math.max(
      0,
      Math.floor(monotonicNow() - monotonicAnchorMs),
    );
    return clampMs(state.remainingMs - elapsedMs);
  }

  function materialize() {
    const currentWallMs = Math.floor(now());
    state.remainingMs = getEffectiveRemainingMs();
    state.anchorAtMs = Math.max(0, currentWallMs);
    monotonicAnchorMs = monotonicNow();
    if (state.status === 'running' && state.remainingMs === 0)
      state.status = 'finished';
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
      const giftEventIds = store.listRecoverableFinal(
        state.enableEpoch,
        Math.floor(now()),
      );
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
    if (retryTimer && typeof retryTimer.unref === 'function')
      retryTimer.unref();
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
    dispose,
  };
}

module.exports = { createOvertimeService };
