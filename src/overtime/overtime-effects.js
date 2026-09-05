'use strict';

const { MAX_OVERTIME_SECONDS } = require('./overtime-contract');

const MAX_OVERTIME_MS = MAX_OVERTIME_SECONDS * 1000;

function applyEffect(beforeMs, effect) {
  const operation = effect?.operation;
  const value = Math.max(0, Math.floor(Number(effect?.value) || 0));
  if (operation === 'clear') return 0;
  if (operation === 'add') return clampMs(beforeMs + value * 1000);
  if (operation === 'subtract') return clampMs(beforeMs - value * 1000);
  if (operation === 'multiply') {
    return beforeMs > MAX_OVERTIME_MS / value
      ? MAX_OVERTIME_MS
      : clampMs(beforeMs * value);
  }
  if (operation === 'divide')
    return clampMs(Math.floor(beforeMs / value / 1000) * 1000);
  throw new Error('Overtime effect operation is invalid.');
}

function applyFixedEffectRepeatedly(beforeMs, effect, applicationCount) {
  const operation = effect?.operation;
  const value = Math.max(0, Math.floor(Number(effect?.value) || 0));
  if (operation === 'add')
    return clampMs(beforeMs + value * applicationCount * 1000);
  if (operation === 'subtract')
    return clampMs(beforeMs - value * applicationCount * 1000);
  if (operation === 'clear') return 0;

  let afterMs = beforeMs;
  for (let index = 0; index < applicationCount; index += 1) {
    const nextMs = applyEffect(afterMs, effect);
    if (nextMs === afterMs) break;
    afterMs = nextMs;
  }
  return afterMs;
}

function requestedRepeatedDelta(effect, applicationCount, appliedDeltaSeconds) {
  if (effect.operation === 'add') return effect.value * applicationCount;
  if (effect.operation === 'subtract') return -effect.value * applicationCount;
  return appliedDeltaSeconds;
}

function summarizeRandomOutcomes(outcomes) {
  if (outcomes.length === 1) return outcomes[0];
  return {
    version: 3,
    quantity: outcomes.length,
    selectedIndexes: outcomes.map((outcome) => outcome.selectedIndex),
    totalWeight: outcomes[0]?.totalWeight || 0,
  };
}

function requestedDelta(effect, appliedDeltaSeconds) {
  if (effect.operation === 'add') return effect.value;
  if (effect.operation === 'subtract') return -effect.value;
  return appliedDeltaSeconds;
}

function getGiftEventId(event) {
  const giftEventId = Math.floor(Number(event?.giftEventId) || 0);
  return giftEventId > 0 ? giftEventId : 0;
}

function normalizeQuantity(value) {
  const quantity = Math.floor(Number(value) || 1);
  return quantity > 0 ? quantity : 1;
}

function normalizeState(row) {
  return {
    enabled: Number(row.enabled) === 1,
    enableEpoch: Math.max(0, Number(row.enable_epoch) || 0),
    initialSeconds: Math.max(0, Number(row.initial_seconds) || 0),
    remainingMs: clampMs(row.remaining_ms),
    anchorAtMs: Math.max(0, Number(row.anchor_at_ms) || 0),
    status: ['paused', 'running', 'finished'].includes(row.status)
      ? row.status
      : 'paused',
    backgroundPath: String(row.background_path || ''),
    backgroundFit: ['cover', 'contain', 'fill'].includes(row.background_fit)
      ? row.background_fit
      : 'cover',
    revision: Math.max(0, Number(row.revision) || 0),
    updatedAt: String(row.updated_at || ''),
  };
}

function clampMs(value) {
  const number = Math.floor(Number(value) || 0);
  return Math.min(MAX_OVERTIME_MS, Math.max(0, number));
}

function isRemoteGiftImagePath(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      /^\/gift-media\/images\/[A-Za-z0-9._-]+$/u.test(parsed.pathname)
    );
  } catch (_) {
    return false;
  }
}

function isLegacyGiftImagePath(value) {
  return (
    typeof value === 'string' &&
    /^\/img\/bilibili-gifts\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:gif|jpe?g|png|webp)$/iu.test(
      value,
    ) &&
    !value.includes('..')
  );
}

function toIso(value) {
  return new Date(Math.max(0, Number(value) || 0)).toISOString();
}

module.exports = {
  applyEffect,
  applyFixedEffectRepeatedly,
  clampMs,
  getGiftEventId,
  isLegacyGiftImagePath,
  isRemoteGiftImagePath,
  normalizeQuantity,
  normalizeState,
  requestedDelta,
  requestedRepeatedDelta,
  summarizeRandomOutcomes,
  toIso,
};
