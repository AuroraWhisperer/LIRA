import { prepareComponentPreviews } from './component-preview-registry.js';
import { createTextBoxPreview } from './text-box-preview.js';
import { createTextBoxDefaults, TEXT_BOX_SIZE } from '../shared/text-box-config.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { mountComponentPreview, previewElement } from './component-preview-surface.js';
import { validateSceneDocument } from './scene-template.js';
import { copyText } from '../shared/utils.js';
import { sceneSourceUrl } from './scene-source-url.js';

export function initTextBoxes() {
  const root = document.getElementById('textBoxPage');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const get = name => root.querySelector(`[data-text-box="${name}"]`);
  const status = get('status');
  let canvas;
  let selected;
  let panel;
  let preview;
  let stop;
  let listSignature = '';
  let busy = false;
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
    get('save').disabled = !state.loaded || busy;
    get('discard').disabled = !state.dirty || busy;
    get('copy').disabled = !item || busy;
    if (!status.classList.contains('text-box-error')) status.textContent = state.error
      || (busy ? '正在保存并应用…' : state.dirty ? '有未保存修改' : '已保存');
  }
  get('add').addEventListener('click', () => {
    if (!canvas || busy) return;
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
  get('discard').addEventListener('click', () => { status.classList.remove('text-box-error'); canvas?.controller.discard(); });
  get('save').addEventListener('click', async () => {
    if (!canvas || busy || current() && !get('name').reportValidity()) return;
    busy = true; status.classList.remove('text-box-error'); render();
    try { await canvas.publish(); status.textContent = '已保存并应用到直播'; }
    catch (error) { fail(error); }
    finally { busy = false; render(); }
  });
  get('copy').addEventListener('click', async () => {
    if (!canvas || !current()) return;
    try {
      const source = await canvas.source();
      if (!source.itemIds?.includes(selected)) throw new Error('请先保存并应用这个文本框，再复制地址。');
      await copyText(sceneSourceUrl({ ...source, item: selected }));
      status.classList.remove('text-box-error'); status.textContent = '已复制此文本框的直播地址';
    } catch (error) { fail(error); }
  });
  async function load() {
    try {
      status.textContent = '正在读取文本框…';
      canvas = (await prepareComponentPreviews()).find(item => item.id === 'canvas');
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
