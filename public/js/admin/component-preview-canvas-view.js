import { previewElement } from './component-preview-surface.js';
import { createSceneDocumentModel } from './scene-document-model.js';
import { mountSceneEditorStage } from './scene-editor-stage.js';
import { mountSceneEditorInspector } from './scene-editor-inspector.js';
import { mountPreviewCanvasSettings } from './component-preview-canvas-settings.js';
import { enhanceSelects } from '../shared/select-menu.js';
import { mountComponentPreviewPicker } from './component-preview-picker.js';
import { mountPreviewCanvasOutput } from './component-preview-canvas-output.js';

export function mountComponentPreviewCanvas(host, { components, canvasController, canvasConnection, selectedId, selectedSize, source, recovery }) {
  const initial = canvasController?.getState().draft.document || {
    schemaVersion: 1, id: crypto.randomUUID(), title: '直播场景',
    canvas: { width: 1920, height: 1080 }, items: [],
  };
  if (initial.items.some((item) => !components.some(({ id }) => id === item.type))) {
    throw new Error('场景中的组件尚未连接，请从客户端重新打开。');
  }
  const model = createSceneDocumentModel(initial);
  const sharedTypes = new Set();
  let selected = null;
  let inspector = null;
  let itemActions = null;
  let stage;
  let receiving = false;
  let message = '';
  let closed = false;
  let output;
  let outputBusy = false;
  let inspectorOpen = Boolean(selectedId);
  const subscriptions = [];
  const toolbar = previewElement('div', 'preview-canvas-toolbar');
  toolbar.setAttribute('aria-label', '场景工具');
  const body = previewElement('div', 'component-preview-body');
  const navigation = previewElement('aside', 'component-preview-navigation');
  navigation.setAttribute('aria-label', '组件和图层');
  const library = previewElement('div', 'component-preview-list');
  const layers = previewElement('div', 'preview-canvas-layers');
  const layerHeading = previewElement('h2', '', '组件');
  const center = previewElement('section', 'component-preview-canvas');
  const canvasControls = previewElement('div', 'preview-canvas-controls');
  const dimensions = previewElement('span', 'preview-canvas-resolution');
  const stageHost = previewElement('div', 'scene-editor-stage-host');
  stageHost.tabIndex = -1;
  const sidebar = previewElement('aside', 'preview-canvas-sidebar');
  sidebar.id = 'previewCanvasInspector';
  sidebar.setAttribute('aria-label', '画布与组件参数');
  const inspectorHost = previewElement('div', 'component-preview-panel preview-canvas-inspector');
  const actions = previewElement('div', 'preview-canvas-actions');
  const sourceActions = previewElement('div', 'preview-canvas-source-actions');
  const applyActions = previewElement('div', 'preview-canvas-apply-actions');
  const status = previewElement('p', 'preview-canvas-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  actions.append(sourceActions, applyActions);
  navigation.append(layerHeading, layers, status);
  sidebar.append(inspectorHost);
  toolbar.append(library, canvasControls, actions);
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
  const canvasButton = button(canvasControls, '画布设置', () => { select(null); setInspectorOpen(true); });
  canvasButton.setAttribute('aria-label', '画布设置');
  canvasButton.append(dimensions);
  const backgroundLabel = previewElement('label', '', '底色');
  const background = previewElement('select');
  background.setAttribute('aria-label', '公共画布检查底色');
  for (const [value, text] of [['checker', '透明棋盘'], ['dark', '深色'], ['light', '浅色']]) {
    const option = previewElement('option', '', text); option.value = value; background.append(option);
  }
  backgroundLabel.append(background); canvasControls.append(backgroundLabel);
  const panelToggle = button(canvasControls, '', () => setInspectorOpen(!inspectorOpen));
  panelToggle.setAttribute('aria-controls', sidebar.id);
  function setInspectorOpen(open) {
    inspectorOpen = open;
    sidebar.hidden = !open;
    body.classList.toggle('is-inspector-collapsed', !open);
    panelToggle.textContent = open ? '收起参数' : '展开参数';
    panelToggle.setAttribute('aria-expanded', String(open));
    canvasButton.setAttribute('aria-pressed', String(open && !selected));
    stage?.fit();
  }
  setInspectorOpen(inspectorOpen);
  center.append(stageHost, navigation);
  body.append(center, sidebar);
  const controllers = [...components.filter((component) => !component.sceneOnly),
    ...(canvasController ? [{ id: 'canvas', title: '直播场景', controller: canvasController }] : [])];
  const isDiscardTarget = ({ id }) => !canvasController || id === 'canvas' || sharedTypes.has(id);
  const restore = recovery ? button(applyActions, '恢复上次草稿', () => recovery.restore()) : null;
  const discard = button(applyActions, '放弃修改', () => {
    if (recovery?.getState().pending) { recovery.useCurrent(); return; }
    stage.cancelGesture();
    for (const { controller } of controllers.filter(isDiscardTarget)) {
      const state = controller.getState();
      if (state.dirty || state.error) controller.discard();
    }
  });
  function validateInputs() {
    stage.cancelGesture();
    const invalid = [...inspectorHost.querySelectorAll('input, select, textarea')].find((input) => !input.checkValidity());
    if (invalid) { setInspectorOpen(true); invalid.reportValidity(); return false; }
    return true;
  }
  const save = canvasConnection ? null : button(applyActions, '保存全部修改', () => {
    if (!validateInputs()) return;
    for (const { controller } of controllers) if (controller.getState().dirty) void controller.save();
  }, 'primary');
  if (canvasConnection) output = mountPreviewCanvasOutput({ sourceHost: sourceActions, applyHost: applyActions, connection: canvasConnection,
    controllers, beforeApply: validateInputs, report,
    getSelection: () => model.getDocument().items.find((item) => item.id === selected),
    setBusy(value) { outputBusy = value; renderStatus(); } });
  host.replaceChildren(toolbar, body);
  const picker = mountComponentPreviewPicker({ components, source, add, report });
  button(library, '添加组件', () => picker.open(), 'secondary component-preview-add');
  function edit(mutator) {
    if (canvasController && !canvasController.getState().loaded) return;
    stage?.cancelGesture();
    model.edit(mutator);
  }
  function remove(id) {
    if (!model.getSnapshot().items.some((item) => item.id === id && !item.locked)) return;
    edit((document) => { document.items = document.items.filter((item) => item.id !== id); });
    stageHost.focus({ preventScroll: true });
  }
  function keydown(event) {
    if (event.defaultPrevented || event.isComposing || event.altKey || stageHost.inert
      || (!host.contains(event.target) && event.target !== document.body)
      || event.target.isContentEditable || event.target.closest('input, select, textarea, [role="textbox"], .lira-select')) return;
    try {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        closeLayerMenu();
        stage.cancelGesture();
        const previousIds = new Set(model.getSnapshot().items.map((item) => item.id));
        if (model.undo()) {
          const restored = model.getSnapshot().items.find((item) => !previousIds.has(item.id));
          if (restored) select(restored.id);
          stageHost.focus({ preventScroll: true });
        }
      } else if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && !event.shiftKey && selected) {
        event.preventDefault();
        remove(selected);
      }
    } catch (error) { report(error.message); }
  }
  document.addEventListener('keydown', keydown);
  function add(component, config) {
    const id = crypto.randomUUID();
    edit((document) => {
      if (document.items.length >= 32) throw new Error('一个场景最多添加 32 个组件。');
      const draft = config || component.controller.getState().draft;
      const region = !config && selectedSize ? selectedSize : component.bounds?.(draft);
      const [defaultWidth, defaultHeight] = region ? [region.width, region.height] : component.size(draft);
      const width = Math.min(defaultWidth, document.canvas.width);
      const height = Math.min(defaultHeight, document.canvas.height);
      document.items.push({ id, type: component.id,
        name: `${component.title} ${document.items.filter((item) => item.type === component.id).length + 1}`,
        x: Math.round((document.canvas.width - width) / 2), y: Math.round((document.canvas.height - height) / 2),
        width, height, visible: true, locked: false,
        appearance: config || component.sceneOnly ? { mode: 'independent', config: draft } : { mode: 'shared' } });
    });
    select(id);
    setInspectorOpen(true);
  }
  function select(id) {
    selected = id;
    inspector?.dispose();
    inspectorHost.replaceChildren();
    itemActions = null;
    canvasButton.setAttribute('aria-pressed', String(inspectorOpen && !selected));
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
      const removeButton = button(actions, '移除组件', () => remove(selected));
      itemActions = { center, lock, remove: removeButton };
      inspectorHost.append(actions);
    } else inspector = mountPreviewCanvasSettings(inspectorHost, { model, report });
    stage?.syncSelection();
    renderLayers();
    layers.querySelector('button[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    renderStatus();
    enhanceSelects();
  }
  let layerSignature;
  function closeLayerMenu() {
    layers.querySelector(':popover-open')?.hidePopover();
  }
  layers.addEventListener('scroll', closeLayerMenu);
  window.addEventListener('resize', closeLayerMenu);
  function renderLayers() {
    const document = model.getSnapshot();
    const signature = JSON.stringify([selected, document.items.map(({ id, name, visible, locked }) => [id, name, visible, locked])]);
    if (signature === layerSignature) return;
    layerSignature = signature;
    const scrollLeft = layers.scrollLeft;
    closeLayerMenu();
    layers.replaceChildren();
    layerHeading.textContent = `组件 · ${document.items.length}`;
    for (const item of document.items.toReversed()) {
      const row = previewElement('div', 'preview-canvas-layer');
      row.dataset.itemId = item.id;
      const choose = button(row, item.name, () => { select(item.id); setInspectorOpen(true); }, 'preview-canvas-layer-select');
      choose.dataset.itemId = item.id;
      choose.setAttribute('aria-pressed', String(selected === item.id));
      const toggle = button(row, '', () => {}, 'preview-canvas-layer-action');
      toggle.setAttribute('aria-label', `${item.name}操作`);
      toggle.setAttribute('aria-haspopup', 'menu');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.title = item.locked ? '解锁组件后可隐藏或删除' : '隐藏或删除组件';
      const chevron = previewElement('span', 'preview-canvas-layer-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      toggle.append(chevron);
      const menu = previewElement('div', 'preview-canvas-layer-menu');
      menu.id = `preview-layer-menu-${item.id}`;
      menu.popover = 'auto';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', `${item.name}操作`);
      toggle.setAttribute('aria-controls', menu.id);
      toggle.popoverTargetElement = menu;
      const visible = button(menu, item.visible ? '隐藏' : '显示', () => {
        menu.hidePopover();
        edit((next) => { next.items.find((entry) => entry.id === item.id).visible = !item.visible; });
        [...layers.children].find((layer) => layer.dataset.itemId === item.id)?.querySelector('.preview-canvas-layer-action').focus();
      });
      const removeButton = button(menu, '删除', () => { menu.hidePopover(); remove(item.id); }, 'danger');
      for (const action of [visible, removeButton]) {
        action.setAttribute('role', 'menuitem');
        action.disabled = item.locked;
      }
      menu.addEventListener('beforetoggle', (event) => {
        const open = event.newState === 'open';
        toggle.setAttribute('aria-expanded', String(open));
        if (!open) return;
        const rect = toggle.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.right - 144, window.innerWidth - 152))}px`;
        menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      });
      menu.addEventListener('toggle', () => {
        if (menu.matches(':popover-open')) menu.querySelector('button:not(:disabled)')?.focus();
      });
      toggle.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        if (!menu.matches(':popover-open')) menu.showPopover({ source: toggle });
      });
      menu.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const actions = [...menu.querySelectorAll('button:not(:disabled)')];
        const index = actions.indexOf(host.ownerDocument.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length;
        actions[next]?.focus();
      });
      row.append(menu);
      layers.append(row);
    }
    layers.scrollLeft = scrollLeft;
  }
  function renderStatus() {
    if (closed) return;
    if (itemActions) {
      const item = model.getDocument().items.find((entry) => entry.id === selected);
      itemActions.center.disabled = itemActions.remove.disabled = item.locked;
      itemActions.lock.textContent = item.locked ? '解锁' : '锁定';
    }
    const states = controllers.map(({ id, title, controller }) => ({ id, title, ...controller.getState() }));
    const saving = states.some((state) => state.saving);
    const dirty = states.filter((state) => state.dirty);
    const failures = states.filter((state) => state.error);
    const recoveryState = recovery?.getState();
    if (restore) restore.hidden = !recoveryState.pending;
    discard.textContent = recoveryState?.pending ? '使用当前配置' : '放弃修改';
    const errors = new Map();
    for (const { title, error } of failures) {
      if (!errors.has(error)) errors.set(error, []);
      errors.get(error).push(title);
    }
    status.classList.toggle('has-error', failures.length > 0 || Boolean(recoveryState?.pending));
    status.textContent = failures.length ? [...errors].map(([error, titles]) =>
      titles.length === states.length ? error : `${titles.join('、')}：${error}`).join('\n')
      : recoveryState?.message || (typeof message === 'function' ? message() : message)
        || (saving ? '正在保存…' : dirty.length ? '有未保存修改' : '');
    if (!canvasController) status.textContent += ' 此旧链接仅保存组件参数；保存布局请从客户端重新打开。';
    if (save) save.disabled = saving || !dirty.length || dirty.some((state) => !state.loaded);
    const discardStates = states.filter(isDiscardTarget);
    discard.disabled = discardStates.some((state) => state.saving) || outputBusy
      || (!discardStates.some((state) => state.dirty || state.error) && !recoveryState?.pending);
    const connected = !canvasController || canvasController.getState().loaded;
    discard.disabled ||= !connected;
    if (restore) restore.disabled = !connected || saving || outputBusy;
    library.inert = canvasControls.inert = layers.inert = stageHost.inert = inspectorHost.inert = !connected || outputBusy || Boolean(recoveryState?.pending);
    canvasButton.disabled = !connected || outputBusy || Boolean(recoveryState?.pending);
    output?.render(connected && !recoveryState?.pending, saving);
  }
  if (recovery) subscriptions.push(recovery.subscribe(renderStatus));
  for (const component of components) {
    subscriptions.push(component.controller.subscribe(renderStatus));
  }
  stage = mountSceneEditorStage(stageHost, { model, components, getSelection: () => new Set(selected ? [selected] : []), select, report });
  function updateInspectorWidth() {
    const { width, height } = model.getDocument().canvas;
    // Reserve the height-fitted canvas and its 24px viewport padding on each side.
    const fitWidth = Math.min(width, Math.max(0, stageHost.clientHeight - 48) * width / height);
    body.style.setProperty('--preview-canvas-fit-width', `${Math.ceil(fitWidth)}px`);
  }
  const layoutObserver = new ResizeObserver(updateInspectorWidth);
  layoutObserver.observe(stageHost);
  background.addEventListener('change', () => { stageHost.dataset.background = background.value; });
  subscriptions.push(model.subscribe(() => {
    message = '';
    const document = model.getDocument();
    // Keep shared owners involved in this edit, including layers removed before discard.
    for (const item of document.items) if (item.appearance.mode === 'shared') sharedTypes.add(item.type);
    if (selected && !document.items.some((item) => item.id === selected)) select(null);
    dimensions.textContent = `${document.canvas.width} × ${document.canvas.height}`;
    updateInspectorWidth();
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
  const existing = model.getDocument().items.find((item) => item.type === selectedId
    && (components.find(({ id }) => id === selectedId)?.sceneOnly || item.appearance.mode === 'shared'));
  if (!selectedId) select(null);
  else if (existing) {
    if (!existing.visible) edit((document) => { document.items.find((item) => item.id === existing.id).visible = true; });
    select(existing.id);
  } else add(components.find(({ id }) => id === selectedId));
  return { dispose() {
    closed = true;
    closeLayerMenu();
    document.removeEventListener('keydown', keydown);
    window.removeEventListener('resize', closeLayerMenu);
    layoutObserver.disconnect();
    for (const stop of subscriptions) stop();
    inspector?.dispose(); stage.dispose(); picker.dispose(); output?.dispose();
    host.replaceChildren();
  } };
}
