export function componentField(root, id) {
  if (root.getElementById) return root.getElementById(id);
  if (root.id === id || root.dataset?.previewField === id) return root;
  return root.querySelector(`[data-preview-field="${id}"], [id="${id}"]`);
}

export function isComponentFieldEditing(control) {
  if (!control) return false;
  const active = (control.ownerDocument || document).activeElement;
  return control === active || Boolean(control.closest?.('.range-row, .lira-select')?.contains(active));
}

export function syncComponentFieldValue(control, value, force = false) {
  if ((force || !isComponentFieldEditing(control)) && control.value !== String(value)) {
    control.value = String(value);
  }
}

export function cloneComponentPanel(source, prefix) {
  const panel = source.cloneNode(true);
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
  return panel;
}
