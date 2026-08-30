'use strict';

function createWeSingPlaybackClock(getDurationMs) {
  let baseMs = 0;
  let startedAt = 0;
  let running = false;

  function read(timestamp) {
    const elapsed = running ? Math.max(0, timestamp - startedAt) : 0;
    const currentMs = Math.max(0, baseMs + elapsed);
    const durationMs = Number(getDurationMs()) || 0;
    return durationMs > 0 ? Math.min(durationMs, currentMs) : currentMs;
  }

  function set(currentMs, timestamp) {
    baseMs = Math.max(0, Number(currentMs) || 0);
    startedAt = timestamp;
  }

  function start(timestamp) {
    if (running) return;
    startedAt = timestamp;
    running = true;
  }

  function pause(timestamp) {
    if (!running) return;
    baseMs = read(timestamp);
    startedAt = timestamp;
    running = false;
  }

  function reset(timestamp) {
    baseMs = 0;
    startedAt = timestamp;
    running = false;
  }

  return { read, set, start, pause, reset };
}

module.exports = { createWeSingPlaybackClock };
