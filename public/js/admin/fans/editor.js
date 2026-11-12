import { toast } from '../../shared/utils.js';

export function createFanEditor({ editor, form, onError }) {
  const get = (id) => document.getElementById(id);
  let description = null;
  let revision = 0;

  function invalidate() { revision++; }

  function beginIntent() {
    const current = ++revision;
    return () => current === revision;
  }

  function open(formDescription, save) {
    invalidate();
    description = { ...formDescription, save };
    editor.closedBy = description.closeOnBackdrop ? 'any' : 'closerequest';
    editor.classList.toggle('fan-profile-editor', !!description.profileEditor);
    get('fanEditorTitle').textContent = description.title;
    get('fanEditorFields').innerHTML = description.fields;
    get('fanEditorFields').inert = false;
    get('fanEditorHint').textContent = description.hint || '';
    get('fanEditorError').hidden = true;
    get('fanSaveButton').textContent = description.saveLabel || '保存';
    get('fanSaveButton').disabled = false;
    form.querySelector('[data-fan-action="cancel-edit"]').disabled = false;
    form.removeAttribute('aria-busy');
    description.bind?.(form);
    if (!editor.open) editor.showModal();
    form.querySelector('[autofocus], textarea, input:not([type="checkbox"]), select')?.focus();
  }

  async function submit(event) {
    event.preventDefault();
    const current = description;
    if (!current || get('fanSaveButton').disabled) return;
    get('fanSaveButton').disabled = true;
    get('fanSaveButton').textContent = current.busyLabel || '正在保存…';
    form.querySelector('[data-fan-action="cancel-edit"]').disabled = true;
    form.setAttribute('aria-busy', 'true');
    get('fanEditorError').hidden = true;
    try {
      const input = current.read(form);
      get('fanEditorFields').inert = true;
      const result = await current.save(input);
      if (description !== current) return;
      if (!result?.keepOpen) {
        editor.close();
        if (result?.notices) {
          for (const { message, ...options } of result.notices) toast(message, options);
        } else {
          toast(result?.message || '已保存到本机');
        }
      }
    } catch (error) {
      if (description === current) onError(error);
    } finally {
      if (description === current) {
        get('fanEditorFields').inert = false;
        get('fanSaveButton').disabled = false;
        get('fanSaveButton').textContent = current.saveLabel || '保存';
        form.querySelector('[data-fan-action="cancel-edit"]').disabled = false;
        form.removeAttribute('aria-busy');
      }
    }
  }
  function cancel(event) {
    if (get('fanSaveButton').disabled) event.preventDefault();
  }

  form.addEventListener('submit', submit);
  editor.addEventListener('cancel', cancel);
  editor.addEventListener('close', invalidate);
  return {
    open,
    beginIntent,
    invalidate,
    dispose() {
      invalidate();
      form.removeEventListener('submit', submit);
      editor.removeEventListener('cancel', cancel);
      editor.removeEventListener('close', invalidate);
    },
  };
}
