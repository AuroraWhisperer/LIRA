import { prepareComponentPreviews } from './component-preview-registry.js';
import { createTextBoxPreview } from './text-box-preview.js';
import { createRejectedTextBoxEdits } from './rejected-text-box-edits.js';
import { createTextBoxDefaults, TEXT_BOX_SIZE } from '../shared/text-box-config.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { mountComponentPreview } from './component-preview-surface.js';
import { previewElement } from './component-preview-elements.js';
import { validateSceneDocument } from './scene-template.js';
import { copyText, toast } from '../shared/utils.js';
import { eventBus } from '../shared/event-bus.js';
import { sceneSourceUrl } from './scene-source-url.js';
import { showConfirmationDialog } from '../shared/confirmation-dialog.js';
import { getCanvasPublicationEntries } from './component-preview-publication.js';

const BACKDROP_MODES = [
  ['checker', '透明棋盘底'],
  ['dark', '深色底'],
  ['light', '浅色底'],
];

export function initTextBoxes() {
  const root = document.getElementById('textBoxPage');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const get = name => root.querySelector(`[data-text-box="${name}"]`);
  const status = get('status');
  let canvas;
  let components;
  let selected;
  let selectedSceneId;
  let panel;
  let preview;
  let sizeBadge;
  let stop;
  let stopPublished;
  let listSignature = '';
  let busy = false;
  let busyMessage = '';
  let disposed = false;
  let publishedSource = null;
  let sourceError = '';
  let sourceRequestId = 0;
  let lastActiveSceneId;
  let copyTimer = 0;
  const definition = createTextBoxPreview();
  const rejectedEdits = createRejectedTextBoxEdits();

  function clearCopyFeedback() {
    window.clearTimeout(copyTimer);
    copyTimer = 0;
    const label = get('copy-label');
    if (label) label.textContent = '复制地址';
  }

  function fail(error) {
    status.textContent = error.message;
    status.classList.add('text-box-error');
    status.dataset.state = 'error';
  }

  function edit(change, onError = fail) {
    try {
      const document = canvas.controller.getState().draft.document;
      change(document);
      canvas.controller.edit({ document: validateSceneDocument(document) });
      status.classList.remove('text-box-error');
      return true;
    } catch (error) { onError(error); return false; }
  }

  const current = () => canvas?.controller.getState().draft.document.items.find(item => item.id === selected);

  function otherSceneChanges(state) {
    const savedIds = new Set(state.saved.document.items.map(item => item.id));
    const draftIds = new Set(state.draft.document.items.map(item => item.id));
    const layout = document => {
      const textBelow = [];
      return { ...document, items: document.items.flatMap(item => {
        if (item.type !== 'text-box') return [{ item, textBelow: [...textBelow].sort() }];
        if (savedIds.has(item.id) && draftIds.has(item.id)) textBelow.push(item.id);
        return [];
      }) };
    };
    return JSON.stringify(layout(state.draft.document)) !== JSON.stringify(layout(state.saved.document));
  }

  async function refreshSource() {
    if (!canvas || disposed) return null;
    const state = canvas.controller.getState();
    if (!state.activeSceneId) {
      sourceRequestId += 1;
      publishedSource = null;
      sourceError = '';
      render();
      return null;
    }
    const requestId = ++sourceRequestId;
    try {
      const source = await canvas.source();
      if (disposed || requestId !== sourceRequestId) return null;
      publishedSource = source;
      sourceError = '';
      render();
      return source;
    } catch (error) {
      if (disposed || requestId !== sourceRequestId) return null;
      publishedSource = null;
      sourceError = error.message || '独立地址读取失败';
      render();
      return null;
    }
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

  function mountStageOverlay(previewHost) {
    const stage = previewHost.querySelector('.component-preview-stage');
    const selectInput = previewHost.querySelector('.component-preview-toolbar select');
    if (!stage || !selectInput) return;
    const switcher = previewElement('div', 'text-box-backdrop-switcher');
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', '预览底色');
    const buttons = BACKDROP_MODES.map(([mode, label]) => {
      const button = previewElement('button', `text-box-backdrop-dot text-box-backdrop-dot--${mode}`);
      button.type = 'button';
      button.dataset.backdrop = mode;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => {
        selectInput.value = mode;
        selectInput.dispatchEvent(new Event('change'));
        syncBackdropButtons();
      });
      switcher.append(button);
      return button;
    });
    const syncBackdropButtons = () => {
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(button.dataset.backdrop === selectInput.value));
      }
    };
    selectInput.addEventListener('change', syncBackdropButtons);
    selectInput.value = 'checker';
    selectInput.dispatchEvent(new Event('change'));
    syncBackdropButtons();
    sizeBadge = previewElement('span', 'text-box-size-badge');
    stage.append(switcher, sizeBadge);
  }

  function select(id) {
    const sceneId = canvas.controller.getState().draft.document.id;
    if (panel && selectedSceneId === sceneId && selected === id) return;
    selectedSceneId = sceneId;
    selected = id;
    clearCopyFeedback();
    panel?.dispose(); preview?.dispose();
    panel = preview = sizeBadge = null;
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
      edit(config, { onError } = {}) { return edit(document => {
        const item = document.items.find(entry => entry.id === id);
        if (item && !item.locked) Object.assign(item.appearance.config, config);
      }, onError); },
      subscribe(listener) { return canvas.controller.subscribe(() => listener(getState())); },
    };
    panel = definition.createPanel(get('editor'), target, { settingsHost: get('settings'),
      rejectedEdits: rejectedEdits.forScene(sceneId), itemId: id, onValidityChange: render });
    preview = mountComponentPreview(get('preview'), { ...definition, controller: target,
      dataLabel: '', framed: true,
      size: () => { const item = current(); return item ? [item.width, item.height] : TEXT_BOX_SIZE; } });
    mountStageOverlay(get('preview'));
    render();
    get('list').querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderSourceBar(state, item) {
    const bar = get('source-bar');
    const urlButton = get('source-url');
    const pendingText = get('source-pending');
    const copyButton = get('copy');
    const publishButton = get('source-publish');
    if (!item) return;
    const isPublished = Boolean(publishedSource?.itemIds?.includes(item.id));
    if (isPublished) {
      const url = sceneSourceUrl({ ...publishedSource, item: item.id });
      const size = publishedSource.itemSizes?.[item.id];
      bar.dataset.sourceState = 'ready';
      urlButton.textContent = url;
      urlButton.title = size
        ? `点击复制独立浏览器源地址（建议尺寸 ${size.width} × ${size.height}）\n${url}`
        : `点击复制独立浏览器源地址\n${url}`;
      urlButton.hidden = false;
      urlButton.disabled = busy;
      pendingText.hidden = true;
      copyButton.hidden = false;
      copyButton.disabled = busy;
      publishButton.hidden = true;
      return;
    }
    if (sourceError && state.activeSceneId) {
      bar.dataset.sourceState = 'error';
      urlButton.hidden = true;
      pendingText.textContent = '独立地址暂不可用，可点击右侧重试复制';
      pendingText.hidden = false;
      copyButton.hidden = false;
      copyButton.disabled = busy;
      publishButton.hidden = true;
      return;
    }
    bar.dataset.sourceState = 'pending';
    urlButton.hidden = true;
    pendingText.textContent = '保存并应用后生成此文本框专属地址';
    pendingText.hidden = false;
    copyButton.hidden = true;
    copyButton.disabled = true;
    publishButton.hidden = false;
    publishButton.disabled = !state.loaded || busy || Boolean(rejectedEdits.messageFor(state.draft.document));
  }

  function render() {
    const state = canvas.controller.getState();
    if (lastActiveSceneId !== undefined && lastActiveSceneId !== state.activeSceneId) {
      lastActiveSceneId = state.activeSceneId;
      if (!state.activeSceneId) { publishedSource = null; sourceError = ''; }
      else if (!busy) void refreshSource();
    } else if (lastActiveSceneId === undefined) {
      lastActiveSceneId = state.activeSceneId;
    }
    const items = state.draft.document.items.filter(item => item.type === 'text-box');
    const textBoxesChanged = state.dirty && JSON.stringify(items)
      !== JSON.stringify(state.saved.document.items.filter(item => item.type === 'text-box'));
    const sceneTitle = state.presets.length ? state.draft.document.title : '暂无场景';
    const sceneMismatch = Boolean(state.activeSceneId && state.activeSceneId !== state.draft.document.id);
    get('scene-context').hidden = !sceneMismatch;
    get('scene').textContent = sceneMismatch
      ? `编辑：${sceneTitle} · 当前输出：${state.activeSceneTitle}` : '';
    get('library').hidden = !items.length;
    get('add').classList.toggle('is-compact', items.length > 0);
    get('empty-add').disabled = get('add').disabled || busy;
    if (selectedSceneId !== state.draft.document.id || !items.some(item => item.id === selected)) select(items[0]?.id);
    const publishedIds = new Set(publishedSource?.itemIds || []);
    const signature = JSON.stringify(items.map(item => [item.id, item.name, item.visible, item.locked, publishedIds.has(item.id)]));
    if (signature !== listSignature) {
      listSignature = signature;
      const list = get('list'); list.replaceChildren();
      for (const item of items) {
        const button = previewElement('button', 'text-box-list-item');
        button.type = 'button';
        button.dataset.itemId = item.id;
        button.dataset.published = String(publishedIds.has(item.id));
        const dot = previewElement('span', 'text-box-tab-dot');
        dot.setAttribute('aria-hidden', 'true');
        const label = previewElement('span', 'text-box-tab-name', item.name);
        button.append(dot, label);
        button.addEventListener('click', () => select(item.id));
        list.append(button);
      }
    }
    for (const button of get('list').querySelectorAll('.text-box-list-item')) {
      button.setAttribute('aria-pressed', String(button.dataset.itemId === selected));
    }
    const item = current();
    if (item && document.activeElement !== get('name')) get('name').value = item.name;
    if (item && sizeBadge) sizeBadge.textContent = `${Math.round(item.width)} × ${Math.round(item.height)}`;
    get('name').disabled = !item || item.locked;
    get('remove').disabled = !item || item.locked || busy;
    get('duplicate').disabled = !item || busy;
    const rejection = rejectedEdits.messageFor(state.draft.document);
    get('save').disabled = !state.loaded || busy || Boolean(rejection) || (!items.length && !state.dirty);
    get('discard').disabled = (!state.dirty && !rejection) || busy;
    renderSourceBar(state, item);
    if (rejection) {
      status.textContent = rejection;
      status.dataset.state = 'error';
    } else if (!status.classList.contains('text-box-error')) {
      if (state.error) {
        status.textContent = state.error;
        status.dataset.state = 'error';
      } else if (busy) {
        status.textContent = busyMessage;
        status.dataset.state = 'busy';
      } else if (textBoxesChanged) {
        status.textContent = '未保存';
        status.dataset.state = 'dirty';
      } else if (state.dirty) {
        status.textContent = '场景有未保存修改';
        status.dataset.state = 'dirty';
      } else if (items.length) {
        status.textContent = '已保存';
        status.dataset.state = 'saved';
      } else {
        status.textContent = '';
        status.dataset.state = 'idle';
      }
    }
  }

  async function addNewTextBox() {
    if (!canvas || busy) return;
    if (!canvas.controller.getState().presets.length) {
      busy = true; busyMessage = '正在新建场景…'; render();
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
  }

  async function saveAndApply() {
    if (!canvas || busy || rejectedEdits.messageFor(canvas.controller.getState().draft.document) || current() && !get('name').reportValidity()) return;
    busy = true; busyMessage = '正在保存并应用…'; status.classList.remove('text-box-error'); render();
    try {
      if (await confirmSceneAction('save')) {
        if (rejectedEdits.messageFor(canvas.controller.getState().draft.document)) return;
        busyMessage = '正在保存并应用…'; render();
        await canvas.publish();
        await refreshSource();
      }
    } catch (error) { fail(error); }
    finally { busy = false; render(); }
  }

  get('add').addEventListener('click', () => { void addNewTextBox(); });
  get('empty-add').addEventListener('click', () => { void addNewTextBox(); });
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
  get('copy').addEventListener('click', () => { void copySource(selected); });
  get('source-url').addEventListener('click', () => { void copySource(selected); });
  get('source-publish').addEventListener('click', () => { void saveAndApply(); });
  get('discard').addEventListener('click', async () => {
    if (!canvas || busy) return;
    busy = true; busyMessage = '正在放弃修改…'; render();
    try {
      if (await confirmSceneAction('discard')) {
        status.classList.remove('text-box-error');
        rejectedEdits.forScene(canvas.controller.getState().draft.document.id).clear();
        panel?.discardPendingEdit();
        canvas.controller.discard();
      }
    } catch (error) { fail(error); }
    finally { busy = false; render(); }
  });
  get('save').addEventListener('click', () => { void saveAndApply(); });

  async function copySource(itemId) {
    if (!canvas || busy) return;
    const item = canvas.controller.getState().draft.document.items.find(entry => entry.id === itemId);
    if (!item) return;
    const name = item.name;
    try {
      const source = await canvas.source();
      publishedSource = source;
      sourceError = '';
      if (!source.itemIds?.includes(itemId)) throw new Error('请先保存并应用这个文本框，再复制地址。');
      const size = source.itemSizes?.[itemId];
      await copyText(sceneSourceUrl({ ...source, item: itemId }));
      const message = `已复制「${name}」的独立浏览器源${size ? ` · 尺寸 ${size.width} × ${size.height}` : ''}`;
      status.classList.remove('text-box-error');
      status.textContent = message;
      status.dataset.state = 'saved';
      toast(message);
      clearCopyFeedback();
      const label = get('copy-label');
      if (label) {
        label.textContent = '已复制';
        copyTimer = window.setTimeout(() => { label.textContent = '复制地址'; copyTimer = 0; }, 1800);
      }
      renderSourceBar(canvas.controller.getState(), item);
    } catch (error) { fail(error); }
  }

  async function load() {
    try {
      status.textContent = '正在读取文本框…';
      status.dataset.state = 'busy';
      components = await prepareComponentPreviews();
      canvas = components.find(item => item.id === 'canvas');
      if (disposed) return;
      if (!canvas) throw new Error('场景尚未就绪，请重试。');
      get('retry').hidden = true;
      get('add').disabled = false;
      get('empty-add').disabled = false;
      stop = canvas.controller.subscribe(render);
      stopPublished = eventBus.on('scene:published', () => { void refreshSource(); });
      if (canvas.controller.getState().activeSceneId) void refreshSource();
    } catch (error) { if (!disposed) { fail(error); get('retry').hidden = false; } }
  }
  get('retry').addEventListener('click', () => { get('retry').hidden = true; void load(); });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearCopyFeedback();
    stop?.();
    stopPublished?.();
    panel?.dispose();
    preview?.dispose();
  }, { once: true });
  void load();
}
