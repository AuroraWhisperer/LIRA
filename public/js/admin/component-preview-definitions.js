import { createClockPreview, clockStyleChange } from './clock-preview.js';
import { createDanmakuPreview } from './danmaku-preview.js';
import { createQueuePreview } from './queue-preview.js';
import { createOvertimePreview } from './overtime-preview-factory.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';
import { createSceneExtraPreview } from './scene-extra-preview.js';

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
    styleChange: (_draft, value) => definition.variantKey ? { [definition.variantKey]: value } : {},
  })])),
});
