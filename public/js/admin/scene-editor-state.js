import { requestScene } from './scene-api.js';
import { createSceneDocumentModel } from './scene-document-model.js';

export function createSceneEditorSession(dto, request = requestScene) {
  const model = createSceneDocumentModel(dto.document);
  let saved = JSON.stringify(dto.document);
  let revision = dto.revision;
  let publishedVersion = dto.publishedVersion;
  let busy = '';
  let error = '';
  let conflict = false;
  let disposed = false;
  const listeners = new Set();
  function getState() {
    return { revision, publishedVersion, busy, error, conflict,
      dirty: JSON.stringify(model.getDocument()) !== saved, ...model.getState() };
  }
  function notify() {
    if (!disposed) for (const listener of listeners) listener(getState());
  }
  const unsubscribe = model.subscribe(notify);
  async function write(action, expectedDefaults) {
    if (busy || disposed || conflict) return false;
    const document = model.getDocument();
    const submitted = JSON.stringify(document);
    const publication = action === 'publish' && expectedDefaults !== undefined
      ? { expectedDefaults: JSON.parse(JSON.stringify(expectedDefaults)) } : {};
    if (action === 'publish' && getState().dirty) return false;
    busy = action;
    error = '';
    notify();
    try {
      const next = await request(action, { id: document.id, expectedRevision: revision,
        ...(action === 'save' ? { document } : publication) });
      if (disposed) return false;
      revision = next.revision;
      publishedVersion = next.publishedVersion;
      if (action === 'save') saved = submitted;
      return true;
    } catch (failure) {
      if (disposed) return false;
      conflict = failure.status === 409;
      error = conflict ? '场景版本冲突，当前草稿已保留。请先导出模板备份，再重新载入服务器版本。'
        : failure.message || '场景操作失败，草稿已保留。';
      return false;
    } finally {
      busy = '';
      notify();
    }
  }
  return { model, getState, save: () => write('save'), publish: (expectedDefaults) => write('publish', expectedDefaults),
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    dispose() { disposed = true; unsubscribe(); listeners.clear(); },
  };
}
