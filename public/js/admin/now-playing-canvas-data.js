import { stateService } from './state.js';

export function startNowPlayingCanvasData(controller, emit) {
  let active = false;
  const publish = nowPlaying => emit({ previewData: {
    'now-playing': nowPlaying?.trackTitle ? { nowPlaying } : null,
  } });
  const receive = event => publish(event.detail);
  const stop = controller.subscribe(({ draft }) => {
    const needed = draft.document.items.some(item => item.type === 'now-playing');
    if (needed === active) return;
    active = needed;
    if (active) {
      window.addEventListener('app:now-playing', receive);
      publish(stateService.getAppState()?.nowPlaying);
    } else {
      window.removeEventListener('app:now-playing', receive);
      publish(null);
    }
  });
  return () => {
    stop();
    window.removeEventListener('app:now-playing', receive);
  };
}
