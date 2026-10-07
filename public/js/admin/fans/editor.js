import { toast } from '../../shared/utils.js';

export function createFanEditor({ editor, form, onError }) {
  const get = (id) => document.getElementById(id);
  let description = null;

  function open(formDescription, save) {
    description = { ...formDescription, save };
    editor.classList.toggle('fan-profile-editor', !!description.profileEditor);
    get('fanEditorTitle').textContent = description.title;
    get('fanEditorFields').innerHTML = description.fields;
    get('fanEditorHint').textContent = description.hint || '';
    get('fanEditorError').hidden = true;
    get('fanSaveButton').textContent = description.saveLabel || '保存';
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
      const result = await current.save(current.read(form));
      if (!result?.keepOpen) {
        editor.close();
        toast(result?.message || '已保存到本机');
      }
    } catch (error) {
      onError(error);
    } finally {
      get('fanSaveButton').disabled = false;
      get('fanSaveButton').textContent = description.saveLabel || '保存';
      form.querySelector('[data-fan-action="cancel-edit"]').disabled = false;
      form.removeAttribute('aria-busy');
    }
  }
  function cancel(event) {
    if (get('fanSaveButton').disabled) event.preventDefault();
  }

  form.addEventListener('submit', submit);
  editor.addEventListener('cancel', cancel);
  return {
    open,
    dispose() {
      form.removeEventListener('submit', submit);
      editor.removeEventListener('cancel', cancel);
    },
  };
}
