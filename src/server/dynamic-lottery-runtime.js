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
  try {
    store.recoverInterrupted(clock.nowMs());
    drawStore.recoverInterrupted(clock.nowMs());
  } catch {
    // Isolate the optional database; do not expose SQLite paths or user data.
    return unavailableRuntime('LOTTERY_STORAGE_UNAVAILABLE');
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
    getIdentity: auth.getIdentity,
    getContext: auth.getContext,
    request: scheduler.request,
    resumeRequests: scheduler.resume,
    pauseRequests: scheduler.pause,
  });
  return {
    getState: service.getState,
    createTask: service.createTask,
    actOnTask: service.actOnTask,
    async dispose() {
      await service.dispose();
      await scheduler.dispose();
    },
  };
}

module.exports = { createDynamicLotteryRuntime };
