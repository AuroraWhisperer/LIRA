import { enhanceColorControls } from '../shared/color-control.js';
import { componentField, componentFieldLabel, isComponentFieldEditing, syncComponentFieldValue, subscribeComponentFields } from '../shared/component-parameter-fields.js';

export { componentField, componentFieldLabel, isComponentFieldEditing, syncComponentFieldValue, subscribeComponentFields };

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
