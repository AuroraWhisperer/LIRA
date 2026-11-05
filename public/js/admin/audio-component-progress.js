import { getToastStack } from '../shared/toast.js';
import { eventBus as defaultEventBus } from '../shared/event-bus.js';
import { formatBytes } from '../shared/display-format.js';

export function createAudioComponentProgress({ window: windowRef = globalThis.window,
  document: documentRef = globalThis.document, bridge = windowRef?.audioAssistant,
  eventBus = defaultEventBus, onState = () => {} } = {}) {
  let handle;
  let disposed = false;
  let initialized = false;
  let eventSeen = false;
  let unsubscribe = () => {};
  let unsubscribeShutdown = () => {};

  function handleState(state = {}) {
    if (disposed) return;
    onState(state);
    if (!['downloading', 'installing', 'error', 'ready'].includes(state.status)) return;
    if (state.status === 'ready' && !handle) return;
    const container = documentRef.getElementById('toast');
    if (!container) return;
    const titles = { downloading: '正在准备音频组件', installing: '正在安装音频组件',
      error: '音频组件暂未就绪', ready: '音频组件已就绪' };
    handle = getToastStack({ container, document: documentRef, window: windowRef }).show({
      key: 'audio-component', update: true, title: titles[state.status],
      message: state.status === 'error' ? state.error : state.status === 'ready' ? '现在可以使用电音助手和原生声卡输出。'
        : state.status === 'installing' ? '下载完成，正在校验并安装。'
        : `${formatBytes(state.downloadedBytes || 0)} / ${formatBytes(state.totalBytes || 0)}，完成后可直接使用。`,
      type: state.status === 'error' ? 'warning' : state.status === 'ready' ? 'success' : 'info',
      duration: state.status === 'ready' ? 5000 : 0,
      ...(state.status === 'error' ? { actionLabel: '重试', onClick: () => bridge.retryComponent() } : {}),
    });
  }

  async function init() {
    if (initialized || disposed) return;
    initialized = true;
    unsubscribe = bridge?.onComponentState?.(state => { eventSeen = true; handleState(state); }) || (() => {});
    unsubscribeShutdown = eventBus.on('app:shutdown', dispose) || (() => {});
    windowRef.addEventListener('pagehide', dispose, { once: true });
    try { const state = await bridge?.getComponentState?.(); if (!eventSeen) handleState(state); }
    catch { return; }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    unsubscribeShutdown();
    windowRef.removeEventListener('pagehide', dispose);
    handle?.close(true);
  }

  return { init, dispose };
}
