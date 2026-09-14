'use strict';

import { getToastStack } from '../../shared/toast.js';
import { eventBus as defaultEventBus } from '../../shared/event-bus.js';

const APP_SHUTDOWN_EVENT = 'app:shutdown';
const COMPLETION_DURATION_MS = 2600;

/**
 * Creates the single in-place toast used for post-initialization artwork scans.
 * @param {Object} dependencies
 * @returns {{init: Function, handleState: Function, dispose: Function, getNode: Function}}
 */
export function createGiftCatalogUpdateToast(dependencies = {}) {
  const windowRef = dependencies.window || globalThis.window;
  const documentRef =
    dependencies.document || windowRef?.document || globalThis.document;
  const licenseBridge = dependencies.licenseBridge || windowRef?.liraLicense;
  const eventBus = dependencies.eventBus || defaultEventBus;
  const setTimeoutRef = dependencies.setTimeout || globalThis.setTimeout;
  const clearTimeoutRef = dependencies.clearTimeout || globalThis.clearTimeout;
  let initialized = false;
  let disposed = false;
  let stateEventSeen = false;
  let observedImageProgress = false;
  let lastCompletedAt = '';
  let latestState = null;
  let toastNode = null;
  let toastHandle = null;
  let unsubscribeBridge = () => {};
  let unsubscribeShutdown = () => {};

  function normalizeState(snapshot = {}) {
    const total = safeCount(snapshot.total);
    const completed = Math.min(safeCount(snapshot.completed), total);
    return {
      status: String(snapshot.status || ''),
      phase: String(snapshot.phase || ''),
      background: snapshot.background === true,
      total,
      completed,
      available: Math.min(safeCount(snapshot.available), completed),
      failed: Math.min(safeCount(snapshot.failed), completed),
      completedAt: String(snapshot.completedAt || '').trim(),
      error: String(snapshot.error || '').trim(),
    };
  }

  function handleState(snapshot) {
    if (disposed) return;
    const state = normalizeState(snapshot);
    if (isStaleProgress(state)) return;
    if (
      isTerminalState(state) &&
      state.completedAt &&
      state.completedAt === lastCompletedAt
    )
      return;
    latestState = state;

    // The first initialization uses the license page and is intentionally
    // excluded from this admin-only incremental update notification.
    if (state.status === 'running') return;
    if (state.status === 'updating' && state.phase === 'catalog') return;
    if (state.status === 'updating' && state.phase === 'images') {
      if (state.total > 0) {
        observedImageProgress = true;
        renderProgress(state);
      }
      return;
    }
    if (!isTerminalState(state) || state.total <= 0) return;
    if (!state.background && !observedImageProgress) return;
    if (state.completedAt) lastCompletedAt = state.completedAt;
    renderCompletion(state);
  }

  function isTerminalState(state) {
    return (
      (state.status === 'ready' && state.phase === 'complete') ||
      (state.status === 'error' && state.phase === 'error')
    );
  }

  function isStaleProgress(state) {
    return Boolean(
      latestState &&
      latestState.status === 'updating' &&
      latestState.phase === 'images' &&
      state.status === 'updating' &&
      state.phase === 'images' &&
      latestState.total === state.total &&
      state.completed < latestState.completed,
    );
  }

  function renderProgress(state) {
    renderToast(state, '正在更新礼物图片', formatProgress(state), 'info', 0);
  }

  function renderCompletion(state) {
    renderToast(state, state.error ? '礼物图片更新失败'
      : state.failed ? '部分图片暂未更新' : '礼物图片更新完成',
    state.error || state.failed ? '下次检查时重试' : formatProgress(state),
    state.error ? 'error' : state.failed ? 'warning' : 'success', COMPLETION_DURATION_MS);
  }

  function formatProgress(state) {
    const counts = `已处理 ${state.completed} / ${state.total}`;
    return state.failed
      ? `${counts} · 可用 ${state.available} · 失败 ${state.failed}`
      : `${counts} · 可用 ${state.available}`;
  }

  function renderToast(state, title, message, type, duration) {
    const container = documentRef?.getElementById?.('toast');
    if (!container) return;
    const stack = getToastStack({
      container, document: documentRef, window: windowRef,
      setTimeout: setTimeoutRef, clearTimeout: clearTimeoutRef,
    });
    toastHandle = stack.show({
      key: 'gift-catalog-update', update: true,
      title, message, type, duration, className: 'gift-catalog-update-toast',
    });
    toastNode = toastHandle.node;
    const progress = documentRef.createElement('progress');
    progress.max = state.total;
    progress.value = state.completed;
    progress.setAttribute('aria-label', '礼物图片更新进度');
    toastNode.children[0].append(progress);
    stack.refresh();
  }

  async function init() {
    if (initialized || disposed) return;
    initialized = true;
    if (typeof licenseBridge?.onGiftCatalogStateChanged === 'function') {
      unsubscribeBridge =
        licenseBridge.onGiftCatalogStateChanged((snapshot) => {
          stateEventSeen = true;
          handleState(snapshot);
        }) || (() => {});
    }
    if (typeof eventBus?.on === 'function')
      unsubscribeShutdown =
        eventBus.on(APP_SHUTDOWN_EVENT, dispose) || (() => {});
    windowRef?.addEventListener?.('pagehide', dispose, { once: true });

    if (typeof licenseBridge?.getGiftCatalogState !== 'function') return;
    try {
      const snapshot = await licenseBridge.getGiftCatalogState();
      if (!stateEventSeen) handleState(snapshot);
    } catch (_) {
      // The state bridge is best effort; a later state event can still start
      // the toast when the scan is available.
      return;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribeBridge();
    unsubscribeShutdown();
    windowRef?.removeEventListener?.('pagehide', dispose);
    toastHandle?.close(true);
    toastHandle = null;
    toastNode = null;
  }

  function getNode() {
    return toastNode?.isConnected ? toastNode : null;
  }

  return { init, handleState, dispose, getNode };
}

export function initGiftCatalogUpdateToast(dependencies = {}) {
  const controller = createGiftCatalogUpdateToast(dependencies);
  void controller.init();
  return controller;
}

function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
