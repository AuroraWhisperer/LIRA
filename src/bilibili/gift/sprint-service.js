'use strict';

const { now, normalizeMoney } = require('../../shared/utils');
const { resolveGiftSourceScope } = require('./source-scope');

const CRYSTAL_BALL_VALUE_RMB = 100;
const sprintAggregates = new WeakMap();

function resetGiftSprintProgress(context) {
  const sourceScope = resolveGiftSourceScope(context);
  const changedCount = context.queryStore.resetSprint({
    sourceScope,
    updatedAt: now(),
  });
  return {
    reset: true,
    changedCount: Number(changedCount || 0),
    giftSprint: getGiftSprintSnapshot(context),
  };
}

function getGiftSprintSnapshot(context) {
  const settings = context.settings();
  const targetRmb = normalizeMoney(settings.giftSprintTargetRmb);
  const sourceScope = resolveGiftSourceScope(context);
  const store = context.queryStore;
  const revision = store.getChangeToken?.('sprint');
  const key = revision == null || sourceScope.kind === 'unavailable' ? null : JSON.stringify([sourceScope, revision]);
  const cached = sprintAggregates.get(store);
  const row = key !== null && cached?.key === key ? cached.row : store.readSprint(sourceScope);
  if (key !== null) sprintAggregates.set(store, { key, row });
  else sprintAggregates.delete(store);
  const receivedRmb = normalizeMoney(row.receivedRmb);
  const remainingRmb = Math.max(0, normalizeMoney(targetRmb - receivedRmb));

  return {
    enabled: settings.enableGiftSprint === 'true',
    targetRmb,
    receivedRmb,
    remainingRmb,
    crystalBallValueRmb: CRYSTAL_BALL_VALUE_RMB,
    remainingCrystalBalls: Math.ceil(remainingRmb / CRYSTAL_BALL_VALUE_RMB),
    countedGiftCount: Number(row.countedGiftCount || 0),
  };
}

module.exports = { CRYSTAL_BALL_VALUE_RMB, resetGiftSprintProgress, getGiftSprintSnapshot };
