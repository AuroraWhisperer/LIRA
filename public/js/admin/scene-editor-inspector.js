import { previewElement } from './component-preview-surface.js';
import { createSceneItemController } from './scene-item-controller.js';
import { SCENE_COMPONENTS } from '../shared/scene-components.js';
import { getSceneItemPositionBounds } from '../shared/scene-geometry.js';
import { syncComponentFieldValue } from './component-preview-panel.js';
import { createBrowserSourcePreview } from './browser-source-preview.js';
import { createTextBoxPreview } from './text-box-preview.js';
import { mountComponentStyleInspector } from './component-style-inspector.js';

export function mountSceneEditorInspector(host, { model, components, getSelection, report, requestStyles }) {
  let key = '';
  let panel = null;
  let stylePanel = null;
  let fields = {};
  let target;
  let parameters;
  function edit(mutator) {
    try { model.edit(mutator); } catch (error) { report(error.message); render(true); }
  }
  function field(label, property, type = 'number') {
    const wrapper = previewElement('label', '', label);
    const input = previewElement('input');
    input.type = type;
    if (type === 'number') { input.min = ['width', 'height'].includes(property) ? '32' : '0'; input.step = '1'; }
    else input.maxLength = 80;
    input.required = true;
    wrapper.append(input);
    fields[property] = input;
    input.addEventListener('change', () => {
      if (!input.reportValidity()) return;
      edit((document) => {
        const item = document.items.find((entry) => entry.id === [...getSelection()][0]);
        if (item && !item.locked) item[property] = type === 'number' ? Number(input.value) : input.value;
      });
    });
    return wrapper;
  }
  function clear() {
    stylePanel?.dispose(); stylePanel = null;
    panel?.dispose?.();
    panel = null;
    fields = {};
    host.replaceChildren();
  }
  function render(force = false) {
    const selected = model.getSnapshot().items.filter((item) => getSelection().has(item.id));
    const item = selected.length === 1 ? selected[0] : null;
    const nextKey = item ? `${item.id}:${item.type}:${item.appearance.mode}:${item.locked}:${item.appearance.config?.cssStyle?.id || item.appearance.config?.mediaStyle?.id || item.appearance.config?.resourceStyle?.id || ''}` : `count:${selected.length}`;
    if (key !== nextKey) {
      key = nextKey;
      clear();
      host.append(previewElement('h3', '', item ? `${item.name}参数` : '选择组件'));
      if (!item) {
        host.append(previewElement('p', 'hint', '点击画布或图层选择组件。'));
        return;
      }
      const component = components.find((entry) => entry.id === item.type)
        || (item.type === 'browser' ? createBrowserSourcePreview() : item.type === 'text-box' ? createTextBoxPreview() : null);
      const geometry = previewElement('fieldset', 'scene-editor-geometry');
      geometry.disabled = item.locked;
      geometry.append(field('组件名称', 'name', 'text'));
      const grid = previewElement('div', 'component-preview-fields');
      for (const [label, property] of [['X', 'x'], ['Y', 'y'], ['宽度', 'width'], ['高度', 'height']]) {
        grid.append(field(SCENE_COMPONENTS[item.type].contentHeight && !item.appearance.config?.mediaStyle && property === 'height' ? '高度（自动）' : label, property));
      }
      fields.height.readOnly = SCENE_COMPONENTS[item.type].contentHeight && !item.appearance.config?.mediaStyle;
      geometry.append(grid);
      target = previewElement('p', 'scene-editor-target');
      parameters = previewElement('fieldset', 'scene-editor-parameters');
      parameters.disabled = item.locked;
      parameters.classList.toggle('has-media-style', Boolean(item.appearance.config?.mediaStyle));
      const controller = item.appearance.mode === 'shared' ? component.controller
        : createSceneItemController(model, item.id, component.controller);
      host.append(geometry, target, parameters);
      stylePanel = mountComponentStyleInspector(parameters, { item, model, component, request: requestStyles, report });
      panel = component.createPanel(parameters, controller);
    }
    if (!item) return;
    stylePanel?.update?.(item, force);
    host.firstElementChild.textContent = `${item.name}参数`;
    for (const [property, input] of Object.entries(fields)) {
      syncComponentFieldValue(input, item[property], force || input.readOnly);
    }
    const { canvas } = model.getSnapshot();
    const bounds = getSceneItemPositionBounds(item, canvas);
    fields.x.min = String(bounds.minX);
    fields.x.max = String(bounds.maxX);
    fields.y.min = String(bounds.minY);
    fields.y.max = String(bounds.maxY);
    fields.width.max = String(canvas.width);
    fields.height.max = String(canvas.height);
    target.textContent = item.appearance.mode === 'shared'
      ? '样式与尺寸和默认组件共用；保存并应用后，原单组件地址同步更新。'
      : '独立组件；保存并应用后可复制此组件的单独地址。';
    target.hidden = false;
  }
  const unsubscribe = model.subscribeSnapshot(() => render());
  return { render, dispose() { unsubscribe(); clear(); } };
}
