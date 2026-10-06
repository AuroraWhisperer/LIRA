import { resolveComponentResource } from './component-resources.js';

const MOVIE_SOURCE = '/img/overlays/backgrounds/moonlit-loop-hq-60.webm';

function createMoonlitBackground(video) {
  let running = false;
  let disposed = false;
  let attempt = 0;

  function onPlaying() {
    if (running && !disposed) video.hidden = false;
  }

  function onError() {
    attempt++;
    running = false;
    video.pause();
    video.hidden = true;
  }

  video.addEventListener('playing', onPlaying);
  video.addEventListener('error', onError);

  return {
    update({ animated, reducedMotion = false, visible = true }) {
      if (disposed) return;
      if (!animated || reducedMotion) video.hidden = true;
      const shouldPlay = animated && !reducedMotion && visible;
      const source = resolveComponentResource(MOVIE_SOURCE);
      if (video.getAttribute('src') && video.getAttribute('src') !== source) {
        video.pause(); video.removeAttribute('src'); video.load(); running = false;
      }
      if (shouldPlay === running) return;
      running = shouldPlay;
      const currentAttempt = ++attempt;
      if (!running) {
        video.pause();
        return;
      }
      // Defer the movie request until this background is actually visible and animated.
      if (!video.getAttribute('src')) video.src = source;
      video.play().catch(() => {
        // A cancelled play from an earlier mode must not hide a newer playback.
        if (!disposed && currentAttempt === attempt) {
          running = false;
          video.hidden = true;
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      attempt++;
      video.pause();
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
      video.hidden = true;
    },
  };
}

export { createMoonlitBackground };
