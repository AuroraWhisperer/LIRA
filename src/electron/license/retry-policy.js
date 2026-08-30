'use strict';

/**
 * Bounded exponential backoff with jitter for authorization retries.
 *
 * nextDelay() returns baseMs * 2^attempts capped at capMs, scaled by a jitter
 * factor in [0.5, 1.5), or null once maxAttempts is exhausted — callers must
 * treat null as "stop retrying". `jitter` is injectable (returns [0, 1)) so
 * tests can make the sequence deterministic.
 */
function createRetryPolicy({
  baseMs = 5000,
  capMs = 60000,
  maxAttempts = 10,
  jitter = Math.random,
} = {}) {
  if (typeof jitter !== 'function')
    throw new Error('jitter must be a function');
  let attempts = 0;

  function nextDelay() {
    if (attempts >= maxAttempts) return null;
    const exponential = Math.min(capMs, baseMs * 2 ** attempts);
    attempts += 1;
    return Math.floor(exponential * (0.5 + jitter()));
  }

  function reset() {
    attempts = 0;
  }

  return {
    nextDelay,
    reset,
    get attempts() {
      return attempts;
    },
  };
}

module.exports = { createRetryPolicy };
