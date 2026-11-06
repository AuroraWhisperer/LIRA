'use strict';

const { MAX_RANDOM_APPLICATIONS } = require('./overtime-contract');
const { applyEffect, applyFixedEffectRepeatedly, clampMs, normalizeQuantity,
  requestedDelta, requestedRepeatedDelta, summarizeRandomOutcomes } = require('./overtime-effects');

function resolveGiftSettlement({ giftEventId, gift, rule, currentState, updatedAt, randomInt }) {
  const quantity = normalizeQuantity(gift.num);
  const applicationCount = rule.quantityMode === 'item' ? quantity : 1;
  if (rule.mode === 'random' && applicationCount > MAX_RANDOM_APPLICATIONS) {
    throw Object.assign(new Error('OVERTIME_QUANTITY_LIMIT'), { code: 'OVERTIME_QUANTITY_LIMIT' });
  }
  const beforeMs = clampMs(currentState.remainingMs);
  const resolution = applyRule(rule, applicationCount, beforeMs, randomInt);
  const afterMs = resolution.afterMs;
  const appliedDeltaSeconds = Math.trunc((afterMs - beforeMs) / 1000);
  const nextState = { ...currentState, remainingMs: afterMs };

  if (afterMs === 0) nextState.status = 'finished';
  else if (afterMs > beforeMs && currentState.status === 'finished') nextState.status = 'running';
  nextState.revision += 1;
  nextState.updatedAt = updatedAt;

  const ruleSnapshot = {
    version: 2,
    giftIdentity: rule.giftIdentity,
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
    outcomesJson: resolution.outcome ? JSON.stringify(resolution.outcome) : '',
    adjustment,
  };
}

function applyRule(rule, applicationCount, beforeMs, randomInt) {
  if (rule.mode === 'display') {
    return {
      afterMs: beforeMs,
      requestedDeltaSeconds: 0,
      effect: null,
      outcome: null,
    };
  }
  if (rule.mode === 'fixed') {
    const afterMs = applyFixedEffectRepeatedly(beforeMs, rule.fixedEffect, applicationCount);
    const appliedDeltaSeconds = Math.trunc((afterMs - beforeMs) / 1000);
    return {
      afterMs,
      requestedDeltaSeconds: requestedRepeatedDelta(rule.fixedEffect, applicationCount, appliedDeltaSeconds),
      effect: rule.fixedEffect,
      outcome: null,
    };
  }

  let afterMs = beforeMs;
  let requestedDeltaSeconds = 0;
  const selectedIndexes = [];
  let firstOutcome = null;
  const totalWeight = rule.outcomes.reduce((sum, outcome) => sum + Number(outcome.weight), 0);
  for (let index = 0; index < applicationCount; index += 1) {
    const selection = selectRuleResult(rule, totalWeight, randomInt);
    const nextMs = applyEffect(afterMs, selection.effect);
    const appliedDeltaSeconds = Math.trunc((nextMs - afterMs) / 1000);
    requestedDeltaSeconds += requestedDelta(selection.effect, appliedDeltaSeconds);
    afterMs = nextMs;
    if (index === 0) firstOutcome = selection.outcome;
    selectedIndexes.push(selection.outcome.selectedIndex);
  }
  return {
    afterMs,
    requestedDeltaSeconds,
    effect: applicationCount === 1 ? firstOutcome.selectedEffect : null,
    outcome: summarizeRandomOutcomes(firstOutcome, selectedIndexes),
  };
}

function selectRuleResult(rule, totalWeight, randomInt) {
  if (rule.mode === 'fixed') return { effect: rule.fixedEffect, outcome: null };
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

module.exports = { resolveGiftSettlement };
