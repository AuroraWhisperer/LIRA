'use strict';

const IDLE_TIMEOUT_MS = 15000;

// Reads renew one shared lease. The grace period covers the five-second health
// check and short page reloads without keeping an unused upstream stream alive.
function createDisplayDemand({ now = Date.now, timers = globalThis } = {}) {
  const listeners = new Set();
  let active = false;
  let disposed = false;
  let expiresAt = 0;
  let timer = null;

  function update(value) {
    if (active === value) return;
    active = value;
    for (const listener of listeners) listener(active);
  }

  function expire() {
    timer = null;
    const remaining = expiresAt - now();
    if (remaining > 0) schedule(remaining);
    else update(false);
  }

  function schedule(delay) {
    timer = timers.setTimeout(expire, delay);
    timer?.unref?.();
  }

  function touch() {
    if (disposed) return;
    expiresAt = now() + IDLE_TIMEOUT_MS;
    if (timer === null) schedule(IDLE_TIMEOUT_MS);
    update(true);
  }

  function subscribe(listener) {
    if (disposed) { listener(false); return () => {}; }
    listeners.add(listener);
    listener(active);
    return () => listeners.delete(listener);
  }

  function dispose() {
    disposed = true;
    timers.clearTimeout(timer);
    timer = null;
    update(false);
    listeners.clear();
  }

  return { touch, subscribe, dispose };
}

module.exports = { createDisplayDemand };
