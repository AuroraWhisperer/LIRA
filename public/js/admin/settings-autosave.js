export function createAutosave({ save, canSave = () => true, root, windowRef = globalThis }) {
  let timer = null, pending = null, wanted = false, composing = false, disposed = false, generation = 0;
  const clear = () => { windowRef.clearTimeout(timer); timer = null; };
  function resume() {
    if (disposed || composing || pending || !wanted || timer !== null) return;
    timer = windowRef.setTimeout(() => { timer = null; void flush(); }, 600);
  }
  function schedule() { wanted = true; clear(); resume(); }
  async function flush() {
    clear();
    if (disposed || composing || !wanted) return false;
    if (pending) { await pending.catch(() => false); return flush(); }
    if (!canSave()) return false;
    wanted = false;
    const requested = generation;
    try { pending = Promise.resolve(save()); return await pending; }
    catch { return false; }
    finally {
      if (generation === requested) { pending = null; resume(); }
    }
  }
  function cancel() { generation++; clear(); wanted = false; pending = null; }
  const begin = () => { composing = true; clear(); };
  const end = () => { composing = false; if (wanted) { clear(); resume(); } };
  root?.addEventListener('compositionstart', begin);
  root?.addEventListener('compositionend', end);
  function dispose() {
    disposed = true;
    cancel();
    root?.removeEventListener('compositionstart', begin);
    root?.removeEventListener('compositionend', end);
    windowRef.removeEventListener?.('pagehide', dispose);
  }
  windowRef.addEventListener?.('pagehide', dispose, { once: true });
  return { schedule, resume, flush, cancel, dispose };
}

export function validAutosaveFields(root) {
  return ![...(root?.querySelectorAll('input, select, textarea') || [])].some(field =>
    !field.disabled && field.willValidate !== false && !field.hasAttribute?.('data-preview-parameter')
      && (field.checkValidity?.() === false
        || (field.type === 'number' && !field.value && field.dataset?.autosaveOptional !== 'true')));
}

export function bindComponentAutosave(controller, { root, saveButton, discardButton, status, actions, windowRef } = {}) {
  let signature, generation, dirty = false, retryError = '';
  const autosave = createAutosave({ root, windowRef,
    canSave: () => {
      const state = controller.getStatus();
      return state.loaded && !state.loading && !state.saving && state.dirty && !state.conflict
        && validAutosaveFields(root);
    },
    save: () => controller.save(),
  });
  const stop = controller.subscribe(state => {
    const next = JSON.stringify(state.draft);
    if (generation !== state.generation) { autosave.cancel(); signature = undefined; retryError = ''; }
    if (!state.dirty || controller.getEditSource?.() === 'preview') autosave.cancel();
    else if (!dirty || next !== signature) autosave.schedule();
    else if (!state.saving && !state.loading && !state.error && !state.conflict) autosave.resume();
    signature = next;
    generation = state.generation;
    dirty = state.dirty;
    if (state.error || state.conflict) retryError = state.error || '请核对其他入口的修改。';
    else if (!state.dirty) retryError = '';
    const failed = Boolean(retryError);
    if (saveButton) {
      saveButton.hidden = !failed;
      saveButton.textContent = state.conflict ? '保存本机修改' : '重试保存';
    }
    if (discardButton) discardButton.hidden = !failed;
    if (actions) actions.hidden = !failed && state.loaded;
    if (status) {
      if (failed) status.textContent = `自动保存未完成，修改已保留。${retryError}`;
      else if (state.loaded) status.textContent = '';
      status.hidden = !status.textContent;
    }
  });
  return { ...autosave, dispose() { stop(); autosave.dispose(); } };
}
