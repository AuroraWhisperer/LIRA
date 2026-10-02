import { SCENE_EXTRA_COMPONENTS } from './scene-extra-components.js';

// Stable scene capabilities; environment-specific factories and owners live elsewhere.
export const SCENE_COMPONENTS = Object.freeze({
  danmaku: Object.freeze({
    resizeAxes: 'xy', contentHeight: false,
    rendererUrl: '/danmaku?componentPreview=1&sceneComponent=1&preview=1&componentLayer=1',
    sourceUrl: '/danmaku?source=component',
    disconnectedData: () => ({ status: 'offline', epoch: null, reset: true, events: [] }),
  }),
  clock: Object.freeze({
    resizeAxes: 'xy', contentHeight: false,
    rendererUrl: '/clock?componentPreview=1&sceneComponent=1', sourceUrl: '/clock',
  }),
  queue: Object.freeze({
    resizeAxes: 'xy', contentHeight: false,
    rendererUrl: '/queue?componentPreview=1&sceneComponent=1', sourceUrl: '/queue',
  }),
  overtime: Object.freeze({
    resizeAxes: 'x', contentHeight: true,
    rendererUrl: '/overtime?componentPreview=1&sceneComponent=1', sourceUrl: '/overtime',
  }),
  ...Object.fromEntries(Object.entries(SCENE_EXTRA_COMPONENTS).map(([type, definition]) => [type, Object.freeze({
    resizeAxes: 'xy', contentHeight: false, independentOnly: true,
    rendererUrl: `${definition.path}?componentPreview=1&sceneComponent=1`, sourceUrl: definition.path,
    disconnectedData: () => null,
  })])),
});

export const SCENE_TYPES = Object.freeze(Object.keys(SCENE_COMPONENTS));
export const SHARED_SCENE_TYPES = Object.freeze(SCENE_TYPES.filter((type) => !SCENE_COMPONENTS[type].independentOnly));
