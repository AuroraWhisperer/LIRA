import { api } from '../shared/utils.js';
import { createComponentConfigController, componentSaveMessage } from './component-config-controller.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { registerComponentPreview } from './component-preview-registry.js';
import { bindOvertimeAppearance, createOvertimePreview, projectOvertimePreviewState } from './overtime-preview-factory.js';
export { createOvertimePreview, projectOvertimePreviewState } from './overtime-preview-factory.js';

export function createOvertimeAppearance({ initial = {}, onSavedState }) {
  let current = initial;
  const dataListeners = new Set();
  const controller = createComponentConfigController({
    initial: { path: initial.background?.path || '', fit: initial.background?.fit || 'cover' },
    persist: async ({ path, fit }) => {
      const response = await api('/api/overtime/config', { path, fit }, { notifyError: false });
      const background = response.data?.background;
      if (!background || !Object.hasOwn(background, 'path') || !Object.hasOwn(background, 'fit')) {
        throw new Error('服务端未确认画面参数，请重试。');
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
  function receive(state) {
    if (!state) return;
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
