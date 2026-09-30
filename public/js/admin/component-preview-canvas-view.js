import { previewElement } from './component-preview-surface.js';
import { createSceneDocumentModel } from './scene-document-model.js';
import { mountSceneEditorStage } from './scene-editor-stage.js';
import { mountSceneEditorInspector } from './scene-editor-inspector.js';
import { mountPreviewCanvasSettings } from './component-preview-canvas-settings.js';
import { enhanceSelects } from '../shared/select-menu.js';
import { mountComponentPreviewPicker } from './component-preview-picker.js';
import { mountPreviewCanvasOutput } from './component-preview-canvas-output.js';

export function mountComponentPreviewCanvas(host, { components, canvasController, canvasConnection, selectedId, source }) {
  const initial = canvasController?.getState().draft.document || {
    schemaVersion: 1, id: crypto.randomUUID(), title: '直播画布',
    canvas: { width: 1920, height: 1080 }, items: [],
  };
  if (initial.items.some((item) => !components.some(({ id }) => id === item.type))) {
    throw new Error('画布中的组件尚未连接，请从客户端重新打开。');
  }
  const model = createSceneDocumentModel(initial);
  let selected = null;
  let inspector = null;
  let itemActions = null;
  let stage;
  let receiving = false;
  let message = '';
  let closed = false;
  let output;
  let outputBusy = false;
  const subscriptions = [];
  const header = previewElement('header', 'component-preview-heading');
  header.append(previewElement('span', 'component-preview-brand', 'LIRA'),
    previewElement('h1', '', '直播画布'),
    previewElement('p', '', '编辑预览 · 含示例数据'));
  const body = previewElement('div', 'component-preview-body');
  const navigation = previewElement('aside', 'component-preview-navigation');
  navigation.setAttribute('aria-label', '组件和图层');
  const library = previewElement('div', 'component-preview-list');
  const layers = previewElement('div', 'preview-canvas-layers');
  const layerHeading = previewElement('h2', '', '画布中的组件');
  navigation.append(library, layerHeading, layers);
  const center = previewElement('section', 'component-preview-canvas');
  const toolbar = previewElement('div', 'preview-canvas-toolbar');
  const dimensions = previewElement('span', 'preview-canvas-resolution');
  const stageHost = previewElement('div', 'scene-editor-stage-host');
  const inspectorHost = previewElement('aside', 'component-preview-panel preview-canvas-inspector');
  inspectorHost.setAttribute('aria-label', '画布与组件参数');
  const footer = previewElement('footer', 'component-preview-footer');
  const status = previewElement('p');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  footer.append(status);
  const report = (text) => { message = text; renderStatus(); };
  function button(parent, text, action, className = 'secondary') {
    const node = previewElement('button', className, text);
    node.type = 'button';
    node.addEventListener('click', () => {
      try { message = ''; action(); } catch (error) { report(error.message); }
    });
    parent.append(node);
    return node;
  }
  const canvasButton = button(toolbar, '画布设置', () => select(null));
  toolbar.append(dimensions);
  const backgroundLabel = previewElement('label', '', '检查底色');
  const background = previewElement('select');
  background.setAttribute('aria-label', '公共画布检查底色');
  for (const [value, text] of [['checker', '透明棋盘'], ['dark', '深色'], ['light', '浅色']]) {
    const option = previewElement('option', '', text); option.value = value; background.append(option);
  }
  backgroundLabel.append(background); toolbar.append(backgroundLabel);
  center.append(toolbar, stageHost);
  body.append(navigation, center, inspectorHost);
  const controllers = [...components, ...(canvasController ? [{ id: 'canvas', title: '公共画布', controller: canvasController }] : [])];
  const discard = button(footer, '放弃未保存修改', () => {
    stage.cancelGesture();
    for (const { controller } of controllers) {
      const state = controller.getState();
      if (state.dirty || state.error) controller.discard();
    }
  });
  function validateInputs() {
    stage.cancelGesture();
    const invalid = [...inspectorHost.querySelectorAll('input, select, textarea')].find((input) => !input.checkValidity());
    if (invalid) { invalid.reportValidity(); return false; }
    return true;
  }
  const save = canvasConnection ? null : button(footer, '保存全部修改', () => {
    if (!validateInputs()) return;
    for (const { controller } of controllers) if (controller.getState().dirty) void controller.save();
  }, 'primary');
  if (canvasConnection) output = mountPreviewCanvasOutput({ header, footer, connection: canvasConnection,
    controllers, beforeApply: validateInputs, report,
    setBusy(value) { outputBusy = value; renderStatus(); } });
  host.replaceChildren(header, body, footer);
  const picker = mountComponentPreviewPicker({ components, source, add, report });
  button(library, '添加组件', () => picker.open(), 'secondary component-preview-add');
  function edit(mutator) {
    if (canvasController && !canvasController.getState().loaded) return;
    stage?.cancelGesture();
    model.edit(mutator);
  }
  function add(component, config) {
    const id = crypto.randomUUID();
    edit((document) => {
      if (document.items.length >= 32) throw new Error('一块画布最多添加 32 个组件。');
      const draft = config || component.controller.getState().draft;
      const region = component.bounds?.(draft);
      const [defaultWidth, defaultHeight] = region ? [region.width, region.height] : component.size(draft);
      const width = Math.min(defaultWidth, document.canvas.width);
      const height = Math.min(defaultHeight, document.canvas.height);
      document.items.push({ id, type: component.id,
        name: `${component.title} ${document.items.filter((item) => item.type === component.id).length + 1}`,
        x: Math.round((document.canvas.width - width) / 2), y: Math.round((document.canvas.height - height) / 2),
        width, height, visible: true, locked: false,
        appearance: config ? { mode: 'independent', config } : { mode: 'shared' } });
    });
    select(id);
  }
  function select(id) {
    selected = id;
    inspector?.dispose();
    inspectorHost.replaceChildren();
    itemActions = null;
    canvasButton.setAttribute('aria-pressed', String(!selected));
    if (selected) {
      const parameters = previewElement('div', 'preview-canvas-parameters');
      inspectorHost.append(parameters);
      inspector = mountSceneEditorInspector(parameters, { model, components,
        getSelection: () => new Set([selected]), report, embedded: true });
      const actions = previewElement('div', 'preview-canvas-item-actions');
      const center = button(actions, '居中', () => edit((document) => {
        const item = document.items.find((entry) => entry.id === selected);
        item.x = Math.round((document.canvas.width - item.width) / 2);
        item.y = Math.round((document.canvas.height - item.height) / 2);
      }));
      const lock = button(actions, '锁定', () => {
        edit((document) => { const current = document.items.find((entry) => entry.id === selected); current.locked = !current.locked; });
      });
      const remove = button(actions, '移除组件', () => {
        edit((document) => { document.items = document.items.filter((entry) => entry.id !== selected); });
        select(null);
      });
      itemActions = { center, lock, remove };
      inspectorHost.append(actions);
    } else inspector = mountPreviewCanvasSettings(inspectorHost, { model, report });
    stage?.syncSelection();
    renderLayers();
    renderStatus();
    enhanceSelects();
  }
  function renderLayers() {
    layers.replaceChildren();
    const document = model.getDocument();
    layerHeading.textContent = `画布中的组件 · ${document.items.length}`;
    if (!document.items.length) layers.append(previewElement('p', 'hint', '暂无组件。点击“添加组件”选择分类和样式。'));
    for (const item of document.items.toReversed()) {
      const row = previewElement('div', 'preview-canvas-layer');
      const choose = button(row, item.name, () => select(item.id), 'preview-canvas-layer-select');
      choose.dataset.itemId = item.id;
      choose.setAttribute('aria-pressed', String(selected === item.id));
      const visible = button(row, item.visible ? '隐藏' : '显示', () => edit((next) => {
        next.items.find((entry) => entry.id === item.id).visible = !item.visible;
      }), 'preview-canvas-layer-action');
      visible.setAttribute('aria-label', `${item.visible ? '隐藏' : '显示'} ${item.name}`);
      visible.disabled = item.locked;
      layers.append(row);
    }
  }
  function renderStatus() {
    if (closed) return;
    if (itemActions) {
      const item = model.getDocument().items.find((entry) => entry.id === selected);
      itemActions.center.disabled = itemActions.remove.disabled = item.locked;
      itemActions.lock.textContent = item.locked ? '解锁' : '锁定';
    }
    const states = controllers.map(({ title, controller }) => ({ title, ...controller.getState() }));
    const saving = states.some((state) => state.saving);
    const dirty = states.filter((state) => state.dirty);
    const failures = states.filter((state) => state.error);
    status.textContent = failures.length ? failures.map((state) => `${state.title}：${state.error}`).join('；')
      : message || (saving ? '正在保存画布和组件参数…' : dirty.length ? `${dirty.map((state) => state.title).join('、')}有未保存修改`
        : '画布和组件参数已保存。');
    if (!canvasController) status.textContent += ' 此旧链接仅保存组件参数；保存布局请从客户端重新打开。';
    if (save) save.disabled = saving || !dirty.length || dirty.some((state) => !state.loaded);
    discard.disabled = saving || outputBusy || (!dirty.length && !failures.length);
    const connected = !canvasController || canvasController.getState().loaded;
    navigation.inert = stageHost.inert = inspectorHost.inert = !connected || outputBusy;
    canvasButton.disabled = !connected || outputBusy;
    output?.render(connected, saving);
  }
  for (const component of components) {
    subscriptions.push(component.controller.subscribe(renderStatus));
  }
  stage = mountSceneEditorStage(stageHost, { model, components, getSelection: () => new Set(selected ? [selected] : []), select, report });
  background.addEventListener('change', () => { stageHost.dataset.background = background.value; });
  subscriptions.push(model.subscribe(() => {
    message = '';
    const document = model.getDocument();
    if (selected && !document.items.some((item) => item.id === selected)) select(null);
    dimensions.textContent = `${document.canvas.width} × ${document.canvas.height}`;
    if (canvasController && !receiving && !model.isGestureActive()
      && JSON.stringify(document) !== JSON.stringify(canvasController.getState().draft.document)) canvasController.edit({ document });
    renderLayers();
    renderStatus();
  }));
  if (canvasController) subscriptions.push(canvasController.subscribe(({ draft }) => {
    if (!model.isGestureActive() && JSON.stringify(draft.document) !== JSON.stringify(model.getDocument())) {
      receiving = true;
      try { model.reset(draft.document); } finally { receiving = false; }
    }
    renderStatus();
  }));
  const existing = model.getDocument().items.find((item) => item.type === selectedId);
  if (!selectedId) select(null);
  else if (existing) {
    if (!existing.visible) edit((document) => { document.items.find((item) => item.id === existing.id).visible = true; });
    select(existing.id);
  } else add(components.find(({ id }) => id === selectedId));
  return { dispose() {
    closed = true;
    for (const stop of subscriptions) stop();
    inspector?.dispose(); stage.dispose(); picker.dispose(); output?.dispose();
    host.replaceChildren();
  } };
}
