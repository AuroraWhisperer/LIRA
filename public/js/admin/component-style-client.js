import { previewElement } from './component-preview-surface.js';
import { openComponentStyleLibrary } from './component-style-library.js';
import { prepareComponentPreviews } from './component-preview-registry.js';
import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { validateSceneDocument } from './scene-template.js';
import { loadComponentStyleCss } from './component-style-api.js';
import { componentStyleMedia } from '../shared/component-resource-style.js';

async function addStyleToCanvas(style) {
  const entries = await prepareComponentPreviews();
  const canvas = entries.find(entry => entry.id === 'canvas');
  if (!canvas?.controller.getState().loaded) throw new Error('画布尚未准备完成，请稍后重试。');
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

export function initComponentStyleLibraries() {
  loadComponentStyleCss();
  const locations = [
    ['#otherClockFeature .clock-style-options', 'clock'],
    ['#otherDanmakuFeature .danmaku-style-options-fixed', 'danmaku'],
    ['#otherStartAnimationFeature', 'opening'],
    ['#giftWishesPanel', 'gift-wishes'],
    ['#giftFramePanel', 'gift-frame'], ['#guardThanksPanel', 'guard-thanks'],
  ];
  for (const [selector, type] of locations) {
    const host = document.querySelector(selector);
    if (!host || host.querySelector('[data-local-styles]')) continue;
    const button = previewElement('button', 'component-style-add', '＋ 添加样式'); button.type = 'button'; button.dataset.localStyles = type;
    button.addEventListener('click', () => openComponentStyleLibrary({ type, onUse: addStyleToCanvas }));
    host.append(button);
  }
  const sources = document.getElementById('overlayPage');
  if (sources && !sources.querySelector('[data-local-style-packages]')) {
    const button = previewElement('button', 'secondary', '样式与套装'); button.type = 'button'; button.dataset.localStylePackages = '';
    button.addEventListener('click', () => openComponentStyleLibrary({ onUse: addStyleToCanvas })); sources.prepend(button);
  }
}
