export function componentField(root, id) {
  if (root.getElementById) return root.getElementById(id);
  if (root.id === id || root.dataset?.previewField === id) return root;
  return root.querySelector(`[data-preview-field="${id}"], [id="${id}"]`);
}

export function componentFieldLabel(control) {
  const name = control.getAttribute('aria-label')?.trim();
  if (name) return name;
  const label = control.labels?.[0]?.cloneNode(true);
  label?.querySelectorAll('input, select, textarea, button, lira-help, .hint').forEach(node => node.remove());
  return label?.textContent.replace(/\s+/g, ' ').trim() || '参数';
}

export function isComponentFieldEditing(control) {
  if (!control) return false;
  if (control.type === 'color' && control.closest?.('.lira-color-control')) return control.dataset?.colorEditing === 'true';
  const active = (control.ownerDocument || document).activeElement;
  return control === active || control.dataset?.colorEditing === 'true'
    || Boolean(control.closest?.('.range-row, .lira-select, .component-parameter-inputs')?.contains(active));
}

export function syncComponentFieldValue(control, value, force = false) {
  if ((force || !isComponentFieldEditing(control)) && control.value !== String(value)) {
    control.value = String(value);
  }
}

export function subscribeComponentFields(root, controller, render) {
  let disposed = false;
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    // Native change handlers must commit their optimistic edits before refilling fields.
    queueMicrotask(() => {
      queued = false;
      if (!disposed) render(controller.getState());
    });
  };
  const stop = controller.subscribe(render);
  root.addEventListener('focusout', refresh);
  root.addEventListener('lira-color-edit-end', refresh);
  return () => {
    disposed = true;
    stop();
    root.removeEventListener('focusout', refresh);
    root.removeEventListener('lira-color-edit-end', refresh);
  };
}
