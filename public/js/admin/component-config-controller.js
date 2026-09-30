const clone = (value) => JSON.parse(JSON.stringify(value));

function equal(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

export function createComponentConfigController({ initial = {}, read, persist, validate }) {
  let saved = clone(initial);
  let draft = clone(initial);
  let loaded = !read;
  let loading = false;
  let saving = false;
  let error = '';
  let conflict = false;
  let applied = false;
  let generation = 0;
  let authorityRevision = 0;
  let editRevision = 0;
  let fieldRevisions = {};
  let submission = null;
  let pendingSave = null;
  const listeners = new Set();

  function changes() {
    return Object.fromEntries(Object.entries(draft).filter(([key, value]) => !equal(value, saved[key])));
  }

  function getState() {
    return { saved: clone(saved), draft: clone(draft), dirty: Object.keys(changes()).length > 0,
      loaded, loading, saving, error, conflict, applied, generation };
  }

  function notify() {
    for (const listener of listeners) listener(getState());
  }

  function edit(change) {
    for (const [key, value] of Object.entries(change)) {
      if (equal(draft[key], value)) continue;
      draft[key] = clone(value);
      fieldRevisions[key] = ++editRevision;
    }
    error = '';
    notify();
  }

  function receive(next) {
    for (const key of new Set([...Object.keys(saved), ...Object.keys(next)])) {
      const edited = !equal(draft[key], saved[key]);
      if (!edited) {
        if (Object.hasOwn(next, key)) draft[key] = clone(next[key]);
        else delete draft[key];
      } else if (!equal(saved[key], next[key]) && !equal(draft[key], next[key])
        && !(submission && equal(submission[key], next[key]))) {
        conflict = true;
      }
    }
    saved = clone(next);
    loaded = true;
    authorityRevision += 1;
    if (!Object.keys(changes()).length) conflict = false;
    notify();
  }

  async function reload() {
    if (!read || loading || saving) return false;
    const requestedGeneration = generation;
    const requestedAuthority = authorityRevision;
    loading = true;
    error = '';
    notify();
    try {
      const next = await read();
      if (requestedGeneration !== generation || requestedAuthority !== authorityRevision) return false;
      receive(next);
      return true;
    } catch (failure) {
      if (requestedGeneration === generation && requestedAuthority === authorityRevision) {
        error = failure.message || '读取失败，请重试。';
      }
      return false;
    } finally {
      if (requestedGeneration === generation) {
        loading = false;
        notify();
      }
    }
  }

  function prepareSave() {
    const submitted = clone(draft);
    const changed = clone(changes());
    const submittedRevisions = { ...fieldRevisions };
    const submittedGeneration = generation;
    const hasChanges = Object.keys(changed).length > 0;
    const skippedCommit = () => Promise.resolve(false);
    let validationError = !loaded ? '尚未读取配置。' : saving ? '正在保存，请稍后重试。' : '';
    if (!validationError && hasChanges && validate) {
      try {
        const result = validate(clone(submitted));
        if (typeof result === 'string') validationError = result;
      } catch (failure) {
        validationError = failure?.message || String(failure || '配置校验失败。');
      }
    }
    if (validationError) return { valid: false, changed: hasChanges, error: validationError, commit: skippedCommit };
    if (!hasChanges) return { valid: true, changed: false, error: '', commit: skippedCommit };

    let committed = null;
    function commit() {
      if (committed) return committed;
      if (submittedGeneration !== generation || saving || !loaded) return skippedCommit();
      let finish;
      committed = new Promise((resolve) => { finish = resolve; });
      pendingSave = committed;
      submission = submitted;
      saving = true;
      error = '';
      authorityRevision += 1;
      const writing = (async () => {
        try {
          notify();
          if (submittedGeneration !== generation) return false;
          const next = await persist(clone(submitted), clone(changed));
          if (submittedGeneration !== generation) return false;
          for (const key of new Set([...Object.keys(saved), ...Object.keys(next)])) {
            if (fieldRevisions[key] !== submittedRevisions[key]) continue;
            if (Object.hasOwn(next, key)) draft[key] = clone(next[key]);
            else delete draft[key];
          }
          saved = clone(next);
          authorityRevision += 1;
          applied = true;
          conflict = false;
          return true;
        } catch (failure) {
          if (submittedGeneration === generation) error = failure?.message || String(failure || '保存失败，请重试。');
          return false;
        } finally {
          if (submittedGeneration === generation) {
            saving = false;
            submission = null;
            pendingSave = null;
            notify();
          }
        }
      })();
      void writing.then(finish, () => finish(false));
      return committed;
    }
    return { valid: true, changed: true, error: '', commit };
  }

  function save() {
    if (saving) return pendingSave;
    const prepared = prepareSave();
    if (!prepared.valid) {
      error = prepared.error;
      notify();
    }
    return prepared.commit();
  }

  function discard() {
    if (saving) return false;
    draft = clone(saved);
    error = '';
    conflict = false;
    notify();
    return true;
  }

  function reset(next = initial) {
    generation += 1;
    authorityRevision += 1;
    saved = clone(next);
    draft = clone(next);
    fieldRevisions = {};
    loaded = false;
    loading = saving = conflict = applied = false;
    error = '';
    submission = pendingSave = null;
    notify();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  return { getState, edit, prepareSave, save, discard, subscribe, receive, reload, reset };
}

export function componentSaveMessage(state) {
  if (state.error) return `${state.dirty ? '草稿已保留：' : ''}${state.error}`;
  if (state.saving) return '正在保存…';
  if (state.loading) return '正在读取配置…';
  if (!state.loaded) return '尚未读取配置。';
  if (state.conflict) return '配置已在其他入口更新；保留本地修改，可保存覆盖或放弃修改。';
  if (state.dirty) return state.applied ? '本次已保存，仍有未保存修改。' : '有未保存修改，不影响正式画面。';
  return state.applied ? '已保存，已发布更新。' : '当前为已保存配置。';
}
