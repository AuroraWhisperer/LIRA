import { previewElement } from './component-preview-surface.js';
import { mountComponentStyleLibrary } from './component-style-library.js';
import { prepareComponentPreviews } from './component-preview-registry.js';
import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { getActiveComponentPreview } from './component-preview-session.js';
import { validateSceneDocument } from './scene-template.js';
import { loadComponentStyleCss, requestComponentStyles } from './component-style-api.js';
import { componentStyleMedia } from '../shared/component-resource-style.js';

async function addStyleToCanvas(style) {
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
    ['#otherDanmakuFeature .danmaku-style-options-fixed', 'danmaku'],
    ['#otherStartAnimationFeature .opening-editor-section[aria-label="动画样式"]', 'opening'],
    ['#giftWishDisplayStyle', 'gift-wishes'],
    ['#giftFramePanel', 'gift-frame'], ['#guardThanksStyleLibrary', 'guard-thanks'],
  ];
  for (const [selector, type] of locations) {
    const host = document.querySelector(selector);
    if (!host || host.querySelector('[data-local-styles]')) continue;
    const list = previewElement('div', ['clock', 'danmaku'].includes(type) ? 'component-style-inline-host' : 'component-style-list');
    list.dataset.localStyles = type;
    host.append(list);
    libraries.push(mountComponentStyleLibrary(list, { type, request, onUse: addStyleToCanvas, inline: true }));
  }
  const refresh = () => { for (const library of libraries) void library.refresh(); };
  window.addEventListener('focus', refresh, { signal: requests.signal });
  window.addEventListener('component-styles:changed', () => { pendingList = null; refresh(); }, { signal: requests.signal });
  window.addEventListener('pagehide', () => {
    requests.abort();
    for (const library of libraries) library.dispose();
  }, { once: true });
}
