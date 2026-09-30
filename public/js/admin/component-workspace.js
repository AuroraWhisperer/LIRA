import { componentSaveMessage } from './component-config-controller.js';
import { createComponentSaveBatch } from './component-save-batch.js';
import { getComponentPreviews } from './component-preview-registry.js';
import { previewElement, mountComponentPreview } from './component-preview-surface.js';
import { getActiveComponentPreview, closeComponentPreview, setActiveComponentPreview,
  releaseComponentPreview } from './component-preview-session.js';

let workspaceSession = null;

function getWorkspaceSession(components) {
  if (workspaceSession?.controllers.size === components.length
    && components.every(({ id, controller }) => workspaceSession.controllers.get(id) === controller)) {
    return workspaceSession;
  }
  workspaceSession?.batch.dispose();
  workspaceSession?.validators.clear();
  const validators = new Map();
  const controllers = new Map(components.map(({ id, controller }) => [id, controller]));
  const batch = createComponentSaveBatch(components.map(({ id, title, controller }) => ({
    id, title, controller, validate: (draft) => validators.get(id)?.(draft),
  })));
  workspaceSession = { controllers, validators, batch };
  return workspaceSession;
}

export function openComponentWorkspace() {
  const active = getActiveComponentPreview('workspace');
  if (active) { active.focus(); return active; }
  closeComponentPreview();
  const components = getComponentPreviews();
  if (components.length !== 4) throw new Error('组件尚未加载完成，请重新打开工作区。');
  const session = getWorkspaceSession(components);
  const dialog = previewElement('dialog', 'component-preview-dialog component-workspace');
  dialog.setAttribute('aria-label', '组件工作区');
  const header = previewElement('header', 'component-preview-heading');
  header.append(previewElement('h2', '', '组件工作区'));
  const closeButton = previewElement('button', 'secondary', '关闭');
  closeButton.type = 'button';
  header.append(closeButton);
  const body = previewElement('div', 'component-workspace-body');
  const navigation = previewElement('nav', 'component-workspace-navigation');
  navigation.setAttribute('aria-label', '选择要调整的组件');
  const previews = previewElement('div', 'component-workspace-previews');
  const inspector = previewElement('aside', 'component-preview-panel component-workspace-inspector');
  inspector.append(previewElement('p', 'component-workspace-target', '编辑目标：当前组件默认配置'));
  const panels = new Map();
  const views = [];
  const surfaces = [];
  const choices = new Map();
  let selected = components[0].id;
  let closed = false;
  let batch;
  function select(id) {
    selected = id;
    for (const [key, panel] of panels) panel.hidden = key !== id;
    for (const [key, choice] of choices) choice.button.setAttribute('aria-pressed', String(key === id));
    for (const article of previews.children) article.classList.toggle('is-selected', article.dataset.component === id);
    render();
  }
  for (const component of components) {
    const button = previewElement('button', 'secondary component-workspace-choice');
    button.type = 'button';
    const status = previewElement('span');
    button.append(previewElement('strong', '', component.title), status);
    button.addEventListener('click', () => select(component.id));
    navigation.append(button);
    choices.set(component.id, { button, status });
    const panel = previewElement('section', 'component-workspace-parameters');
    panel.setAttribute('aria-label', `${component.title}展示参数`);
    panel.append(previewElement('h3', '', component.title));
    inspector.append(panel);
    panels.set(component.id, panel);
    views.push(component.createPanel(panel));
    const article = previewElement('section', 'component-workspace-preview');
    article.dataset.component = component.id;
    const heading = previewElement('button', 'secondary component-workspace-preview-title', component.title);
    heading.type = 'button';
    heading.setAttribute('aria-label', `调整${component.title}`);
    heading.addEventListener('click', () => select(component.id));
    article.append(heading);
    previews.append(article);
    surfaces.push(mountComponentPreview(article, component));
  }
  const footer = previewElement('footer', 'component-preview-footer component-workspace-footer');
  const result = previewElement('p');
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  const discard = previewElement('button', 'secondary', '放弃当前修改');
  const saveCurrent = previewElement('button', 'secondary', '保存当前组件');
  const retry = previewElement('button', 'secondary', '仅重试失败项');
  const saveAll = previewElement('button', 'primary', '保存全部修改');
  for (const button of [discard, saveCurrent, retry, saveAll]) button.type = 'button';
  footer.append(result, discard, saveCurrent, retry, saveAll);
  navigation.append(previewElement('p', 'component-workspace-note',
    '四格排布仅用于检查外观，不改变直播布局。各组件分别保存，失败不会撤销其他组件已保存的修改。'));
  body.append(navigation, previews, inspector);
  dialog.append(header, body, footer);
  document.body.append(dialog);
  batch = session.batch;
  for (const component of components) {
    session.validators.set(component.id, () => {
      const invalid = Array.from(panels.get(component.id).querySelectorAll('input, select, textarea'))
        .find((field) => !field.checkValidity());
      if (!invalid) return '';
      select(component.id);
      invalid.reportValidity();
      return '参数无效，请检查当前组件。';
    });
  }
  function render() {
    if (!batch || closed) return;
    const results = batch.getState();
    const current = components.find((component) => component.id === selected).controller.getState();
    const states = components.map((component) => component.controller.getState());
    const saving = states.some((state) => state.saving);
    for (const component of components) {
      const state = component.controller.getState();
      const outcome = results[component.id];
      choices.get(component.id).status.textContent = state.saving ? '正在保存…'
        : state.error || outcome?.status === 'failed' ? '保存失败 · 草稿保留'
          : outcome?.status === 'not-submitted' ? '未提交'
            : state.dirty ? '有未保存修改' : !state.loaded ? '尚未读取配置'
              : outcome?.status === 'success' ? '本次已保存' : '已保存配置';
    }
    result.textContent = results[selected]?.error || componentSaveMessage(current);
    saveCurrent.disabled = saving || !current.loaded || !current.dirty;
    discard.disabled = saving || !current.dirty;
    saveAll.disabled = saving || !states.some((state) => state.dirty);
    retry.hidden = !Object.values(results).some((outcome) => outcome.status === 'failed');
    retry.disabled = saving;
  }
  const subscriptions = components.map((component) => component.controller.subscribe(render));
  subscriptions.push(batch.subscribe(render));
  function close() {
    if (closed) return;
    closed = true;
    session.validators.clear();
    for (const unsubscribe of subscriptions) unsubscribe();
    for (const view of views) view?.dispose?.();
    for (const surface of surfaces) surface.dispose();
    window.removeEventListener('pagehide', close);
    dialog.close();
    dialog.remove();
    releaseComponentPreview(handle);
  }
  const handle = { id: 'workspace', close, focus: () => closeButton.focus() };
  setActiveComponentPreview(handle);
  closeButton.addEventListener('click', close);
  discard.addEventListener('click', () => components.find((component) => component.id === selected).controller.discard());
  saveCurrent.addEventListener('click', () => { void batch.save([selected]); });
  saveAll.addEventListener('click', () => { void batch.save(); });
  retry.addEventListener('click', () => { void batch.retryFailed(); });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  window.addEventListener('pagehide', close, { once: true });
  select(selected);
  dialog.showModal();
  for (const surface of surfaces) surface.fit();
  return handle;
}
