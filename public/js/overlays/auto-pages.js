// Native, discrete paging keeps overflowing broadcast content readable without
// continuous motion. User interaction pauses it; incoming data never resets it.
export function startOverlayPages(element) {
  let pausedUntil = 0;
  const pause = () => {
    pausedUntil = Date.now() + 16000;
  };
  const pauseDrag = (event) => {
    if (event.buttons) pause();
  };
  const events = ['wheel', 'pointerdown', 'keydown', 'touchstart'];
  for (const type of events) {
    element.addEventListener(type, pause, { passive: true });
  }
  element.addEventListener('pointermove', pauseDrag, { passive: true });
  const timer = setInterval(() => {
    if (document.hidden || Date.now() < pausedUntil || element.contains(document.activeElement)) return;
    const height = element.clientHeight;
    const end = element.scrollHeight - height;
    if (height <= 0 || end <= 1) return;
    element.scrollTop = element.scrollTop >= end - 1 ? 0 : Math.min(end, element.scrollTop + Math.max(1, height - 32));
  }, 8000);
  return () => {
    clearInterval(timer);
    for (const type of events) element.removeEventListener(type, pause);
    element.removeEventListener('pointermove', pauseDrag);
  };
}
