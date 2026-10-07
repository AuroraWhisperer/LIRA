import { requestTextBoxMedia } from './text-box-media.js';
import { requestComponentStyles } from './component-style-api.js';

export function createRemotePreviewController(initial, send) {
  let state = initial;
  let pending = [];
  let chain = Promise.resolve();
  let stopped = false;
  let connectionError = '';
  const listeners = new Set();

  function getState() {
    const current = structuredClone(state);
    if (connectionError) current.error = connectionError;
    for (const command of pending) {
      if (command.action === 'edit') { Object.assign(current.draft, command.change); current.dirty = true; }
      if (command.action === 'discard') { current.draft = structuredClone(current.saved); current.dirty = false; }
      if (command.action === 'save') current.saving = true;
    }
    return current;
  }
  function notify() { for (const listener of listeners) listener(getState()); }
  function enqueue(action, change) {
    if (stopped || !state.loaded) return;
    const command = { action, ...(change ? { change: structuredClone(change) } : {}) };
    pending.push(command);
    notify();
    chain = chain.then(async () => {
      if (stopped) return;
      const result = await send(command);
      command.sequence = result.sequence;
    }).catch((error) => disconnect(error.message));
    return chain;
  }
  function disconnect(message) {
    if (stopped) return;
    stopped = true;
    state = { ...getState(), loaded: false, saving: false, loading: false,
      error: message || '预览连接已结束，请从客户端重新打开。' };
    pending = [];
    connectionError = '';
    notify();
  }
  async function flush() {
    await chain;
    await new Promise((resolve, reject) => {
      const check = () => {
        if (stopped || !state.loaded) { listeners.delete(check); reject(new Error(state.error || '预览连接已结束。')); }
        else if (!pending.length) { listeners.delete(check); resolve(); }
      };
      listeners.add(check);
      check();
    });
  }
  return {
    getState,
    flush,
    edit: (change) => enqueue('edit', change),
    save: () => enqueue('save'),
    discard: () => enqueue('discard'),
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    setConnectionError(message) {
      if (stopped || connectionError === message) return;
      connectionError = message;
      notify();
    },
    receive(update) {
      if (stopped) return;
      state = update.state;
      pending = pending.filter((command) => command.sequence === undefined || command.sequence > update.ack);
      notify();
    },
    disconnect,
  };
}

export function createBrowserPreviewConnection({ id, token, component }) {
  let closed = false;
  let timer = 0;
  let controller;
  let display;
  let draftKey;
  let attachmentId;
  let focusId;
  let focusListener;
  let operation = Promise.resolve();
  let rejectOperation;
  let commandId = 0;
  let commands = Promise.resolve();
  const requests = new AbortController();
  const displayListeners = new Set();

  async function requestOnce(command, keepalive = false) {
    const response = await fetch('/api/component-preview', { method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ attachmentId, ...command, id }), keepalive,
      signal: keepalive ? AbortSignal.timeout(5000) : AbortSignal.any([requests.signal, AbortSignal.timeout(5000)]) });
    let payload;
    try { payload = await response.json(); }
    catch (error) { if (!response.ok) error.status = response.status; throw error; }
    if (!response.ok || !payload.ok) throw Object.assign(new Error(payload.error || '预览连接失败，请从客户端重新打开。'),
      { status: response.ok ? 400 : response.status });
    return payload.data;
  }

  function stop(error) {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    controller?.disconnect(error.message);
    requests.abort(error);
    rejectOperation?.(error);
    focusListener = null;
    displayListeners.clear();
  }

  function wait(delay) {
    if (requests.signal.aborted) return Promise.reject(requests.signal.reason);
    return new Promise((resolve, reject) => {
      const cancel = () => { window.clearTimeout(retryTimer); reject(requests.signal.reason); };
      const retryTimer = window.setTimeout(() => {
        requests.signal.removeEventListener('abort', cancel);
        resolve();
      }, delay);
      requests.signal.addEventListener('abort', cancel, { once: true });
    });
  }

  async function request(command) {
    let delay = 1000;
    while (!closed) {
      try {
        const result = await requestOnce(command);
        if (closed) throw requests.signal.reason;
        controller?.setConnectionError('');
        return result;
      } catch (error) {
        if (closed) throw error;
        if (error.status && error.status !== 408 && error.status !== 429 && error.status < 500) {
          stop(error);
          throw error;
        }
        controller?.setConnectionError('连接暂时中断，正在自动重连；未保存修改仍保留在当前场景。');
        await wait(delay);
        delay = Math.min(delay * 2, 5000);
      }
    }
    throw requests.signal.reason;
  }

  function send(command) {
    // One unconfirmed mutation at a time lets the relay retain a bounded replay receipt.
    const next = commands.then(() => request({ ...command, commandId: ++commandId }));
    commands = next.catch(() => {});
    return next;
  }

  async function poll() {
    try {
      const update = await request({ action: 'read' });
      if (closed) return;
      draftKey = update.draftKey;
      controller.receive(update);
      display = update.display;
      for (const listener of displayListeners) listener(display);
      if (update.focus && update.focus.id !== focusId && focusListener) {
        focusListener(update.focus);
        focusId = update.focus.id;
        // Confirm immediately; background tabs may throttle the next polling timer.
        await request({ action: 'read', focusId });
      }
      timer = window.setTimeout(poll, 250);
    } catch (error) {
      if (!closed) {
        stop(error);
      }
    }
  }

  async function run(action, change) {
    if (component !== 'canvas' || !['publish', 'source', 'preset'].includes(action)) throw new Error('不支持的场景操作。');
    await controller.flush();
    const { sequence } = await send({ action, ...(change ? { change } : {}) });
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        displayListeners.delete(receive);
        rejectOperation = null;
        if (error) reject(error); else resolve(result);
      };
      const receive = (data) => {
        if (data?.sequence !== sequence || data.busy) return;
        finish(data.error ? new Error(data.error) : null, data.result);
      };
      rejectOperation = (error) => finish(error);
      if (closed || !controller.getState().loaded) { finish(new Error('预览连接已结束。')); return; }
      displayListeners.add(receive);
      receive(display);
    });
  }

  return {
    component,
    requestTextBoxMedia(kind, options) {
      if (closed || component !== 'canvas') return Promise.reject(new Error('预览连接已结束，请从客户端重新打开。'));
      return requestTextBoxMedia(kind, options, { id, token, attachmentId });
    },
    requestComponentStyles(action, options) {
      if (closed || component !== 'canvas') return Promise.reject(new Error('预览连接已结束，请从客户端重新打开。'));
      return requestComponentStyles(action, options, { id, token, attachmentId });
    },
    get draftKey() { return draftKey; },
    get controller() { return controller; },
    onFocus(listener) { focusListener = listener; },
    execute(action, change) {
      const next = operation.then(() => run(action, change));
      operation = next.catch(() => {});
      return next;
    },
    async start() {
      let initial = await request({ action: 'read' });
      if (closed) return;
      if (initial.component !== component) throw new Error('预览链接不匹配，请重新打开。');
      initial = await request({ action: 'attach', attachmentId: crypto.randomUUID(),
        previousAttachmentId: initial.attachmentId });
      attachmentId = initial.attachmentId;
      // Finish accepted commands before restoring the refreshed page's local draft.
      while (initial.ack < initial.sequence || initial.state.saving || initial.display?.busy) {
        await wait(200);
        initial = await request({ action: 'read' });
      }
      draftKey = initial.draftKey;
      controller = createRemotePreviewController(initial.state, send);
      display = initial.display;
      timer = window.setTimeout(poll, 250);
    },
    startActualData(emit) {
      emit(display);
      displayListeners.add(emit);
      return () => displayListeners.delete(emit);
    },
    detach() { stop(new Error('预览页面已离开。')); },
    close() {
      if (closed) return;
      stop(new Error('预览连接已结束。'));
      void requestOnce({ action: 'close' }, true).catch(() => {});
    },
  };
}
