import { api, localOverlayOrigin, toast } from '../shared/utils.js';
import { getActiveComponentPreview, closeComponentPreview, setActiveComponentPreview, releaseComponentPreview } from './component-preview-session.js';
import { prepareComponentPreviews } from './component-preview-registry.js';
import { SCENE_COMPONENTS } from '../shared/scene-components.js';

const sceneOnly = (component) => SCENE_COMPONENTS[component?.id]?.independentOnly === true;

export function openComponentPreview(selected = null) {
  const active = getActiveComponentPreview('browser-preview');
  if (active?.canReuse(selected)) { void active.focus(selected); return active; }
  closeComponentPreview();
  let closed = false;
  let ready = false;
  let focusGeneration = 0;
  let linking = Promise.resolve();
  const connections = [];
  const previewData = {};
  if (selected?.previewData) previewData[selected.id] = selected.previewData;
  const displayOf = (connection) => connection.options.id === 'canvas'
    ? { ...connection.display, previewData: { ...connection.previewData, ...previewData } } : connection.display;
  const requests = new AbortController();
  const post = (body) => api('/api/component-preview', body, { notifyError: false,
    signal: AbortSignal.any([requests.signal, AbortSignal.timeout(5000)]) });
  function stopConnection(connection) {
    if (connection.stopped) return;
    connection.stopped = true;
    window.clearTimeout(connection.timer);
    connection.stopData?.();
    if (connection.session) void api('/api/component-preview', { action: 'revoke', id: connection.session.id },
      { notifyError: false, signal: AbortSignal.timeout(5000) }).catch(() => {});
    if (connection.opened) connection.options.onClose?.();
  }
  function close() {
    if (closed) return;
    closed = true;
    requests.abort();
    for (const connection of connections) stopConnection(connection);
    window.removeEventListener('pagehide', close);
    releaseComponentPreview(handle);
  }
  async function syncCanvas() {
    const canvas = connections.find(({ options }) => options.id === 'canvas');
    if (!ready || !canvas) return;
    await canvas.exchanging;
    if (closed || !await exchange(canvas)) throw new Error('画布同步失败，请稍后重新打开预览。');
  }
  async function focus(next = selected) {
    selected = next;
    if (next?.previewData) previewData[next.id] = next.previewData;
    if (!ready || closed) return;
    const requested = ++focusGeneration;
    try {
      const selectedId = next?.id || null;
      const selectedItemId = next?.selectedItemId;
      let selectedSize = null;
      const canvas = connections.find(({ options }) => options.id === 'canvas');
      if (next && selectedItemId === undefined && !sceneOnly(next) && canvas?.options.getComponentSize && !canvas.options.controller.getState().draft.document.items
        .some((item) => item.type === next.id && item.appearance.mode === 'shared')) {
        selectedSize = await canvas.options.getComponentSize(next.id,
          AbortSignal.any([requests.signal, AbortSignal.timeout(5000)]));
      }
      if (closed || requested !== focusGeneration) return;
      if (selectedItemId !== undefined && canvas) {
        // A reused session may still contain the document from before this item was added.
        await syncCanvas();
        if (closed || requested !== focusGeneration) return;
      }
      // One canvas link remembers the latest selection. Serialize updates so a slow
      // earlier click cannot overwrite a newer choice on the shared link.
      linking = linking.catch(() => {}).then(async () => {
        if (closed || requested !== focusGeneration) return null;
        const { data } = await post({ action: 'link', links: connections.map(({ session }) => session),
          selectedId, selectedSize, ...(selectedItemId === undefined ? {} : { selectedItemId }) });
        return data.key;
      });
      const key = await linking;
      if (closed || requested !== focusGeneration) return;
      const url = new URL('/c', localOverlayOrigin());
      url.hash = key;
      const { data } = await post({ action: 'focus', key: url.hash.slice(1) });
      if (!closed && requested === focusGeneration && !data.focused) window.open(url.href, '_blank', 'noopener,noreferrer');
    } catch (error) {
      if (!closed && requested === focusGeneration) toast(error.message || '无法打开网页预览。');
    }
  }
  const handle = { id: 'browser-preview', close, focus, syncCanvas,
    canReuse(next) {
      return !closed && connections.every(({ options, generation, stopped }) =>
        !stopped && options.controller.getState().generation === generation)
        && (!next || sceneOnly(next) && connections.some(({ options }) => options.id === 'canvas')
          || connections.some(({ options }) => options.id === next.id && options.controller === next.controller)
          || (!connections.length && selected?.id === next.id && selected.controller === next.controller));
    } };
  setActiveComponentPreview(handle);
  window.addEventListener('pagehide', close, { once: true });

  function exchange(connection) {
    if (connection.exchanging) return connection.exchanging;
    window.clearTimeout(connection.timer);
    connection.exchanging = exchangeOnce(connection).finally(() => {
      connection.exchanging = null;
      if (connection.resync) { connection.resync = false; return syncResult(connection); }
    });
    return connection.exchanging;
  }

  function syncResult(connection) {
    if (closed || connection.stopped) return;
    if (connection.exchanging) connection.resync = true;
    else return exchange(connection);
  }

  async function exchangeOnce(connection) {
    const { controller } = connection.options;
    if (closed || connection.stopped) return;
    if (controller.getState().generation !== connection.generation) { close(); return; }
    let received = false;
    try {
      const { data } = await post({ action: 'exchange', id: connection.session.id,
        ack: connection.ack, state: controller.getState(), display: displayOf(connection) });
      if (closed || controller.getState().generation !== connection.generation) { close(); return; }
      received = true;
      connection.retryDelay = 1000;
      for (const command of data.commands) {
        if (command.sequence <= connection.ack) continue;
        if (command.action === 'edit') {
          let change = command.change;
          const current = controller.getState().draft.document;
          if (command.baseItemIds && current?.id === change.document?.id) {
            const known = new Set([...command.baseItemIds, ...change.document.items.map(item => item.id)]);
            change = { ...change, document: { ...change.document,
              items: [...change.document.items, ...current.items.filter(item => !known.has(item.id))] } };
          }
          controller.edit(change);
        }
        else if (command.action === 'discard') controller.discard();
        else if (command.action === 'save') void controller.save().finally(() => syncResult(connection));
        else if (connection.options.id === 'canvas' && ['publish', 'source', 'preset'].includes(command.action)) {
          connection.display = { sequence: command.sequence, busy: true };
          void (async () => {
            try {
              const action = connection.options[command.action];
              if (!action) throw new Error('请从客户端重新打开场景编辑器。');
              const result = await action(command.change);
              connection.display = { sequence: command.sequence, busy: false, result };
            } catch (error) {
              connection.display = { sequence: command.sequence, busy: false, error: error.message };
            }
            syncResult(connection);
          })();
        }
        connection.ack = command.sequence;
      }
      // Return accepted edits immediately instead of waiting for another polling tick.
      if (data.commands.length) connection.resync = true;
      if (data.closed) {
        stopConnection(connection);
        if (connections.every((item) => item.stopped)) close();
        return;
      }
      connection.timer = window.setTimeout(() => exchange(connection), 200);
      return true;
    } catch (error) {
      if (closed || connection.stopped) return;
      if (!received && (!error.status || error.status === 408 || error.status === 429 || error.status >= 500)) {
        connection.timer = window.setTimeout(() => exchange(connection), connection.retryDelay);
        connection.retryDelay = Math.min(connection.retryDelay * 2, 5000);
        return;
      }
      close();
      if (error.status !== 410) toast(error.message || '预览连接失败，请重新打开。');
    }
  }

  void (async () => {
    try {
      const available = await prepareComponentPreviews();
      if (closed) return;
      const previews = selected && !sceneOnly(selected) ? [selected, ...available.filter(({ id }) => id !== selected.id)] : available;
      if (!previews.length) throw new Error('组件尚未就绪，请重新打开场景编辑器。');
      await Promise.all(previews.map(async (options) => {
        const connection = { options, generation: options.controller.getState().generation,
          ack: 0, display: null, timer: 0, retryDelay: 1000, opened: false };
        connections.push(connection);
        connection.stopData = options.startActualData?.((data) => {
          if (options.id === 'canvas') connection.previewData = data.previewData;
          else connection.display = data;
        });
        const response = await post({ action: 'open', component: options.id,
          state: options.controller.getState(), display: displayOf(connection) });
        connection.session = response.data;
        if (closed || options.controller.getState().generation !== connection.generation) {
          void post({ action: 'revoke', id: connection.session.id }).catch(() => {});
          close();
          return;
        }
        connection.opened = true;
        options.onOpen?.();
        void exchange(connection);
      }));
      ready = true;
      if (!closed) await focus();
    } catch (error) {
      close();
      toast(error.message || '无法打开网页预览。');
    }
  })();
  return handle;
}
