export function isComponentPreview() {
  return new URLSearchParams(location.search).get('componentPreview') === '1' && window.parent !== window;
}

export function isSceneComponent() {
  return isComponentPreview() && new URLSearchParams(location.search).get('sceneComponent') === '1';
}

export function createComponentPreviewClient({ onConfig, onData, onDispose }) {
  const parentOrigin = new URL(location.href).origin;
  const sceneMode = isSceneComponent();
  let disposed = false;
  function send(type, values = {}) {
    if (!disposed) window.parent.postMessage({ type: `component-preview:${type}`, ...values }, sceneMode ? '*' : parentOrigin);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('message', receive);
    window.removeEventListener('pagehide', dispose);
    onDispose?.();
  }
  function receive(event) {
    if (disposed || event.source !== window.parent || (event.origin !== parentOrigin && !(sceneMode && event.origin === 'null'))) return;
    const message = event.data;
    if (['component-preview:init', 'component-preview:config'].includes(message?.type)) {
      try {
        if (onConfig(message.config, !sceneMode && message.editable === true) === false) throw new Error('Invalid config');
        if (sceneMode) requestAnimationFrame(() => requestAnimationFrame(() => send('prepared')));
      } catch {
        send('status', { message: '组件外观准备失败。' });
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
