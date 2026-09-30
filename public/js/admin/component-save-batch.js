function failureMessage(failure) {
  return failure?.message || String(failure || '保存失败，请重试。');
}

export function createComponentSaveBatch(entries) {
  const state = Object.fromEntries(entries.map(({ id }) => [id, { status: 'idle', error: '' }]));
  const listeners = new Set();
  const generations = new Map(entries.map(({ id, controller }) => [id, controller.getState().generation]));
  const cancellations = new Map();
  let pending = null;
  let disposed = false;
  const subscriptions = entries.map(({ id, controller }) => controller.subscribe(({ generation }) => {
    if (generation === generations.get(id)) return;
    generations.set(id, generation);
    state[id] = { status: 'idle', error: '' };
    cancellations.get(id)?.();
    notify();
  }));

  function getState() {
    return Object.fromEntries(Object.entries(state).map(([id, result]) => [id, { ...result }]));
  }

  function notify() {
    for (const listener of listeners) listener(getState());
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  function isCurrent({ controller, generation }) {
    return !disposed && controller.getState().generation === generation;
  }

  function save(ids) {
    if (disposed) return Promise.resolve(getState());
    if (pending) return pending;
    let finish;
    const result = new Promise((resolve) => { finish = resolve; });
    pending = result;
    const targets = [];
    const submitting = (async () => {
      for (const entry of entries) {
        if (ids && !ids.includes(entry.id)) continue;
        let prepared;
        let error = '';
        let generation = generations.get(entry.id);
        try {
          const current = entry.controller.getState();
          if (!ids && !current.dirty) continue;
          generation = current.generation;
          prepared = entry.controller.prepareSave();
          if (!prepared.valid) error = prepared.error || '配置尚不可保存。';
          if (prepared.valid && prepared.changed && entry.validate) {
            const validation = entry.validate(current.draft);
            if (typeof validation === 'string') error = validation;
          }
        } catch (failure) {
          error = failureMessage(failure);
        }
        targets.push({ id: entry.id, controller: entry.controller, prepared, error, generation });
      }

      const invalid = targets.some((target) => target.error || !isCurrent(target));
      for (const target of targets) {
        if (!isCurrent(target)) continue;
        state[target.id] = {
          status: target.error ? 'failed' : invalid ? 'not-submitted' : target.prepared.changed ? 'saving' : 'skipped',
          error: target.error,
        };
      }
      notify();
      if (invalid) return;

      await Promise.allSettled(targets.map(async (target) => {
        const { id, controller, prepared } = target;
        if (!prepared.changed || !isCurrent(target)) return;
        let cancel;
        const invalidated = new Promise((resolve) => { cancel = () => resolve(false); });
        cancellations.set(id, cancel);
        try {
          const saved = await Promise.race([prepared.commit(), invalidated]);
          if (!isCurrent(target)) return;
          state[id] = saved
            ? { status: 'success', error: '' }
            : { status: 'failed', error: controller.getState().error || '保存未完成，请重试。' };
        } catch (failure) {
          if (!isCurrent(target)) return;
          state[id] = { status: 'failed', error: failureMessage(failure) };
        } finally {
          if (cancellations.get(id) === cancel) cancellations.delete(id);
        }
        notify();
      }));
    })();

    function complete() {
      pending = null;
      finish(getState());
    }

    void submitting.then(complete, (failure) => {
      for (const target of targets) {
        if (isCurrent(target) && state[target.id].status === 'saving') {
          state[target.id] = { status: 'failed', error: failureMessage(failure) };
        }
      }
      complete();
    });
    return result;
  }

  function retryFailed() {
    return pending || save(entries.filter(({ id }) => state[id].status === 'failed').map(({ id }) => id));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of subscriptions) unsubscribe();
    for (const cancel of cancellations.values()) cancel();
    cancellations.clear();
    listeners.clear();
  }

  return { getState, subscribe, save, retryFailed, dispose };
}
