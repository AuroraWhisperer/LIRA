// One idle request per window leaves HTTP/1 connections available for edits and component assets.
export function createPreviewPollBatch({ send }) {
  const pending = new Map();
  let current;
  let scheduled = false;
  let disposed = false;

  function settle(task, error, value) {
    if (pending.get(task.entry.id) !== task) return;
    pending.delete(task.entry.id);
    task.signal?.removeEventListener('abort', task.cancel);
    if (error) task.reject(error); else task.resolve(value);
  }

  async function flush() {
    scheduled = false;
    if (disposed || !pending.size) return;
    const tasks = [...pending.values()];
    const batch = { controller: new AbortController() };
    current = batch;
    try {
      const data = await send({ action: `${tasks[0].entry.action}-batch`,
        entries: tasks.map(({ entry }) => {
          const { waitMs, ...values } = entry;
          return values;
        }), waitMs: 20000 }, batch.controller.signal);
      if (current !== batch) return;
      if (!Array.isArray(data?.updates)) throw new Error('预览响应无效，请稍后重试。');
      const updates = new Map(data.updates.map(({ id, ...update }) => [id, update]));
      if (tasks.some(task => !updates.has(task.entry.id))) throw new Error('预览响应缺少组件状态，请稍后重试。');
      current = null;
      for (const task of tasks) settle(task, null, { ...updates.get(task.entry.id), waitMs: data.waitMs });
    } catch (error) {
      if (current !== batch) return;
      current = null;
      for (const task of tasks) settle(task, error);
    }
  }

  function regroup() {
    if (current) {
      const previous = current;
      current = null;
      previous.controller.abort();
    }
    if (scheduled || disposed || !pending.size) return;
    scheduled = true;
    queueMicrotask(flush);
  }

  return {
    request(entry, { signal } = {}) {
      if (disposed) return Promise.reject(new Error('预览连接已结束。'));
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise((resolve, reject) => {
        const task = { entry, signal, resolve, reject, cancel() {
          settle(task, signal.reason);
          regroup();
        } };
        pending.set(entry.id, task);
        signal?.addEventListener('abort', task.cancel, { once: true });
        regroup();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const error = new Error('预览连接已结束。');
      for (const task of pending.values()) settle(task, error);
      regroup();
    },
  };
}
