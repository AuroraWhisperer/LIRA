'use strict';

// Fixed memory and time budgets, independent of message text/cardinality.
function createLogRateLimit({ now = Date.now, intervalMs = 60_000, maxEntries = 120, maxPerKey = 5 } = {}) {
  const counts = new Map();
  let startedAt = now();
  let accepted = 0;
  let suppressed = 0;

  return function admit(key) {
    const timestamp = now();
    let previousSuppressed = 0;
    if (timestamp - startedAt >= intervalMs || timestamp < startedAt) {
      previousSuppressed = suppressed;
      startedAt = timestamp;
      accepted = 0;
      suppressed = 0;
      counts.clear();
    }
    const count = counts.get(key) || 0;
    if (accepted >= maxEntries || count >= maxPerKey) {
      suppressed += 1;
      return { allowed: false, suppressed: previousSuppressed };
    }
    accepted += 1;
    counts.set(key, count + 1);
    return { allowed: true, suppressed: previousSuppressed };
  };
}

module.exports = { createLogRateLimit };
