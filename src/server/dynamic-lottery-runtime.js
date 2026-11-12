'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { createDynamicLotteryStore } = require('../storage/dynamic-lottery-store');
const { createLotteryDrawStore } = require('../storage/dynamic-lottery-draw-store');
const { createRequestScheduler } = require('../bilibili/dynamic-lottery/request-scheduler');
const { createDynamicLotteryService } = require('../bilibili/dynamic-lottery/service');
const { lotteryError } = require('../bilibili/dynamic-lottery/rules');

function unavailableRuntime(code) {
  const unavailable = () => {
    throw lotteryError(code);
  };
  return {
    getState: unavailable,
    createTask: unavailable,
    actOnTask: unavailable,
    dispose: async () => {},
  };
}

function createDynamicLotteryRuntime({ db, auth, fetchImpl = globalThis.fetch }) {
  if (!db || !auth) {
    return unavailableRuntime(!db ? 'LOTTERY_STORAGE_UNAVAILABLE' : 'LOTTERY_DESKTOP_REQUIRED');
  }
  const clock = {
    nowMs: Date.now,
    sleep: (ms, signal) => delay(ms, undefined, { signal }),
  };
  const store = createDynamicLotteryStore(db);
  const drawStore = createLotteryDrawStore(db);
  let recoveredScope = null;
  function getIdentity() {
    const identity = auth.getIdentity();
    if (identity?.streamerId && identity.streamerId !== recoveredScope) {
      try {
        store.recoverInterrupted(clock.nowMs(), identity.streamerId);
        drawStore.recoverInterrupted(clock.nowMs(), identity.streamerId);
        store.pruneCompletedHistory(identity.streamerId);
        recoveredScope = identity.streamerId;
      } catch {
        // Never maintain legacy data whose server ownership is unknown.
        throw lotteryError('LOTTERY_STORAGE_UNAVAILABLE');
      }
    }
    return identity;
  }
  const scheduler = createRequestScheduler({
    fetchImpl,
    budgetStore: store.requestBudget,
    clock,
  });
  const service = createDynamicLotteryService({
    store,
    drawStore,
    clock,
    getIdentity,
    getContext: auth.getContext,
    request: scheduler.request,
    resumeRequests: scheduler.resume,
    pauseRequests: scheduler.pause,
  });

  async function runInCurrentScope(operation) {
    const expected = getIdentity();
    await service.drainInvalidated();
    const current = getIdentity();
    if (
      expected?.streamerId !== current?.streamerId ||
      expected?.authorizationEpoch !== current?.authorizationEpoch ||
      expected?.signal !== current?.signal
    ) {
      throw lotteryError('LOTTERY_SESSION_CHANGED');
    }
    expected?.signal?.throwIfAborted();
    return operation();
  }

  return {
    getState: service.getState,
    createTask: (input) => runInCurrentScope(() => service.createTask(input)),
    actOnTask: (input) => runInCurrentScope(() => service.actOnTask(input)),
    async dispose() {
      await service.dispose();
      await scheduler.dispose();
    },
  };
}

module.exports = { createDynamicLotteryRuntime };
