import { api } from '../shared/utils.js';
import { createComponentConfigController, componentSaveMessage } from './component-config-controller.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { registerComponentPreview } from './component-preview-registry.js';
import { bindOvertimeAppearance, createOvertimePreview, projectOvertimePreviewState } from './overtime-preview-factory.js';
export { createOvertimePreview, projectOvertimePreviewState } from './overtime-preview-factory.js';

export function createOvertimeAppearance({ initial = {}, onSavedState }) {
  let current = initial;
  let revisionGeneration = 0;
  const dataListeners = new Set();
  const controller = createComponentConfigController({
    initial: { path: initial.background?.path || '', fit: initial.background?.fit || 'cover' },
    persist: async ({ path, fit }) => {
      const submittedGeneration = revisionGeneration;
      const response = await api('/api/overtime/config', { path, fit }, { notifyError: false });
      if (submittedGeneration !== revisionGeneration) throw new Error('加班机状态已重新加载，请确认当前配置后重试。');
      const background = response.data?.background;
      if (!background || !Object.hasOwn(background, 'path') || !Object.hasOwn(background, 'fit')) {
        throw new Error('服务端未确认画面参数，请重试。');
      }
      if (Number(response.data.revision) < Number(current.revision)
        && (background.path !== current.background?.path || background.fit !== current.background?.fit)) {
        throw new Error('保存期间配置已在其他入口更新，请确认当前配置。');
      }
      onSavedState(response.data);
      return { path: background.path, fit: background.fit };
    },
  });
  bindOvertimeAppearance(document, controller);
  const save = document.getElementById('overtimeSaveBackgroundBtn');
  const discard = document.getElementById('overtimeDiscardBackgroundBtn');
  const saveState = document.getElementById('overtimeBackgroundSaveState');
  save.addEventListener('click', () => controller.save());
  discard.addEventListener('click', () => controller.discard());
  controller.subscribe((state) => {
    save.disabled = !state.dirty || state.saving;
    save.textContent = state.saving ? '保存中…' : '保存画面';
    discard.disabled = !state.dirty || state.saving;
    saveState.textContent = state.dirty || state.error || state.loading || state.saving || state.conflict || !state.loaded
      ? componentSaveMessage(state)
      : '';
  });
  function receive(state, { allowRevisionReset = false } = {}) {
    if (!state) return;
    if (allowRevisionReset && Number(state.revision) < Number(current.revision)) revisionGeneration += 1;
    current = state;
    if (state.background) controller.receive({ path: state.background.path || '', fit: state.background.fit || 'cover' });
    for (const listener of dataListeners) listener(projectOvertimePreviewState(current));
  }
  const getOvertimePreview = () => createOvertimePreview({ controller, startActualData(emit) {
    emit(projectOvertimePreviewState(current));
    dataListeners.add(emit);
    return () => dataListeners.delete(emit);
  } });
  registerComponentPreview('overtime', getOvertimePreview);
  function open() {
    return openComponentPreview(getOvertimePreview());
  }
  return { controller, receive, open };
}
