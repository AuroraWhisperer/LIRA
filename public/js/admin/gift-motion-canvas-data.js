import { stateService } from './state.js';
import { GIFT_MOTION_EFFECTS } from '../shared/gift-motion-settings.js';
import { createGiftMotionSamples } from '../shared/gift-motion-samples.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';

// The client owns appearance settings. Canvas samples use the same saved
// settings, without adding another connection or copying them into a scene.
export function startGiftMotionCanvasData(controller, emit) {
  let active = false;
  const publish = settings => emit({ previewData: { 'gift-frame': { preview: true,
    events: [...sceneExtraPreviewData('gift-frame').events,
      ...GIFT_MOTION_EFFECTS.flatMap(effect => createGiftMotionSamples(effect.style, settings))] } } });
  const receive = event => publish(event.detail || {});
  const stop = controller.subscribe(({ draft }) => {
    const needed = draft.document.items.some(item => item.type === 'gift-frame'
      && GIFT_MOTION_EFFECTS.some(effect => effect.style === item.appearance.config?.style));
    if (needed === active) return;
    active = needed;
    if (active) {
      window.addEventListener('app:settings-state', receive);
      publish(stateService.getAppState()?.settings || {});
    } else window.removeEventListener('app:settings-state', receive);
  });
  return () => { stop(); window.removeEventListener('app:settings-state', receive); };
}
