import { openOrCreateCanvasItem } from './canvas-item-entry.js';
import { previewElement } from './component-preview-elements.js';
import { mountComponentStyleLibrary, openComponentStyleLibrary } from './component-style-library.js';
import { openComponentLibraryManager } from './component-library-manager.js';
import { loadComponentStyleCss, requestComponentStyles } from './component-style-api.js';
import { componentStyleMedia } from '../shared/component-resource-style.js';
import { mountResourceStyleSettings } from './component-resource-settings-panel.js';
import { renderGiftFrameStyleState } from './gift-frame.js';
import { renderGiftFrameStyles } from './gift-frame-styles.js';
import { isPanelVisible } from './panel-visibility.js';

export async function addStyleToCanvas(style, { previewData, reuseExisting = false } = {}) {
  const styleKey = config => config?.resourceStyle?.id || config?.mediaStyle?.id;
  return openOrCreateCanvasItem({ type: style.type, previewData,
    findItem: items => reuseExisting && styleKey(style.config) && items.find(item => item.type === style.type
      && styleKey(item.appearance.config) === styleKey(style.config)),
    createItem(document, component) {
      const media = componentStyleMedia(style.config);
      const [sourceWidth, sourceHeight] = media ? [media.width, media.height] : component.size(style.config);
      const scale = Math.min(1, document.canvas.width / sourceWidth, document.canvas.height / sourceHeight);
      const width = Math.max(32, Math.round(sourceWidth * scale)); const height = Math.max(32, Math.round(sourceHeight * scale));
      return { id: crypto.randomUUID(), type: style.type, name: style.name,
        x: Math.round((document.canvas.width - width) / 2), y: Math.round((document.canvas.height - height) / 2),
        width, height, visible: true, locked: false, appearance: { mode: 'independent', config: structuredClone(style.config) } };
    },
  });
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
      const next = requestComponentStyles('list', { signal: requests.signal }).then(packs => {
        if (pendingList === next) renderGiftFrameStyleState(packs);
        return packs;
      }, error => {
        if (pendingList === next) renderGiftFrameStyleState(null);
        throw error;
      }).finally(() => {
        if (pendingList === next) pendingList = null;
      });
      pendingList = next;
    }
    return pendingList;
  }
  const locations = [
    ['#otherClockFeature .clock-style-options', 'clock'],
    ['#danmakuImportedStyles', 'danmaku'],
    ['#giftWishDisplayStyle', 'gift-wishes'],
    ['#giftFrameStyleLibrary', 'gift-frame'], ['#guardThanksStyleLibrary', 'guard-thanks'],
    ['#themeForm .style-picker', 'queue'],
  ];
  for (const [selector, type] of locations) {
    const host = document.querySelector(selector);
    if (!host || host.querySelector('[data-local-styles]')) continue;
    const list = previewElement('div', ['clock', 'danmaku', 'gift-wishes', 'gift-frame'].includes(type) ? 'component-style-inline-host' : 'component-style-list');
    list.dataset.localStyles = type;
    const wishes = type === 'gift-wishes';
    const guardThanks = type === 'guard-thanks';
    const hasResourceSettings = style => type !== 'gift-frame' && Boolean(style?.config.resourceStyle);
    (wishes ? host.querySelector('.gift-wish-styles') : host).append(list);
    const feature = host.closest('#otherClockFeature, #liveDanmakuFeature, #themeForm') || host;
    const previewWish = style => host.dispatchEvent(new CustomEvent('gift-wish:style', { detail: style }));
    const settings = previewElement('div', 'resource-style-settings-host');
    settings.dataset.resourceStyleSettings = type;
    if (!guardThanks) (host.closest('form, .danmaku-style-picker') || host).after(settings);
    const editors = new Map();
    let selectedId = '';
    let nativeSelection = [];
    function select(style) {
      const nextId = hasResourceSettings(style) ? style.id : '';
      if (!selectedId && nextId) {
        nativeSelection = [...feature.querySelectorAll('[data-clock-style-option], [data-danmaku-style], [data-recent-danmaku-style], [data-overlay-style]')]
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
        if (!wishes) card.querySelector('.component-style-select')?.setAttribute('aria-pressed', String(card.dataset.customStyleId === selectedId));
      }
    }
    settingsViews.push({ dispose() { for (const editor of editors.values()) editor.dispose(); settings.remove(); } });
    feature.addEventListener('click', event => {
      if (event.target.closest('[data-clock-style-option], [data-danmaku-style], [data-overlay-style]')) select(null);
    }, { signal: requests.signal, capture: true });
    host.addEventListener('change', event => {
      if (wishes && event.target.matches('input[type="radio"]')) select(null);
    }, { signal: requests.signal });
    const library = mountComponentStyleLibrary(list, { type, request, inline: true,
      actionLabel: wishes ? '预览样式' : '添加到画布',
      onUse: style => {
        select(style);
        if (wishes && !style.config.resourceStyle) previewWish(style);
        else if (!hasResourceSettings(style)) return addStyleToCanvas(style);
      },
      renderList({ cards, add }) {
        // 全屏礼物感谢：每个导入样式一张效果卡片，与内置效果同列。
        if (type === 'gift-frame') return renderGiftFrameStyles({ cards, add, use: addStyleToCanvas });
        if (type === 'danmaku') {
          add.className = 'secondary';
          add.textContent = '添加样式';
          host.closest('dialog').querySelector('.danmaku-library-actions').append(add);
        }
        for (const { style, card } of cards) {
          const button = card.querySelector('.component-style-select');
          if (guardThanks && hasResourceSettings(style)) {
            const remove = card.querySelector('.component-style-delete');
            button.remove();
            if (!editors.has(style.id)) editors.set(style.id,
              mountResourceStyleSettings(card, { style, request, onUse: addStyleToCanvas, compactGuardThanks: true }));
            const editor = editors.get(style.id);
            card.append(editor.element);
            if (remove) {
              editor.element.querySelector('.guard-thanks-remove')?.remove();
              remove.className = 'secondary guard-thanks-remove'; remove.textContent = '移除';
              editor.element.querySelector('.component-toolbar-group').prepend(remove);
            }
            editor.update(style);
            continue;
          }
          if (guardThanks) card.classList.add('guard-thanks-card', 'guard-thanks-media-card');
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
    });
    libraries.push({ library, visible: () => isPanelVisible(list) || (selectedId && isPanelVisible(settings)) });
  }
  let changeTimer;
  window.addEventListener('component-styles:changed', () => {
    // Local acknowledgements and WS invalidations can describe the same save.
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      pendingList = null;
      for (const { library, visible } of libraries) if (visible()) void library.refresh();
    }, 50);
  }, { signal: requests.signal });
  window.addEventListener('pagehide', () => {
    requests.abort();
    manager?.dispose(); updateEditor?.dispose();
    clearTimeout(changeTimer);
    for (const { library } of libraries) library.dispose();
    for (const view of settingsViews) view.dispose();
  }, { once: true });
}
