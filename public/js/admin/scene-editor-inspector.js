import { previewElement } from './component-preview-surface.js';
import { createSceneItemController } from './scene-editor-state.js';

export function mountSceneEditorInspector(host, { model, components, getSelection, report }) {
  let key = '';
  let panel = null;
  let stopDefault = null;
  let fields = {};
  let target;
  let mode;
  let parameters;
  let saveDefault;
  let defaultState;
  function edit(mutator) {
    try { model.edit(mutator); } catch (error) { report(error.message); render(); }
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
    panel?.dispose?.();
    stopDefault?.();
    panel = stopDefault = null;
    fields = {};
    host.replaceChildren();
  }
  function render() {
    const selected = model.getDocument().items.filter((item) => getSelection().has(item.id));
    const item = selected.length === 1 ? selected[0] : null;
    const nextKey = item ? `${item.id}:${item.appearance.mode}:${item.locked}` : `count:${selected.length}`;
    if (key !== nextKey) {
      key = nextKey;
      clear();
      host.append(previewElement('h3', '', item ? '实例属性' : selected.length ? `已选择 ${selected.length} 个组件` : '选择组件'));
      if (!item) {
        host.append(previewElement('p', 'hint', selected.length
          ? '使用工具栏进行组合移动、对齐或图层操作。锁定的组件不会被移动或修改。'
          : '点击画布或左侧图层。按住 Shift 点击可多选。'));
        return;
      }
      const component = components.find((entry) => entry.id === item.type);
      const geometry = previewElement('fieldset', 'scene-editor-geometry');
      geometry.disabled = item.locked;
      geometry.append(field('实例名称', 'name', 'text'));
      const grid = previewElement('div', 'component-preview-fields');
      for (const [label, property] of [['X', 'x'], ['Y', 'y'], ['宽度', 'width'], ['高度', 'height']]) grid.append(field(label, property));
      geometry.append(grid);
      target = previewElement('p', 'scene-editor-target');
      mode = previewElement('button', 'secondary');
      mode.type = 'button';
      mode.addEventListener('click', () => {
        const state = component.controller.getState();
        if (item.appearance.mode === 'shared' && !state.loaded) { report('请先读取组件默认配置。'); return; }
        edit((document) => {
          const current = document.items.find((entry) => entry.id === item.id);
          if (!current || current.locked) return;
          current.appearance = current.appearance.mode === 'shared'
            ? { mode: 'independent', config: component.projectConfig?.(state.draft) || state.draft } : { mode: 'shared' };
        });
      });
      parameters = previewElement('fieldset', 'scene-editor-parameters');
      parameters.disabled = item.locked;
      const controller = item.appearance.mode === 'shared' ? component.controller
        : createSceneItemController(model, item.id, component.controller);
      host.append(geometry, target, mode, parameters);
      panel = component.createPanel(parameters, controller);
      if (item.appearance.mode === 'shared') {
        saveDefault = previewElement('button', 'secondary', '单独保存组件默认配置');
        const discardDefault = previewElement('button', 'secondary', '放弃默认配置修改');
        saveDefault.type = 'button';
        discardDefault.type = 'button';
        defaultState = previewElement('p', 'hint');
        defaultState.setAttribute('role', 'status');
        host.append(saveDefault, discardDefault, defaultState);
        stopDefault = controller.subscribe((state) => {
          saveDefault.disabled = item.locked || !state.loaded || !state.dirty || state.saving || state.loading;
          discardDefault.disabled = item.locked || state.saving || state.loading
            || (!state.dirty && !state.conflict && !state.error);
          defaultState.textContent = state.error || (state.loading ? '默认配置读取中…' : !state.loaded ? '尚未读取默认配置。'
            : state.saving ? '默认配置保存中…' : state.conflict ? '默认配置存在冲突，请明确保存或放弃修改。' : state.dirty
            ? '默认配置有未保存修改；保存场景不会保存这些修改。' : '默认配置已保存。');
        });
        discardDefault.addEventListener('click', () => controller.discard());
        saveDefault.addEventListener('click', () => {
          const invalid = [...parameters.querySelectorAll('input, select, textarea')].find((input) => !input.checkValidity());
          if (invalid) { invalid.reportValidity(); return; }
          void controller.save();
        });
      }
    }
    if (!item) return;
    for (const [property, input] of Object.entries(fields)) {
      if (input.value !== String(item[property])) input.value = String(item[property]);
    }
    const { canvas } = model.getDocument();
    fields.x.max = String(canvas.width - item.width);
    fields.y.max = String(canvas.height - item.height);
    fields.width.max = String(canvas.width - item.x);
    fields.height.max = String(canvas.height - item.y);
    target.textContent = item.appearance.mode === 'shared'
      ? '编辑目标：当前组件默认配置。更改会影响其他共享此默认配置的入口；场景发布时固定外观。'
      : '编辑目标：仅此场景实例。更改随场景草稿保存。';
    mode.textContent = item.appearance.mode === 'shared' ? '复制当前外观为独立配置' : '改用组件默认配置';
    mode.disabled = item.locked;
  }
  const unsubscribe = model.subscribe(render);
  return { render, dispose() { unsubscribe(); clear(); } };
}
