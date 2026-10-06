import { createMediaDecoration } from './component-media.js';
import { createComponentResources } from './component-resources.js';

export function isComponentPreview() {
  return new URLSearchParams(location.search).get('componentPreview') === '1' && window.parent !== window;
}

export function isSceneComponent() {
  return isComponentPreview() && new URLSearchParams(location.search).get('sceneComponent') === '1';
}

export function createComponentPreviewClient({ onConfig, onData, onDispose }) {
  const decoration = createMediaDecoration();
  const resources = createComponentResources();
  const parentOrigin = new URL(location.href).origin;
  const sceneMode = isSceneComponent();
  let disposed = false;
  let configuration = 0;
  function send(type, values = {}) {
    if (!disposed) window.parent.postMessage({ type: `component-preview:${type}`, ...values }, sceneMode ? '*' : parentOrigin);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('message', receive);
    window.removeEventListener('pagehide', dispose);
    decoration.dispose();
    resources.dispose();
    onDispose?.();
  }
  async function receive(event) {
    if (disposed || event.source !== window.parent || (event.origin !== parentOrigin && !(sceneMode && event.origin === 'null'))) return;
    const message = event.data;
    if (['component-preview:init', 'component-preview:config'].includes(message?.type)) {
      const current = ++configuration;
      try {
        const resourceReady = resources.update(message.config);
        if (resourceReady) await resourceReady;
        if (disposed || current !== configuration) return;
        decoration.update(message.config);
        if (await onConfig(message.config, !sceneMode && message.editable === true) === false) throw new Error('Invalid config');
        await decoration.ready();
        if (disposed || current !== configuration) return;
        if (sceneMode) requestAnimationFrame(() => requestAnimationFrame(() => { if (current === configuration) send('prepared'); }));
      } catch {
        if (current === configuration) send('status', { message: message.config?.resourceStyle
          ? '套装素材加载失败，请重新导入套装并更换此组件的样式。' : '组件外观准备失败。' });
      }
    } else if (message?.type === 'component-preview:data') {
      onData?.(message.data, message.source);
    } else if (message?.type === 'component-preview:dispose') {
      dispose();
    }
  }
  window.addEventListener('message', receive);
  window.addEventListener('pagehide', dispose, { once: true });
  send('ready');
  return { edit: (change) => send('edit', { change }), resize: (size) => send('resize', { size }), dispose };
}
