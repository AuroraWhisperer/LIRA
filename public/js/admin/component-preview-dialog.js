import { componentSaveMessage } from './component-config-controller.js';
import { previewElement, mountComponentPreview } from './component-preview-surface.js';
import { getActiveComponentPreview, closeComponentPreview, setActiveComponentPreview,
  releaseComponentPreview } from './component-preview-session.js';

export function openComponentPreview(options) {
  const { id, title, controller, createPanel } = options;
  const active = getActiveComponentPreview(id);
  if (active) {
    active.focus();
    return active;
  }
  closeComponentPreview();
  const dialog = previewElement('dialog', 'component-preview-dialog');
  dialog.setAttribute('aria-label', `${title}预览与调整`);
  const header = previewElement('header', 'component-preview-heading');
  header.append(previewElement('h2', '', `${title}预览与调整`));
  const closeButton = previewElement('button', 'secondary', '关闭');
  closeButton.type = 'button';
  header.append(closeButton);
  const body = previewElement('div', 'component-preview-body');
  const settings = previewElement('aside', 'component-preview-panel');
  settings.setAttribute('aria-label', `${title}展示参数`);
  body.append(settings);
  const panel = createPanel(settings);
  const surface = mountComponentPreview(body, options);
  const footer = previewElement('footer', 'component-preview-footer');
  const saveState = previewElement('p');
  saveState.setAttribute('role', 'status');
  saveState.setAttribute('aria-live', 'polite');
  const discard = previewElement('button', 'secondary', '放弃未保存修改');
  const save = previewElement('button', 'primary', '保存并应用');
  discard.type = save.type = 'button';
  footer.append(saveState, discard, save);
  dialog.append(header, body, footer);
  document.body.append(dialog);
  let closed = false;
  const unsubscribe = controller.subscribe((state) => {
    save.disabled = !state.loaded || !state.dirty || state.saving;
    save.textContent = state.saving ? '正在保存…' : '保存并应用';
    discard.disabled = !state.dirty || state.saving;
    saveState.textContent = componentSaveMessage(state);
  });
  function close() {
    if (closed) return;
    closed = true;
    unsubscribe();
    panel?.dispose?.();
    surface.dispose();
    window.removeEventListener('pagehide', close);
    dialog.close();
    dialog.remove();
    releaseComponentPreview(handle);
  }
  const handle = { id, close, focus: () => closeButton.focus() };
  setActiveComponentPreview(handle);
  closeButton.addEventListener('click', close);
  save.addEventListener('click', () => { void controller.save(); });
  discard.addEventListener('click', () => controller.discard());
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  window.addEventListener('pagehide', close, { once: true });
  dialog.showModal();
  surface.fit();
  return handle;
}
