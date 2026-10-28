import { mountDanmakuParameters } from '../shared/danmaku-parameter-controls.js';
import { canvasContentScale } from './danmaku-canvas.js';

export function initPreviewAppearance({ getDraft, change, error }) {
  const listeners = new Set();
  const controller = {
    getState: () => ({ draft: getDraft(), loaded: true }),
    edit: patch => change({ ...getDraft(), ...patch }),
    subscribe(listener) {
      listeners.add(listener);
      listener(controller.getState());
      return () => listeners.delete(listener);
    },
  };
  const controls = mountDanmakuParameters(document.getElementById('previewParameterFields'), controller, {
    prefix: 'preview', desktop: false, onError: error,
    resetButton: document.getElementById('previewAppearanceReset'),
    fontScale: draft => canvasContentScale(draft.layout, draft.style),
  });
  return { render: () => listeners.forEach(listener => listener(controller.getState())),
    addFonts: controls.addFonts, dispose: controls.dispose };
}
