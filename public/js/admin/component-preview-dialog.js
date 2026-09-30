import { api, localOverlayOrigin, toast } from '../shared/utils.js';
import { closeComponentPreview, setActiveComponentPreview, releaseComponentPreview } from './component-preview-session.js';
import { prepareComponentPreviews } from './component-preview-registry.js';

export function openComponentPreview(selected = null) {
  closeComponentPreview();
  let closed = false;
  const connections = [];
  const post = (body) => api('/api/component-preview', body, { notifyError: false });
  function stopConnection(connection) {
    if (connection.stopped) return;
    connection.stopped = true;
    window.clearTimeout(connection.timer);
    connection.stopData?.();
    if (connection.session) void post({ action: 'revoke', id: connection.session.id }).catch(() => {});
    if (connection.opened) connection.options.onClose?.();
  }
  function close() {
    if (closed) return;
    closed = true;
    for (const connection of connections) stopConnection(connection);
    window.removeEventListener('pagehide', close);
    releaseComponentPreview(handle);
  }
  const handle = { id: selected?.id || 'canvas', close, focus() {} };
  setActiveComponentPreview(handle);
  window.addEventListener('pagehide', close, { once: true });

  async function exchange(connection) {
    const { controller } = connection.options;
    if (closed || connection.stopped) return;
    if (controller.getState().generation !== connection.generation) { close(); return; }
    try {
      const { data } = await post({ action: 'exchange', id: connection.session.id,
        ack: connection.ack, state: controller.getState(), display: connection.display });
      if (closed || controller.getState().generation !== connection.generation) { close(); return; }
      for (const command of data.commands) {
        if (command.sequence <= connection.ack) continue;
        if (command.action === 'edit') controller.edit(command.change);
        else if (command.action === 'discard') controller.discard();
        else if (command.action === 'save') void controller.save();
        else if (connection.options.id === 'canvas' && ['publish', 'source'].includes(command.action)) {
          connection.display = { sequence: command.sequence, busy: true };
          void (async () => {
            try {
              const action = connection.options[command.action];
              if (!action) throw new Error('请从客户端重新打开直播画布。');
              const result = await action();
              connection.display = { sequence: command.sequence, busy: false, result };
            } catch (error) {
              connection.display = { sequence: command.sequence, busy: false, error: error.message };
            }
          })();
        }
        connection.ack = command.sequence;
      }
      if (data.closed) {
        stopConnection(connection);
        if (connections.every((item) => item.stopped)) close();
        return;
      }
      connection.timer = window.setTimeout(() => exchange(connection), 200);
    } catch (error) {
      close();
      if (error.status !== 410) toast(error.message || '预览连接失败，请重新打开。');
    }
  }

  void (async () => {
    try {
      const available = await prepareComponentPreviews();
      if (closed) return;
      const previews = selected ? [selected, ...available.filter(({ id }) => id !== selected.id)] : available;
      if (!previews.length) throw new Error('组件尚未就绪，请重新打开直播画布。');
      for (const options of previews) {
        const connection = { options, generation: options.controller.getState().generation,
          ack: 0, display: null, timer: 0, opened: false };
        connections.push(connection);
        connection.stopData = options.startActualData?.((data) => { connection.display = data; });
        const response = await post({ action: 'open', component: options.id,
          state: options.controller.getState(), display: connection.display });
        connection.session = response.data;
        if (closed || options.controller.getState().generation !== connection.generation) {
          void post({ action: 'revoke', id: connection.session.id }).catch(() => {});
          close();
          return;
        }
        connection.opened = true;
        options.onOpen?.();
        void exchange(connection);
      }
      const url = new URL('/component-preview', localOverlayOrigin());
      if (selected) url.searchParams.set('component', selected.id);
      const params = new URLSearchParams(selected ? connections[0].session : undefined);
      const canvas = connections.find(({ options }) => options.id === 'canvas');
      if (canvas) params.set('canvas', JSON.stringify(canvas.session));
      const others = connections.slice(selected ? 1 : 0).filter(({ options }) => options.id !== 'canvas');
      if (others.length) params.set('components', JSON.stringify(others
        .map(({ options, session }) => ({ component: options.id, ...session }))));
      url.hash = params.toString();
      // Every fragment capability stays scoped to its original controller.
      // Electron's external-navigation policy opens the system browser.
      handle.focus = () => window.open(url.href, '_blank', 'noopener,noreferrer');
      if (!closed) handle.focus();
    } catch (error) {
      close();
      toast(error.message || '无法打开网页预览。');
    }
  })();
  return handle;
}
