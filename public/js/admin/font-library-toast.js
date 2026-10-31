import { getToastStack } from '../shared/toast.js';
import { eventBus as defaultEventBus } from '../shared/event-bus.js';

export function createFontLibraryToast({ window: windowRef = globalThis.window,
  document: documentRef = globalThis.document, bridge = windowRef?.liraLicense,
  eventBus = defaultEventBus, onState = () => {} } = {}) {
  let handle = null;
  let disposed = false;
  let initialized = false;
  let eventSeen = false;
  let lastCompletedAt = '';
  let unsubscribe = () => {};
  let unsubscribeShutdown = () => {};

  function handleState(state = {}) {
    if (disposed) return;
    onState(state);
    if (!['downloading', 'ready', 'error'].includes(state.status)) return;
    const done = state.status !== 'downloading';
    if (done && state.completedAt && lastCompletedAt === state.completedAt) return;
    if (state.status === 'ready' && !state.total && !handle) return;
    const container = documentRef.getElementById('toast');
    if (!container) return;
    if (done) {
      lastCompletedAt = state.completedAt || String(Date.now());
    }
    const failed = state.status === 'error';
    const stack = getToastStack({ container, document: documentRef, window: windowRef });
    handle = stack.show({ key: 'font-library-update', update: true,
      title: failed ? '部分字体暂未下载' : done ? '字体更新完成' : '正在下载字体',
      message: failed ? '已下载的字体仍可使用，可重试或下次启动时继续。'
        : `已完成 ${state.completed || 0} / ${state.total || 0}${state.currentFont ? ` · ${state.currentFont}` : ''}`,
      type: failed ? 'warning' : done ? 'success' : 'info',
      duration: done ? 5000 : 0,
      className: 'font-library-update-toast',
      ...(failed && bridge?.retryFontLibrary ? { actionLabel: '重试', onClick: async () => {
        try { await bridge.retryFontLibrary(); } catch {
          handleState({ status: 'error', total: state.total, completed: state.completed, failed: state.failed });
        }
      } } : {}),
    });
    if (!done) {
      const progress = documentRef.createElement('progress');
      progress.max = state.total || 1;
      progress.value = state.completed || 0;
      progress.setAttribute('aria-label', '字体下载进度');
      handle.node.children[0].append(progress);
      stack.refresh();
    }
  }

  async function init() {
    if (initialized || disposed) return;
    initialized = true;
    unsubscribe = bridge?.onFontLibraryStateChanged?.(state => { eventSeen = true; handleState(state); }) || (() => {});
    unsubscribeShutdown = eventBus.on('app:shutdown', dispose) || (() => {});
    windowRef.addEventListener('pagehide', dispose, { once: true });
    try {
      const state = await bridge?.getFontLibraryState?.();
      if (!eventSeen) handleState(state);
    } catch { return; }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    unsubscribeShutdown();
    windowRef.removeEventListener('pagehide', dispose);
    handle?.close(true);
  }

  return { init, handleState, dispose };
}
