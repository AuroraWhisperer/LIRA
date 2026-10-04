import { toast } from '../shared/toast.js';

export async function saveComponentWithFeedback(controller, name, notify = toast) {
  const before = controller.getState();
  if (!before.loaded || !before.dirty || before.saving) return;
  const saved = await controller.save();
  const state = controller.getState();
  // A reset means this response belongs to a previous account or editing session.
  if (state.generation !== before.generation) return;
  const message = saved
    ? `${name}已保存${state.dirty ? '，刚才的新修改还没保存。' : '。'}`
    : state.error || `${name}没保存成功，修改还在，请再试一次。`;
  notify(message, { key: `component-save:${name}`, update: true, type: saved ? 'success' : 'error' });
}
