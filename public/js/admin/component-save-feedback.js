import { toast } from '../shared/toast.js';
import { renderSaveStatus } from '../shared/save-status.js';
import { componentSaveMessage } from './component-config-controller.js';

export function renderComponentSaveStatus(element, state, message = componentSaveMessage(state)) {
  const kind = state.error || state.conflict ? 'error'
    : state.saving ? 'saving' : state.loading ? 'loading'
      : !state.loaded ? 'idle' : state.dirty ? 'pending' : 'saved';
  renderSaveStatus(element, kind, message);
}

export async function saveComponentWithFeedback(controller, name, notify = toast) {
  const before = controller.getState();
  if (!before.loaded || before.saving || !Object.keys(controller.getChanges('local')).length) return;
  const saved = await controller.save({ source: 'local' });
  const state = controller.getState();
  // A reset means this response belongs to a previous account or editing session.
  if (state.generation !== before.generation) return;
  const pendingLocal = Object.keys(controller.getChanges('local')).length > 0;
  if (saved && !pendingLocal && !before.error) return;
  const message = saved
    ? `${name}已保存${pendingLocal ? '，刚才的新修改还没保存。' : '。'}`
    : state.error || `${name}没保存成功，修改还在，请再试一次。`;
  notify(message, { key: `component-save:${name}`, update: true, type: saved ? 'success' : 'error' });
}
