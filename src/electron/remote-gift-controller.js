'use strict';

const {
  normalizeProcessedGiftEvent,
} = require('../shared/processed-gift-contract');
const { createRemoteGiftSourceKey } = require('./remote-gift-cursor-store');

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 60_000;

function createRemoteGiftController(options = {}) {
  const licenseManager = options.licenseManager;
  const runtime = options.runtime;
  const cursorStore = options.cursorStore;
  if (
    !licenseManager ||
    !runtime?.importProcessedGiftEvent ||
    !cursorStore?.load ||
    !cursorStore?.save
  ) {
    throw new Error('Remote gift controller dependencies are required.');
  }
  const suppliedTimers = options.timers || {};
  const timers = {
    setTimeout: suppliedTimers.setTimeout || setTimeout,
    clearTimeout: suppliedTimers.clearTimeout || clearTimeout,
  };
  let active = false;
  let disposed = false;
  let sourceKey = '';
  let cursor = null;
  let operation = Promise.resolve();
  let streamController = null;
  let reconnectTimer = null;
  let reconnectDelayMs = RECONNECT_MIN_MS;

  function isAuthorized() {
    return (
      !disposed &&
      licenseManager.getState() === licenseManager.LicenseState.AUTHORIZED
    );
  }

  function enqueue(task) {
    const next = operation.then(task, task);
    operation = next.catch(() => {});
    return next;
  }

  function resolveSourceKey() {
    const snapshot = licenseManager.getSnapshot?.() || {};
    return createRemoteGiftSourceKey(
      licenseManager.getRemoteBaseUrl?.(),
      snapshot.streamer,
      snapshot.device,
    );
  }

  async function ensureCursor() {
    const nextSourceKey = resolveSourceKey();
    if (sourceKey !== nextSourceKey) {
      sourceKey = nextSourceKey;
      cursor = cursorStore.load(sourceKey);
    }
    if (cursor !== null) return cursor;
    const baseline = await licenseManager.getGiftEventsInternal({ limit: 200 });
    if (!active || !isAuthorized()) return null;
    cursor = baseline.nextCursor;
    cursorStore.save(sourceKey, cursor);
    return cursor;
  }

  async function deliver(input) {
    if (!active || !isAuthorized()) return false;
    const event = normalizeProcessedGiftEvent(input);
    if (
      event.phase === 'final' &&
      cursor !== null &&
      event.cursor <= cursor
    ) {
      return false;
    }
    await runtime.importProcessedGiftEvent(event);
    if (event.phase === 'final') {
      cursor = event.cursor;
      cursorStore.save(sourceKey, cursor);
    }
    return true;
  }

  async function deliverLive(input) {
    const event = normalizeProcessedGiftEvent(input);
    if (
      event.phase === 'final' &&
      cursor !== null &&
      event.cursor > cursor + 1
    ) {
      await catchUp();
      if (event.cursor > cursor + 1) {
        throw new Error('INVALID_PROCESSED_GIFT_CURSOR_GAP');
      }
    }
    return deliver(event);
  }

  async function catchUp() {
    if (!active || !isAuthorized()) return false;
    await ensureCursor();
    if (cursor === null) return false;
    while (active && isAuthorized()) {
      const previousCursor = cursor;
      let page;
      try {
        page = await licenseManager.getGiftEventsInternal({
          after: cursor,
          limit: 200,
        });
      } catch (error) {
        if (error?.code !== 'INVALID_GIFT_CURSOR') throw error;
        cursor = null;
        await ensureCursor();
        return cursor !== null;
      }
      for (const event of page.events) await deliver(event);
      if (page.events.length === 0 && page.nextCursor !== cursor) {
        throw new Error('INVALID_PROCESSED_GIFT_PAGE');
      }
      if (!page.hasMore) return true;
      if (cursor === previousCursor) {
        throw new Error('INVALID_PROCESSED_GIFT_PAGE');
      }
    }
    return false;
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    timers.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    if (!active || !isAuthorized()) return;
    const delay = reconnectDelayMs;
    reconnectDelayMs = Math.min(RECONNECT_MAX_MS, reconnectDelayMs * 2);
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      startEventStream();
    }, delay);
    reconnectTimer.unref?.();
  }

  function restartStream(controller) {
    if (streamController !== controller) return;
    streamController = null;
    controller.abort();
    scheduleReconnect();
  }

  function startEventStream() {
    if (streamController || !active || !isAuthorized()) return;
    const controller = new AbortController();
    streamController = controller;
    licenseManager
      .watchGiftEventsInternal({
        signal: controller.signal,
        onOpen() {
          reconnectDelayMs = RECONNECT_MIN_MS;
          enqueue(catchUp).catch(() => restartStream(controller));
        },
        onEvent(event) {
          enqueue(() => deliverLive(event)).catch(() =>
            restartStream(controller),
          );
        },
      })
      .catch(() => {})
      .finally(() => {
        if (streamController !== controller) return;
        streamController = null;
        if (!controller.signal.aborted) scheduleReconnect();
      });
  }

  function stopStream() {
    clearReconnectTimer();
    const controller = streamController;
    streamController = null;
    controller?.abort();
    reconnectDelayMs = RECONNECT_MIN_MS;
  }

  function start() {
    if (disposed) return Promise.resolve(false);
    active = true;
    return enqueue(async () => {
      if (!isAuthorized()) return false;
      await ensureCursor();
      if (!active || !isAuthorized()) return false;
      startEventStream();
      return true;
    });
  }

  function stop() {
    active = false;
    stopStream();
  }

  function resume() {
    if (disposed) return Promise.resolve(false);
    active = true;
    stopStream();
    return enqueue(async () => {
      if (!isAuthorized()) return false;
      await ensureCursor();
      if (!active || !isAuthorized()) return false;
      startEventStream();
      return true;
    });
  }

  function whenIdle() {
    return operation;
  }

  function getCursor() {
    return cursor;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
  }

  return {
    dispose,
    getCursor,
    resume,
    start,
    stop,
    whenIdle,
  };
}

module.exports = {
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  createRemoteGiftController,
};
