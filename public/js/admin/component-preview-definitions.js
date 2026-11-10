import { DANMAKU_STYLE_OPTIONS, isFloatingDanmakuStyle } from '../shared/danmaku-style-options.js';
import { createClockPreview, clockStyleChange } from './clock-preview.js';
import { createDanmakuPreview } from './danmaku-preview.js';
import { createQueuePreview } from './queue-preview.js';
import { createOvertimePreview } from './overtime-preview-factory.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';
import { createSceneExtraPreview } from './scene-extra-preview.js';
import { createBrowserSourcePreview } from './browser-source-preview.js';
import { createTextBoxPreview } from './text-box-preview.js';
import { rankingSelection } from '../shared/live-rankings.js';

export const COMPONENT_PREVIEW_DEFINITIONS = Object.freeze({
  danmaku: Object.freeze({
    createPreview: createDanmakuPreview,
    styleAttribute: 'data-danmaku-style',
    styleChange: (_draft, style) => ({ style }),
  }),
  clock: Object.freeze({
    createPreview: createClockPreview,
    styleAttribute: 'data-clock-style-option',
    styleChange: clockStyleChange,
  }),
  queue: Object.freeze({
    createPreview: createQueuePreview,
    styleAttribute: 'data-overlay-style',
    styleChange: (_draft, style) => ({ overlayQueueStyle: style }),
  }),
  overtime: Object.freeze({
    createPreview: createOvertimePreview,
    defaultStyle: Object.freeze({ sample: '00:02:00', label: '默认倒计时' }),
    styleChange: () => ({}),
  }),
  ...Object.fromEntries(Object.entries(SCENE_EXTRA_COMPONENTS).map(([type, definition]) => [type, Object.freeze({
    sceneOnly: true, category: definition.category, variants: definition.variants,
    createPreview: (options) => createSceneExtraPreview(type, options),
    styleChange: (_draft, value) => type === 'live-rankings' ? rankingSelection(value)
      : type === 'opening' && value !== 'default' ? { style: value }
      : definition.variants.find(variant => variant.value === value)?.config
        || (definition.variantKey ? { [definition.variantKey]: value } : {}),
  })])),
  'text-box': Object.freeze({ sceneOnly: true, createPreview: createTextBoxPreview,
    defaultStyle: Object.freeze({ label: '文本框', sample: '欢迎来到直播间' }), styleChange: () => ({}) }),
  browser: Object.freeze({ sceneOnly: true, createPreview: createBrowserSourcePreview }),
});

// Component placement and appearance defaults belong beside preview definitions.
export function createInitialPreviewItem(component, document, { id, config, name, size, selectedSize }) {
  const draft = config || component.controller.getState().draft;
  const region = !config && selectedSize ? selectedSize : component.bounds?.(draft);
  const fillCanvas = component.id === 'background' || (component.id === 'danmaku' && isFloatingDanmakuStyle(draft.style)
    && !size && (!draft.layout || (region?.x === 0 && region?.y === 0
      && region.width === draft.layout.canvas.width && region.height === draft.layout.canvas.height)));
  const [defaultWidth, defaultHeight] = fillCanvas ? [document.canvas.width, document.canvas.height]
    : size || (region ? [region.width, region.height] : component.size(draft));
  const scale = component.id === 'browser' ? Math.min(1, document.canvas.width / defaultWidth, document.canvas.height / defaultHeight) : 1;
  const width = Math.max(32, Math.min(defaultWidth * scale, document.canvas.width));
  const height = Math.max(32, Math.min(defaultHeight * scale, document.canvas.height));
  return { id, type: component.id,
    name: name || `${component.title} ${document.items.filter((item) => item.type === component.id).length + 1}`,
    x: Math.round((document.canvas.width - width) / 2),
    y: (component.id === 'danmaku' && DANMAKU_STYLE_OPTIONS[draft.style]?.layout === 'horizontal')
      || (component.id === 'gift-frame' && draft.style === 'gift-swing' && !draft.mediaStyle && !draft.resourceStyle)
      ? document.canvas.height - height : Math.round((document.canvas.height - height) / 2),
    width, height, visible: true, locked: false,
    appearance: config || component.sceneOnly ? { mode: 'independent', config: draft } : { mode: 'shared' } };
}
