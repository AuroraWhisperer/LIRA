import { enhanceColorControls } from '../shared/color-control.js';

export function componentField(root, id) {
  if (root.getElementById) return root.getElementById(id);
  if (root.id === id || root.dataset?.previewField === id) return root;
  return root.querySelector(`[data-preview-field="${id}"], [id="${id}"]`);
}

export function isComponentFieldEditing(control) {
  if (!control) return false;
  if (control.type === 'color' && control.closest?.('.lira-color-control')) return control.dataset?.colorEditing === 'true';
  const active = (control.ownerDocument || document).activeElement;
  return control === active || control.dataset?.colorEditing === 'true'
    || Boolean(control.closest?.('.range-row, .lira-select')?.contains(active));
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

export function cloneComponentPanel(source, prefix) {
  const panel = document.importNode(source, true);
  panel.querySelectorAll('[data-resource-style-settings], [data-local-styles]').forEach(node => node.remove());
  const names = new Map();
  for (const node of [panel, ...panel.querySelectorAll('[id]')]) {
    if (!node.id) continue;
    const original = node.id;
    node.dataset.previewField = original;
    node.id = `${prefix}-${original}`;
    names.set(original, node.id);
  }
  for (const node of [panel, ...panel.querySelectorAll('*')]) {
    for (const attribute of ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls']) {
      if (!node.hasAttribute(attribute)) continue;
      node.setAttribute(attribute, node.getAttribute(attribute).split(/\s+/).map((id) => names.get(id) || id).join(' '));
    }
    if (node.name) node.name = `${prefix}-${node.name}`;
  }
  enhanceColorControls(panel);
  return panel;
}
