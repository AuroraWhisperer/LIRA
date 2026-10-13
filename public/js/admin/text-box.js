import { prepareComponentPreviews } from './component-preview-registry.js';
import { createTextBoxPreview } from './text-box-preview.js';
import { createTextBoxDefaults, TEXT_BOX_SIZE } from '../shared/text-box-config.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { mountComponentPreview, previewElement } from './component-preview-surface.js';
import { validateSceneDocument } from './scene-template.js';
import { copyText } from '../shared/utils.js';
import { sceneSourceUrl } from './scene-source-url.js';
import { showConfirmationDialog } from '../shared/confirmation-dialog.js';
import { getCanvasPublicationEntries } from './component-preview-publication.js';

export function initTextBoxes() {
  const root = document.getElementById('textBoxPage');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const get = name => root.querySelector(`[data-text-box="${name}"]`);
  const status = get('status');
  let canvas;
  let components;
  let selected;
  let panel;
  let preview;
  let stop;
  let listSignature = '';
  let busy = false;
  let busyMessage = '';
  let disposed = false;
  const definition = createTextBoxPreview();
  function fail(error) { status.textContent = error.message; status.classList.add('text-box-error'); }
  function edit(change) {
    try {
      const document = canvas.controller.getState().draft.document;
      change(document);
      canvas.controller.edit({ document: validateSceneDocument(document) });
      status.classList.remove('text-box-error');
    } catch (error) { fail(error); }
  }
  const current = () => canvas?.controller.getState().draft.document.items.find(item => item.id === selected);
  function otherSceneChanges(state) {
    const withoutTextBoxes = document => ({ ...document, items: document.items.filter(item => item.type !== 'text-box') });
    return JSON.stringify(withoutTextBoxes(state.draft.document)) !== JSON.stringify(withoutTextBoxes(state.saved.document));
  }
  async function confirmSceneAction(action) {
    const state = canvas.controller.getState();
    const sharedChanges = action === 'save' && getCanvasPublicationEntries(components)
      .some(entry => entry.id !== 'canvas' && entry.controller.getState().dirty);
    const otherChanges = otherSceneChanges(state) || sharedChanges;
    const changesOutput = action === 'save' && state.activeSceneId && state.activeSceneId !== state.draft.document.id;
    if (!otherChanges && !changesOutput) return true;
    const snapshot = () => {
      const current = canvas.controller.getState();
      return JSON.stringify([current.generation, current.draft, current.activeSceneId,
        ...(action === 'save' ? getCanvasPublicationEntries(components).map(entry => {
          const next = entry.controller.getState();
          return [entry.id, next.generation, next.draft];
        }) : [])]);
    };
    const before = snapshot();
    busyMessage = '等待确认…'; render();
    const confirmed = await showConfirmationDialog({
      title: action === 'save' ? '应用整个场景？' : '放弃整个场景的修改？',
      description: action === 'save'
        ? `${changesOutput ? `当前输出是“${state.activeSceneTitle}”，将切换为“${state.draft.document.title}”。` : ''}${otherChanges ? '场景中还有其他未保存修改，也会一起保存并应用。' : ''}`
        : `“${state.draft.document.title}”中还有文本框以外的修改，也会一起放弃。当前已发布的画面不变。`,
      confirmLabel: action === 'save' ? '保存并应用' : '放弃修改',
      variant: action === 'save' ? 'caution' : 'destructive',
    });
    if (!confirmed || disposed) return false;
    if (before !== snapshot()) {
      throw new Error('场景已变化，请核对后重新操作。');
    }
    return true;
  }
  function select(id) {
    selected = id;
    panel?.dispose(); preview?.dispose();
    panel = preview = null;
    get('editor').replaceChildren(); get('preview').replaceChildren();
    const item = current();
    get('detail').hidden = !item;
    get('empty').hidden = Boolean(item);
    if (!item) return;
    get('name').value = item.name;
    const getState = () => {
      const state = canvas.controller.getState();
      const item = state.draft.document.items.find(entry => entry.id === id);
      return { ...state, loaded: state.loaded && Boolean(item) && !item.locked,
        draft: item?.appearance.config || createTextBoxDefaults() };
    };
    const target = { getState,
      edit(config) { edit(document => {
        const item = document.items.find(entry => entry.id === id);
        if (item && !item.locked) Object.assign(item.appearance.config, config);
      }); },
      subscribe(listener) { return canvas.controller.subscribe(() => listener(getState())); },
    };
    panel = definition.createPanel(get('editor'), target);
    preview = mountComponentPreview(get('preview'), { ...definition, controller: target,
      dataLabel: '',
      size: () => { const item = current(); return item ? [item.width, item.height] : TEXT_BOX_SIZE; } });
    const background = get('preview').querySelector('select');
    background.value = 'dark'; background.dispatchEvent(new Event('change'));
    render();
    get('list').querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function render() {
    const state = canvas.controller.getState();
    const items = state.draft.document.items.filter(item => item.type === 'text-box');
    const textBoxesChanged = state.dirty && JSON.stringify(items)
      !== JSON.stringify(state.saved.document.items.filter(item => item.type === 'text-box'));
    get('scene').textContent = `正在编辑：${state.presets.length ? state.draft.document.title : '暂无场景'} / 当前输出：${state.activeSceneId ? state.activeSceneTitle : '尚未应用'}`;
    get('library').hidden = !items.length;
    if (!items.some(item => item.id === selected)) { select(items[0]?.id); }
    const signature = JSON.stringify(items.map(item => [item.id, item.name, item.visible, item.locked]));
    if (signature !== listSignature) {
      listSignature = signature;
      const list = get('list'); list.replaceChildren();
      for (const item of items) {
        const button = previewElement('button', 'text-box-list-item', item.name);
        button.type = 'button'; button.dataset.itemId = item.id;
        button.addEventListener('click', () => select(item.id));
        list.append(button);
      }
    }
    for (const button of get('list').children) button.setAttribute('aria-pressed', String(button.dataset.itemId === selected));
    const item = current();
    if (item && document.activeElement !== get('name')) get('name').value = item.name;
    get('name').disabled = !item || item.locked;
    get('remove').disabled = !item || item.locked || busy;
    get('duplicate').disabled = !item || busy;
    get('save').disabled = !state.loaded || busy || (!items.length && !state.dirty);
    get('discard').disabled = !state.dirty || busy;
    get('copy').disabled = !item || busy;
    if (!status.classList.contains('text-box-error')) status.textContent = state.error
      || (busy ? busyMessage : textBoxesChanged ? '文本框有未保存修改'
        : state.dirty ? '场景其他内容有未保存修改' : items.length ? '已保存' : '');
  }
  get('add').addEventListener('click', async () => {
    if (!canvas || busy) return;
    if (!canvas.controller.getState().presets.length) {
      busy = true; busyMessage = '正在新建场景…';
      try { await canvas.preset({ action: 'create', title: '场景 1', duplicate: false }); }
      catch (error) { fail(error); return; }
      finally { busy = false; render(); }
    }
    const id = crypto.randomUUID();
    edit(document => {
      const width = Math.min(TEXT_BOX_SIZE[0], document.canvas.width);
      const height = Math.min(TEXT_BOX_SIZE[1], document.canvas.height);
      document.items.push({ id, type: 'text-box', name: `文本框 ${document.items.filter(item => item.type === 'text-box').length + 1}`,
        x: Math.round((document.canvas.width - width) / 2), y: Math.round((document.canvas.height - height) / 2),
        width, height, visible: true, locked: false, appearance: { mode: 'independent', config: createTextBoxDefaults() } });
    });
    select(id);
  });
  get('name').addEventListener('change', () => {
    if (!get('name').reportValidity()) return;
    edit(document => { const item = document.items.find(entry => entry.id === selected); if (item && !item.locked) item.name = get('name').value.trim(); });
  });
  get('duplicate').addEventListener('click', () => {
    const item = current(); if (!item || busy) return;
    const copy = structuredClone(item); copy.id = crypto.randomUUID(); copy.name = `${item.name.slice(0, 75)} 副本`; copy.locked = false;
    edit(document => document.items.push(copy)); select(copy.id);
  });
  get('remove').addEventListener('click', () => {
    if (current()?.locked || busy) return;
    edit(document => { document.items = document.items.filter(item => item.id !== selected); });
  });
  get('canvas').addEventListener('click', () => openComponentPreview({ ...definition, selectedItemId: selected }));
  get('discard').addEventListener('click', async () => {
    if (!canvas || busy) return;
    busy = true; busyMessage = '正在放弃修改…'; render();
    try {
      if (await confirmSceneAction('discard')) { status.classList.remove('text-box-error'); canvas.controller.discard(); }
    } catch (error) { fail(error); }
    finally { busy = false; render(); }
  });
  get('save').addEventListener('click', async () => {
    if (!canvas || busy || current() && !get('name').reportValidity()) return;
    busy = true; busyMessage = '正在保存并应用…'; status.classList.remove('text-box-error'); render();
    try {
      if (await confirmSceneAction('save')) {
        busyMessage = '正在保存并应用…'; render();
        await canvas.publish(); status.textContent = '已保存并应用到直播';
      }
    }
    catch (error) { fail(error); }
    finally { busy = false; render(); }
  });
  get('copy').addEventListener('click', async () => {
    if (!canvas || !current()) return;
    try {
      const source = await canvas.source();
      if (!source.itemIds?.includes(selected)) throw new Error('请先保存并应用这个文本框，再复制地址。');
      await copyText(sceneSourceUrl({ ...source, item: selected }));
      const size = source.itemSizes?.[selected];
      status.classList.remove('text-box-error'); status.textContent = `已复制此文本框的直播地址${size ? `；浏览器源尺寸设为 ${size.width} × ${size.height}` : ''}`;
    } catch (error) { fail(error); }
  });
  async function load() {
    try {
      status.textContent = '正在读取文本框…';
      components = await prepareComponentPreviews();
      canvas = components.find(item => item.id === 'canvas');
      if (disposed) return;
      if (!canvas) throw new Error('场景尚未就绪，请重试。');
      get('retry').hidden = true;
      stop = canvas.controller.subscribe(render);
      get('add').disabled = false;
    } catch (error) { if (!disposed) { fail(error); get('retry').hidden = false; } }
  }
  get('retry').addEventListener('click', () => { get('retry').hidden = true; void load(); });
  window.addEventListener('pagehide', () => { disposed = true; stop?.(); panel?.dispose(); preview?.dispose(); }, { once: true });
  void load();
}
