'use strict';

function createGiftRetentionMaintenance({ runBatch, canRun, timers = { setTimeout, clearTimeout }, onError = () => {} }) {
  const pending = new Set();
  let timer = null;
  let stopped = false;
  let ready = false;
  let running = false;
  function runLocal(operation) {
    if (stopped) throw new Error('GIFT_MAINTENANCE_STOPPED');
    if (running) throw new Error('GIFT_MAINTENANCE_REENTRY');
    running = true;
    try { return operation(); }
    finally { running = false; }
  }
  function schedule(delay = 25) {
    if (stopped || !ready || timer || !pending.size) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (stopped) return;
      const sourceId = pending.values().next().value;
      pending.delete(sourceId);
      let nextDelay = 25;
      try {
        if (canRun(sourceId)) {
          const result = runLocal(() => runBatch(sourceId));
          if (result.hasMore) pending.add(sourceId);
        }
      } catch (error) {
        pending.add(sourceId);
        nextDelay = 300000;
        onError(sourceId, error);
      }
      schedule(nextDelay);
    }, delay);
    timer.unref?.();
  }
  return {
    request(sourceId) {
      if (stopped || !Number.isSafeInteger(sourceId) || sourceId < 1) return;
      pending.add(sourceId);
      schedule();
    },
    start() { if (!stopped) { ready = true; schedule(); } },
    runLocal,
    stop() {
      stopped = true;
      timers.clearTimeout(timer);
      timer = null;
      pending.clear();
      // All batches are synchronous storage transactions. A stop callback runs
      // only after the in-flight transaction has returned to the event loop.
      return Promise.resolve();
    },
  };
}

module.exports = { createGiftRetentionMaintenance };
