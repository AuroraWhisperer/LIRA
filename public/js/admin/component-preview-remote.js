export function createRemotePreviewController(initial, send) {
  let state = initial;
  let pending = [];
  let chain = Promise.resolve();
  let stopped = false;
  const listeners = new Set();

  function getState() {
    const current = structuredClone(state);
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
    stopped = true;
    state = { ...getState(), loaded: false, saving: false, loading: false,
      error: message || '预览连接已结束，请从客户端重新打开。' };
    pending = [];
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
  let operation = Promise.resolve();
  let rejectOperation;
  const displayListeners = new Set();

  async function request(command, keepalive = false) {
    const response = await fetch('/api/component-preview', { method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...command, id }), keepalive });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || '预览连接失败，请从客户端重新打开。');
    return payload.data;
  }

  async function poll() {
    try {
      const update = await request({ action: 'read' });
      if (closed) return;
      controller.receive(update);
      display = update.display;
      for (const listener of displayListeners) listener(display);
      timer = window.setTimeout(poll, 250);
    } catch (error) {
      if (!closed) {
        controller.disconnect(error.message);
        rejectOperation?.(error);
      }
    }
  }

  async function run(action) {
    if (component !== 'canvas' || !['publish', 'source'].includes(action)) throw new Error('不支持的画布操作。');
    await controller.flush();
    const { sequence } = await request({ action });
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
    get controller() { return controller; },
    execute(action) {
      const next = operation.then(() => run(action));
      operation = next.catch(() => {});
      return next;
    },
    async start() {
      const initial = await request({ action: 'read' });
      if (closed) return;
      if (initial.component !== component) throw new Error('预览链接不匹配，请重新打开。');
      controller = createRemotePreviewController(initial.state, request);
      display = initial.display;
      timer = window.setTimeout(poll, 250);
    },
    startActualData(emit) {
      emit(display);
      displayListeners.add(emit);
      return () => displayListeners.delete(emit);
    },
    close() {
      if (closed) return;
      closed = true;
      window.clearTimeout(timer);
      controller?.disconnect();
      rejectOperation?.(new Error('预览连接已结束。'));
      displayListeners.clear();
      void request({ action: 'close' }, true).catch(() => {});
    },
  };
}
