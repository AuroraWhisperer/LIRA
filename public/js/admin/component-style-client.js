import { previewElement } from './component-preview-surface.js';
import { mountComponentStyleLibrary, openComponentStyleLibrary } from './component-style-library.js';
import { openComponentLibraryManager } from './component-library-manager.js';
import { prepareComponentPreviews } from './component-preview-registry.js';
import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { getActiveComponentPreview } from './component-preview-session.js';
import { validateSceneDocument } from './scene-template.js';
import { loadComponentStyleCss, requestComponentStyles } from './component-style-api.js';
import { componentStyleMedia } from '../shared/component-resource-style.js';
import { mountResourceStyleSettings } from './component-resource-settings-panel.js';

export async function addStyleToCanvas(style) {
  const entries = await prepareComponentPreviews();
  const canvas = entries.find(entry => entry.id === 'canvas');
  if (!canvas?.controller.getState().loaded) throw new Error('画布尚未准备完成，请稍后重试。');
  await getActiveComponentPreview('browser-preview')?.syncCanvas();
  const document = canvas.controller.getState().draft.document;
  if (document.items.filter(item => item.type !== 'text-box').length >= 32) throw new Error('当前场景已满，请在画布中新建场景。');
  const media = componentStyleMedia(style.config);
  const scale = Math.min(1, document.canvas.width / media.width, document.canvas.height / media.height);
  const width = Math.max(32, Math.round(media.width * scale)); const height = Math.max(32, Math.round(media.height * scale));
  const id = crypto.randomUUID();
  document.items.push({ id, type: style.type, name: style.name,
    x: Math.round((document.canvas.width - width) / 2), y: Math.round((document.canvas.height - height) / 2),
    width, height, visible: true, locked: false, appearance: { mode: 'independent', config: structuredClone(style.config) } });
  canvas.controller.edit({ document: validateSceneDocument(document) });
  const component = entries.find(entry => entry.id === style.type) || COMPONENT_PREVIEW_DEFINITIONS[style.type].createPreview();
  openComponentPreview({ ...component, selectedItemId: id });
}

let initialized = false;

export function initComponentStyleLibraries() {
  if (initialized) return;
  initialized = true;
  loadComponentStyleCss();
  const requests = new AbortController();
  const libraries = [];
  const settingsViews = [];
  let manager; let updateEditor;
  document.getElementById('componentLibraryManage')?.addEventListener('click', () => {
    manager = openComponentLibraryManager({ request: requestComponentStyles,
      onUpdate(pack, file) {
        updateEditor = openComponentStyleLibrary({ type: pack.importTarget === 'suite' ? undefined : pack.importTarget,
          suitesOnly: pack.importTarget === 'suite', initialFile: file, updatePack: pack });
      } });
  }, { signal: requests.signal });
  let pendingList;
  function request(action, options) {
    if (action !== 'list') return requestComponentStyles(action, options);
    if (!pendingList) {
      const next = requestComponentStyles('list', { signal: requests.signal }).finally(() => {
        if (pendingList === next) pendingList = null;
      });
      pendingList = next;
    }
    return pendingList;
  }
  const locations = [
    ['#otherClockFeature .clock-style-options', 'clock'],
    ['#liveDanmakuFeature .danmaku-style-options-fixed', 'danmaku'],
    ['#giftWishDisplayStyle', 'gift-wishes'],
    ['#giftFramePanel', 'gift-frame'], ['#guardThanksStyleLibrary', 'guard-thanks'],
    ['#themeForm .style-picker', 'queue'], ['#desktopLyricForm', 'lyrics'],
  ];
  for (const [selector, type] of locations) {
    const host = document.querySelector(selector);
    if (!host || host.querySelector('[data-local-styles]')) continue;
    const list = previewElement('div', ['clock', 'danmaku', 'gift-wishes'].includes(type) ? 'component-style-inline-host' : 'component-style-list');
    list.dataset.localStyles = type;
    const wishes = type === 'gift-wishes';
    const hasResourceSettings = style => type !== 'gift-frame' && Boolean(style?.config.resourceStyle);
    (wishes ? host.querySelector('.gift-wish-styles') : host).append(list);
    const feature = host.closest('#otherClockFeature, #liveDanmakuFeature, #themeForm') || host;
    const previewWish = style => host.dispatchEvent(new CustomEvent('gift-wish:style', { detail: style }));
    const settings = previewElement('div', 'resource-style-settings-host');
    settings.dataset.resourceStyleSettings = type;
    (host.closest('form, .danmaku-style-picker') || host).after(settings);
    const editors = new Map();
    let selectedId = '';
    let nativeSelection = [];
    function select(style) {
      const nextId = hasResourceSettings(style) ? style.id : '';
      if (!selectedId && nextId) {
        nativeSelection = [...feature.querySelectorAll('[data-clock-style-option], [data-danmaku-style], [data-overlay-style]')]
          .filter(button => !button.closest('.resource-style-settings'))
          .map(button => ({ button, active: button.classList.contains('active'), pressed: button.getAttribute('aria-pressed') }));
      }
      selectedId = nextId;
      for (const { button, active, pressed } of nativeSelection) {
        button.classList.toggle('active', !selectedId && active);
        if (pressed !== null) button.setAttribute('aria-pressed', selectedId ? 'false' : pressed);
      }
      if (!selectedId) nativeSelection = [];
      if (selectedId && !editors.has(selectedId)) editors.set(selectedId,
        mountResourceStyleSettings(settings, { style, request, onUse: addStyleToCanvas, onPreview: wishes ? previewWish : undefined }));
      for (const [id, editor] of editors) editor.show(id === selectedId);
      feature.classList.toggle('has-resource-style', Boolean(selectedId));
      for (const card of list.querySelectorAll('[data-custom-style-id]')) {
        if (!wishes) card.querySelector('.component-style-select').setAttribute('aria-pressed', String(card.dataset.customStyleId === selectedId));
      }
    }
    settingsViews.push({ dispose() { for (const editor of editors.values()) editor.dispose(); settings.remove(); } });
    feature.addEventListener('click', event => {
      if (event.target.closest('[data-clock-style-option], [data-danmaku-style], [data-overlay-style]')) select(null);
    }, { signal: requests.signal, capture: true });
    host.addEventListener('change', event => {
      if (wishes && event.target.matches('input[type="radio"]')) select(null);
    }, { signal: requests.signal });
    libraries.push(mountComponentStyleLibrary(list, { type, request, inline: true,
      actionLabel: wishes ? '预览样式' : '添加到画布',
      onUse: style => {
        select(style);
        if (wishes && !style.config.resourceStyle) previewWish(style);
        else if (!hasResourceSettings(style)) return addStyleToCanvas(style);
      },
      renderList({ cards }) {
        for (const { style, card } of cards) {
          const button = card.querySelector('.component-style-select');
          if (wishes) {
            button.firstElementChild.remove();
            button.setAttribute('aria-pressed', String(style.id === host.dataset.previewStyleId));
          } else if (hasResourceSettings(style)) {
            button.setAttribute('aria-label', `调整样式：${style.name}`);
            button.setAttribute('aria-pressed', String(style.id === selectedId));
          }
          editors.get(style.id)?.update(style);
        }
        for (const [id, editor] of editors) if (!cards.some(({ style }) => style.id === id)) {
          editor.dispose(); editors.delete(id);
          if (id === selectedId) select(null);
        }
        if (wishes && host.dataset.previewStyleId && !cards.some(({ style }) => style.id === host.dataset.previewStyleId)) {
          host.dispatchEvent(new CustomEvent('gift-wish:style', { detail: null }));
        }
      },
    }));
  }
  const refresh = () => { for (const library of libraries) void library.refresh(); };
  window.addEventListener('focus', refresh, { signal: requests.signal });
  window.addEventListener('component-styles:changed', () => { pendingList = null; refresh(); }, { signal: requests.signal });
  window.addEventListener('pagehide', () => {
    requests.abort();
    manager?.dispose(); updateEditor?.dispose();
    for (const library of libraries) library.dispose();
    for (const view of settingsViews) view.dispose();
  }, { once: true });
}
