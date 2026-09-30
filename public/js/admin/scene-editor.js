import { copyText, localOverlayOrigin } from '../shared/utils.js';
import { showConfirmationDialog } from '../shared/confirmation-dialog.js';
import { getComponentPreviews } from './component-preview-registry.js';
import { previewElement } from './component-preview-surface.js';
import { getActiveComponentPreview, closeComponentPreview, setActiveComponentPreview,
  releaseComponentPreview } from './component-preview-session.js';
import { createSceneEditorSession, requestScene } from './scene-editor-state.js';
import { alignSceneItems, moveSceneItems } from './scene-document-model.js';
import { mountSceneEditorStage } from './scene-editor-stage.js';
import { mountSceneEditorInspector } from './scene-editor-inspector.js';
import { downloadSceneTemplate, mountSceneTemplateImport } from './scene-editor-template.js';

let cache = null;

export function openSceneEditor() {
  const active = getActiveComponentPreview('scene-editor');
  if (active) { active.focus(); return active; }
  closeComponentPreview();
  const components = getComponentPreviews();
  if (components.length !== 4) throw new Error('组件尚未加载完成，请重新打开场景编辑器。');
  const owners = components.map(({ controller }) => [controller, controller.getState().generation]);
  if (!cache || owners.some(([controller, generation], index) =>
    cache.owners[index][0] !== controller || cache.owners[index][1] !== generation)) {
    for (const session of cache?.sessions.values() || []) session.dispose();
    cache = { owners, sessions: new Map(), selected: '' };
  }
  const sessions = cache.sessions;
  const dialog = previewElement('dialog', 'component-preview-dialog scene-editor');
  dialog.setAttribute('aria-label', '本地场景编辑器');
  const header = previewElement('header', 'component-preview-heading');
  const title = previewElement('h2', '', '本地场景');
  const sceneSelect = previewElement('select');
  sceneSelect.setAttribute('aria-label', '选择场景');
  header.append(title, sceneSelect);
  const toolbar = previewElement('div', 'scene-editor-toolbar');
  const body = previewElement('div', 'scene-editor-body');
  const layers = previewElement('aside', 'scene-editor-layers');
  layers.setAttribute('aria-label', '场景图层');
  const stageHost = previewElement('div', 'scene-editor-stage-host');
  const inspectorHost = previewElement('aside', 'component-preview-panel scene-editor-inspector');
  inspectorHost.setAttribute('aria-label', '实例属性');
  body.append(layers, stageHost, inspectorHost);
  const footer = previewElement('footer', 'component-preview-footer scene-editor-footer');
  const status = previewElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  footer.append(status);
  dialog.append(header, toolbar, body, footer);
  document.body.append(dialog);
  let closed = false;
  let session = null;
  let selection = new Set();
  let stage = null;
  let inspector = null;
  let unsubscribe = null;
  let loading = false;
  let operation = 0;
  let cancelConfirmation = null;
  const choices = new Map();
  const editButtons = [];
  const report = (message) => { if (!closed) status.textContent = message; };
  function button(host, text, action, className = 'secondary') {
    const node = previewElement('button', className, text);
    node.type = 'button';
    node.addEventListener('click', async (event) => { try { await action(event); } catch (error) { report(error.message); } });
    host.append(node);
    return node;
  }
  function edit(mutator) {
    if (!session) return;
    stage?.cancelGesture();
    session.model.edit(mutator);
  }
  function select(id, toggle = false) {
    if (!id) selection.clear();
    else if (toggle) { if (selection.has(id)) selection.delete(id); else selection.add(id); }
    else selection = new Set([id]);
    stage?.syncSelection();
    inspector?.render();
    renderLayers();
    renderState();
  }
  function renderLayers() {
    layers.replaceChildren(previewElement('h3', '', '添加组件'));
    const add = previewElement('div', 'scene-editor-add');
    for (const component of components) {
      button(add, `添加${component.title}`, () => {
        const id = crypto.randomUUID();
        edit((document) => {
          if (document.items.length >= 32) throw new Error('一个场景最多添加 32 个组件。');
          const [width, height] = component.size(component.controller.getState().draft);
          document.items.push({ id, type: component.id, name: `${component.title} ${document.items.filter((item) => item.type === component.id).length + 1}`,
            x: 0, y: 0, width: Math.min(width, document.canvas.width), height: Math.min(height, document.canvas.height),
            visible: true, locked: false, appearance: { mode: 'shared' } });
        });
        select(id);
      }).disabled = !session || session.model.getDocument().items.length >= 32;
    }
    layers.append(add, previewElement('h3', '', '图层 · 上方在前'));
    if (!session) return;
    for (const item of session.model.getDocument().items.toReversed()) {
      const row = previewElement('div', 'scene-editor-layer');
      const choose = button(row, item.name, (event) => select(item.id, event.shiftKey || event.ctrlKey || event.metaKey));
      choose.setAttribute('aria-pressed', String(selection.has(item.id)));
      const visible = button(row, item.visible ? '隐藏' : '显示', () => edit((document) => {
        const current = document.items.find((value) => value.id === item.id);
        if (!current.locked) current.visible = !current.visible;
      }));
      visible.setAttribute('aria-label', `${item.visible ? '隐藏' : '显示'} ${item.name}`);
      visible.disabled = item.locked;
      const lock = button(row, item.locked ? '解锁' : '锁定', () => edit((document) => {
        const current = document.items.find((value) => value.id === item.id);
        current.locked = !current.locked;
      }));
      lock.setAttribute('aria-label', `${item.locked ? '解锁' : '锁定'} ${item.name}`);
      layers.append(row);
    }
  }
  const sceneName = previewElement('input');
  sceneName.setAttribute('aria-label', '场景名称');
  sceneName.maxLength = 80;
  sceneName.required = true;
  sceneName.addEventListener('change', () => {
    if (sceneName.reportValidity()) {
      try { edit((document) => { document.title = sceneName.value; }); }
      catch (error) { report(error.message); }
    }
  });
  toolbar.append(sceneName);
  const canvasInputs = {};
  for (const [key, text] of [['width', '画布宽'], ['height', '画布高']]) {
    const label = previewElement('label', '', text);
    const input = previewElement('input');
    input.type = 'number'; input.min = '320'; input.max = '7680'; input.step = '1'; input.required = true;
    canvasInputs[key] = input;
    label.append(input); toolbar.append(label);
    input.addEventListener('change', () => {
      if (!input.reportValidity()) return;
      try { edit((document) => { document.canvas[key] = Number(input.value); }); }
      catch { report('画布必须容纳所有组件，请先调整超出边界的实例。'); }
      renderState();
    });
  }
  const zoom = previewElement('select');
  zoom.setAttribute('aria-label', '画布缩放');
  for (const value of ['fit', '25', '50', '100']) {
    const option = previewElement('option', '', value === 'fit' ? '适应窗口' : `${value}%`);
    option.value = value; zoom.append(option);
  }
  zoom.addEventListener('change', () => stage?.setZoom(zoom.value));
  const snapLabel = previewElement('label', '', '8px 吸附');
  const snap = previewElement('input'); snap.type = 'checkbox'; snap.checked = true;
  snap.addEventListener('change', () => stage?.setSnap(snap.checked));
  snapLabel.prepend(snap);
  toolbar.append(zoom, snapLabel);
  const undo = button(toolbar, '撤销', () => { stage?.cancelGesture(); session?.model.undo(); });
  const redo = button(toolbar, '重做', () => { stage?.cancelGesture(); session?.model.redo(); });
  function duplicate() {
    const ids = [];
    edit((document) => {
      const items = document.items.filter((item) => selection.has(item.id) && !item.locked);
      if (document.items.length + items.length > 32) throw new Error('复制后将超过 32 个组件。');
      for (const item of items) {
        const id = crypto.randomUUID(); ids.push(id);
        document.items.push({ ...item, id, name: `${item.name.slice(0, 76)} 副本`,
          x: Math.min(item.x + 16, document.canvas.width - item.width),
          y: Math.min(item.y + 16, document.canvas.height - item.height) });
      }
    });
    selection = new Set(ids); stage?.syncSelection(); inspector?.render(); renderLayers(); renderState();
  }
  editButtons.push(button(toolbar, '复制实例', duplicate));
  function remove() { edit((document) => { document.items = document.items.filter((item) => !selection.has(item.id) || item.locked); }); }
  editButtons.push(button(toolbar, '删除实例', remove));
  for (const [direction, text] of [[1, '上移一层'], [-1, '下移一层']]) {
    editButtons.push(button(toolbar, text, () => edit((document) => {
      const indices = document.items.map((_, index) => index);
      if (direction > 0) indices.reverse();
      for (const index of indices) {
        const item = document.items[index];
        const other = document.items[index + direction];
        if (!item.locked && selection.has(item.id) && other && !other.locked && !selection.has(other.id)) {
          [document.items[index], document.items[index + direction]] = [other, item];
        }
      }
    })));
  }
  const align = previewElement('select');
  align.setAttribute('aria-label', '对齐方式');
  for (const [value, text] of [['left', '左对齐'], ['center-x', '水平居中'], ['right', '右对齐'],
    ['top', '顶对齐'], ['center-y', '垂直居中'], ['bottom', '底对齐']]) {
    const option = previewElement('option', '', text); option.value = value; align.append(option);
  }
  toolbar.append(align);
  editButtons.push(button(toolbar, '应用对齐', () => edit((document) => alignSceneItems(document, [...selection], align.value))));
  const save = button(footer, '保存场景草稿', async () => {
    stage?.cancelGesture();
    const submitted = session;
    if (await submitted?.save() && session === submitted) report(submitted.getState().dirty ? '已保存本次提交；期间的新修改仍在草稿中。' : '场景草稿已保存，正式输出尚未改变。');
  });
  const publish = button(footer, '发布整套（固定当前外观）', async () => {
    stage?.cancelGesture();
    const blocker = publicationBlocker();
    if (blocker) { report(blocker); return; }
    const submitted = session;
    const sharedTypes = new Set(submitted?.model.getDocument().items
      .filter((item) => item.appearance.mode === 'shared').map((item) => item.type));
    const expectedDefaults = Object.fromEntries(components.filter((component) => sharedTypes.has(component.id))
      .map((component) => {
        const { saved } = component.controller.getState();
        return [component.id, component.projectConfig?.(saved) || saved];
      }));
    if (await submitted?.publish(expectedDefaults) && session === submitted) {
      const pending = publicationBlocker() || (submitted.getState().dirty
        ? '发布期间的新修改仍在场景草稿中，保存后需再次发布。' : '后来修改默认配置，需要再次发布才影响整套输出。');
      report(`已发布版本 ${submitted.getState().publishedVersion}。${pending}`);
    }
  }, 'primary');
  const copy = button(footer, '复制场景来源', async () => {
    const id = session.model.getDocument().id;
    const source = await requestScene('source', undefined, id);
    if (closed || session.model.getDocument().id !== id) return;
    const url = new URL('/scene', localOverlayOrigin());
    url.searchParams.set('id', source.id);
    url.hash = new URLSearchParams({ token: source.token }).toString();
    await copyText(url.href);
    report('场景来源已复制，可添加到 OBS 或哔哩哔哩直播姬的浏览器源。');
  });
  const rotate = button(footer, '停用旧来源', async () => {
    if (!await askConfirmation({ title: '停用旧场景来源', variant: 'caution', confirmLabel: '停用旧来源',
      description: '旧来源将在下次读取时失效。继续后需要重新复制并更新直播软件中的场景来源。' })) return;
    await requestScene('rotate', { id: session.model.getDocument().id });
    report('旧来源已停用，请重新复制场景来源。');
  });
  async function loadScene(id, reload = false) {
    if (!id || loading) return;
    if (reload && session?.getState().dirty && !await askConfirmation({ title: '重新载入场景', variant: 'caution',
      confirmLabel: '放弃修改并重新载入', description: '重新载入会放弃当前未保存修改。请先导出模板备份。' })) return;
    const request = ++operation; loading = true; renderState();
    try {
      let next = sessions.get(id);
      if (reload || !next || (!next.getState().dirty && !next.getState().busy)) {
        const dto = await requestScene('document', undefined, id);
        if (closed || request !== operation) return;
        next?.dispose();
        next = createSceneEditorSession(dto); sessions.set(id, next);
      }
      show(next);
    } finally { loading = false; renderState(); }
  }
  const reload = button(header, '重新载入', () => loadScene(session?.model.getDocument().id, true));
  async function create(document) {
    if (loading) return;
    loading = true; renderState();
    try {
      if (document) document = await requestScene('validate', { document });
      if (closed) return;
      const dto = await requestScene('create', { title: document?.title || '新场景', canvas: document?.canvas || { width: 1920, height: 1080 } });
      if (closed) return;
      const next = createSceneEditorSession(dto);
      if (document) next.model.edit(() => ({ ...document, id: dto.document.id }));
      sessions.set(dto.document.id, next);
      addChoice(dto.document);
      show(next);
    } finally { loading = false; renderState(); }
  }
  const createButton = button(header, '新建场景', () => create());
  const templateImport = mountSceneTemplateImport(dialog, { onImport: create, report });
  const importButton = button(header, '导入模板', () => templateImport.open());
  const exportButton = button(header, '导出模板', () => downloadSceneTemplate(session.model.getDocument()));
  const closeButton = button(header, '关闭', close);
  function addChoice(document) {
    if (!choices.has(document.id)) {
      const option = previewElement('option'); option.value = document.id;
      choices.set(document.id, option); sceneSelect.append(option);
    }
    choices.get(document.id).textContent = document.title;
  }
  function show(next) {
    unsubscribe?.(); inspector?.dispose(); stage?.dispose();
    session = next; selection = new Set();
    cache.selected = session.model.getDocument().id;
    sceneSelect.value = cache.selected;
    stage = mountSceneEditorStage(stageHost, { model: session.model, components, getSelection: () => selection, select, report });
    stage.setZoom(zoom.value); stage.setSnap(snap.checked);
    inspector = mountSceneEditorInspector(inspectorHost, { model: session.model, components, getSelection: () => selection, report });
    unsubscribe = session.subscribe(() => {
      const document = session.model.getDocument();
      selection = new Set([...selection].filter((id) => document.items.some((item) => item.id === id)));
      renderLayers(); renderState();
    });
  }
  function renderState() {
    if (closed) return;
    const state = session?.getState();
    const document = session?.model.getDocument();
    const busy = loading || !!state?.busy;
    const blocker = publicationBlocker();
    sceneSelect.disabled = loading;
    createButton.disabled = importButton.disabled = loading;
    exportButton.disabled = !session;
    reload.disabled = !session || busy;
    save.disabled = !state || busy || state.conflict || !state.dirty;
    publish.disabled = !state || busy || state.conflict || state.dirty || !!blocker;
    copy.disabled = rotate.disabled = !state || busy || !state.publishedVersion;
    undo.disabled = !state?.canUndo; redo.disabled = !state?.canRedo;
    const editable = document?.items.some((item) => selection.has(item.id) && !item.locked);
    for (const node of editButtons) node.disabled = !editable;
    sceneName.disabled = !session;
    for (const input of Object.values(canvasInputs)) input.disabled = !session;
    if (document) {
      sceneName.value = document.title;
      for (const [key, input] of Object.entries(canvasInputs)) input.value = String(document.canvas[key]);
      addChoice(document);
    }
    report(loading ? '正在读取场景…' : state?.error || (state?.busy ? state.busy === 'save' ? '正在保存场景草稿…' : '正在发布整套…'
      : !state ? '创建一个场景，将多个组件编排为一个直播来源。'
        : `${state.dirty ? '有未保存修改' : '草稿已保存'} · ${state.publishedVersion ? `已发布 v${state.publishedVersion}` : '尚未发布'} · ${blocker || '编辑预览包含示例；正式来源使用实际数据。'}`));
  }
  function publicationBlocker() {
    const sharedTypes = new Set(session?.model.getDocument().items
      .filter((item) => item.appearance.mode === 'shared').map((item) => item.type));
    const pending = components.filter((component) => {
      const config = component.controller.getState();
      return sharedTypes.has(component.id) && (!config.loaded || config.loading || config.saving
        || config.dirty || config.conflict || config.error);
    });
    return pending.length ? `${pending.map((component) => component.title).join('、')}的共享默认配置尚未就绪。请等待读取或保存完成；有修改、冲突或错误时，先单独保存或放弃默认配置修改，再发布。` : '';
  }
  function keydown(event) {
    if (event.key === 'Escape' && stage?.isDragging()) { event.preventDefault(); event.stopPropagation(); stage.cancelGesture(); return; }
    if (event.target.closest('input, select, textarea, [contenteditable="true"]') || !session) return;
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        event.preventDefault(); stage?.cancelGesture();
        if (key === 'y' || event.shiftKey) session.model.redo(); else session.model.undo();
      }
      return;
    }
    try {
      if (event.key === 'Delete') { event.preventDefault(); remove(); }
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (direction && selection.size) {
        event.preventDefault(); const step = event.shiftKey ? 8 : 1;
        edit((document) => moveSceneItems(document, [...selection], direction[0] * step, direction[1] * step));
      }
    } catch (error) { report(error.message); }
  }
  async function askConfirmation(options) {
    if (closed || cancelConfirmation) return false;
    const previousFocus = document.activeElement;
    dialog.close();
    dialog.show();
    const answer = showConfirmationDialog(options);
    const backdrop = document.body.lastElementChild;
    cancelConfirmation = () => backdrop.querySelector('.lira-confirm-cancel')?.click();
    try { return await answer && !closed; }
    finally {
      cancelConfirmation = null;
      if (!closed) {
        dialog.close(); dialog.showModal();
        previousFocus?.focus();
      }
    }
  }
  function close() {
    if (closed) return;
    closed = true; operation++;
    cancelConfirmation?.();
    unsubscribe?.(); inspector?.dispose(); stage?.dispose(); templateImport.dispose();
    for (const stop of ownerSubscriptions) stop();
    window.removeEventListener('pagehide', close);
    dialog.close(); dialog.remove(); releaseComponentPreview(handle);
  }
  const handle = { id: 'scene-editor', close, focus: () => closeButton.focus() };
  setActiveComponentPreview(handle);
  const ownerSubscriptions = [];
  for (const [controller, generation] of owners) ownerSubscriptions.push(controller.subscribe((state) => {
    if (closed) return;
    if (state.generation === generation) { renderState(); return; }
    for (const current of sessions.values()) current.dispose();
    cache = null;
    close();
  }));
  sceneSelect.addEventListener('change', () => { void loadScene(sceneSelect.value).catch((error) => report(error.message)); });
  dialog.addEventListener('keydown', keydown);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (stage?.isDragging()) stage.cancelGesture(); else close();
  });
  window.addEventListener('pagehide', close, { once: true });
  dialog.showModal();
  renderLayers(); renderState();
  void (async () => {
    loading = true; renderState();
    try {
      const list = await requestScene('list');
      if (closed) return;
      for (const dto of list) addChoice(dto.document);
      const id = choices.has(cache.selected) ? cache.selected : list[0]?.document.id;
      loading = false;
      if (id) await loadScene(id);
      else renderState();
    } catch (error) { report(error.message); }
    finally { loading = false; if (!closed && !session) {
      createButton.disabled = importButton.disabled = false;
      sceneSelect.disabled = false;
    } }
  })();
  return handle;
}
