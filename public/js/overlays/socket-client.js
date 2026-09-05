'use strict';

const DEFAULT_RECONNECT_BASE_DELAY_MS = 800;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30000;
const DEFAULT_RECONNECT_EXPONENT_MAX = 6;

/**
 * Build the WebSocket URL used by browser-source overlays.
 * @param {Object} [options]
 * @param {Location} [options.locationRef]
 * @param {string} [options.token]
 * @returns {string}
 */
export function buildOverlaySocketUrl({
  locationRef = globalThis.location,
  token = globalThis.window?.__API_TOKEN__,
} = {}) {
  const protocol = locationRef?.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = token ? `?token=${encodeURIComponent(String(token))}` : '';
  return `${protocol}//${locationRef?.host || ''}/ws${query}`;
}

/**
 * Create an idempotent overlay WebSocket lifecycle controller.
 * @param {Object} [options]
 * @param {Function} [options.onOpen]
 * @param {Function} [options.onReconnect]
 * @param {Function} [options.onMessage]
 * @param {Function} [options.onClose]
 * @param {Function} [options.onError]
 * @param {Function} [options.onParseError]
 * @param {number} [options.reconnectBaseDelayMs]
 * @param {number} [options.reconnectMaxDelayMs]
 * @param {number} [options.reconnectExponentMax]
 * @param {Function} [options.WebSocketClass]
 * @param {Function} [options.setTimeoutFn]
 * @param {Function} [options.clearTimeoutFn]
 * @returns {{start: Function, connect: Function, dispose: Function}}
 */
export function createOverlaySocket(options = {}) {
  const {
    onOpen,
    onReconnect,
    onMessage,
    onClose,
    onError,
    onParseError,
    reconnectBaseDelayMs = DEFAULT_RECONNECT_BASE_DELAY_MS,
    reconnectMaxDelayMs = DEFAULT_RECONNECT_MAX_DELAY_MS,
    reconnectExponentMax = DEFAULT_RECONNECT_EXPONENT_MAX,
    locationRef,
    token,
    WebSocketClass = globalThis.WebSocket,
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout,
  } = options;

  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let connectionGeneration = 0;
  let started = false;
  let disposed = false;

  function clearReconnectTimer() {
    if (reconnectTimer === null) return;
    clearTimeoutFn(reconnectTimer);
    reconnectTimer = null;
  }

  function isCurrentConnection(candidate, generation) {
    return (
      !disposed &&
      started &&
      socket === candidate &&
      connectionGeneration === generation
    );
  }

  function scheduleReconnect() {
    if (disposed || !started || reconnectTimer !== null) return;
    const exponent = Math.min(reconnectAttempts, reconnectExponentMax);
    const delay = Math.min(
      reconnectMaxDelayMs,
      reconnectBaseDelayMs * 2 ** exponent,
    );
    reconnectAttempts += 1;
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function handleOpen(candidate, generation, event) {
    if (!isCurrentConnection(candidate, generation)) return;
    const wasReconnecting = reconnectAttempts > 0;
    clearReconnectTimer();
    reconnectAttempts = 0;
    onOpen?.(event);
    if (wasReconnecting) onReconnect?.(event);
  }

  function handleMessage(candidate, generation, event) {
    if (!isCurrentConnection(candidate, generation)) return;
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      onParseError?.(error, event);
      return;
    }
    if (!isCurrentConnection(candidate, generation)) return;
    onMessage?.(payload, event);
  }

  function handleClose(candidate, generation, event) {
    if (!isCurrentConnection(candidate, generation)) return;
    socket = null;
    onClose?.(event);
    scheduleReconnect();
  }

  function connect() {
    if (disposed) return null;
    started = true;
    if (socket !== null || reconnectTimer !== null) return socket;
    if (typeof WebSocketClass !== 'function') {
      const error = new Error('WebSocket is not available');
      onError?.(error);
      scheduleReconnect();
      return null;
    }

    const generation = ++connectionGeneration;
    let candidate;
    try {
      candidate = new WebSocketClass(
        buildOverlaySocketUrl({ locationRef, token }),
      );
    } catch (error) {
      onError?.(error);
      scheduleReconnect();
      return null;
    }
    socket = candidate;
    candidate.addEventListener('open', (event) =>
      handleOpen(candidate, generation, event),
    );
    candidate.addEventListener('message', (event) =>
      handleMessage(candidate, generation, event),
    );
    candidate.addEventListener('error', (event) => {
      if (isCurrentConnection(candidate, generation)) onError?.(event);
    });
    candidate.addEventListener('close', (event) =>
      handleClose(candidate, generation, event),
    );
    return candidate;
  }

  function start() {
    if (disposed) return false;
    const wasStarted = started;
    started = true;
    connect();
    return !wasStarted;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    started = false;
    connectionGeneration += 1;
    clearReconnectTimer();
    const currentSocket = socket;
    socket = null;
    currentSocket?.close();
  }

  return { start, connect, dispose };
}
