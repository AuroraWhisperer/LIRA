'use strict';

const { normalizeRoomInput } = require('./room-input');

function readRoomGuardCount(info) {
  const value = info?.guard_info?.count;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function createRoomGuardService({ readCount, onChange, pollMs = 60000,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  let state = { roomId: '', count: null };
  let controller = null;
  let timer = null;
  let stopped = false;

  function publish(count) {
    if (state.count === count) return;
    state = { ...state, count };
    onChange({ ...state });
  }

  async function refresh(activeController) {
    try {
      const count = await readCount(state.roomId, { signal: activeController.signal });
      if (controller !== activeController || activeController.signal.aborted) return;
      publish(Number.isSafeInteger(count) && count >= 0 ? count : null);
    } catch {
      if (controller !== activeController || activeController.signal.aborted) return;
      publish(null);
    } finally {
      if (controller === activeController && !activeController.signal.aborted) {
        timer = setTimeoutFn(() => refresh(activeController), pollMs);
        timer?.unref?.();
      }
    }
  }

  function configure(input, force = false) {
    if (stopped) return;
    const roomId = normalizeRoomInput(input);
    if (!force && state.roomId === roomId) return;
    controller?.abort();
    clearTimeoutFn(timer);
    timer = null;
    state = { roomId, count: null };
    onChange({ ...state });
    controller = roomId ? new AbortController() : null;
    if (controller) void refresh(controller);
  }

  function stop() {
    stopped = true;
    controller?.abort();
    controller = null;
    clearTimeoutFn(timer);
    timer = null;
  }

  return { configure, stop, getSnapshot: () => ({ ...state }) };
}

module.exports = { readRoomGuardCount, createRoomGuardService };
