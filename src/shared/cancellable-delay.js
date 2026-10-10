'use strict';

const MAX_DELAY_MS = 2 ** 31 - 1;

// One owned timeout, including delays beyond Node's timer range. Replacing or
// cancelling it also invalidates callbacks already queued by the old timer.
function createCancellableDelay(timers = { setTimeout, clearTimeout }) {
  let timer = null;
  let generation = 0;

  function cancel() {
    generation += 1;
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }

  function schedule(callback, delay) {
    cancel();
    const scheduledGeneration = generation;
    function arm(remaining) {
      const segment = Math.min(remaining, MAX_DELAY_MS);
      const scheduledTimer = timers.setTimeout(() => {
        if (generation !== scheduledGeneration || timer !== scheduledTimer) return;
        timer = null;
        if (remaining > segment) arm(remaining - segment);
        else callback();
      }, segment);
      timer = scheduledTimer;
      timer?.unref?.();
    }
    arm(delay);
  }

  return { schedule, cancel, isPending: () => timer !== null };
}

module.exports = { createCancellableDelay };
