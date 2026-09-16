let initialized = false;
let currentUrl = '';
let generation = 0;
const listeners = new Set();

export function serverOverlayUrl(snapshot) {
  if (snapshot?.state !== 'authorized') return '';
  try {
    const url = new URL(snapshot.streamer?.songPageUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return new URL('/overlay', url.origin).href;
  } catch {
    return '';
  }
}

function publish(snapshot) {
  currentUrl = serverOverlayUrl(snapshot);
  for (const listener of listeners) listener(currentUrl);
}

export function observeServerOverlayUrl(listener) {
  listeners.add(listener);
  listener(currentUrl);
  if (!initialized) {
    initialized = true;
    const bridge = window.liraLicense;
    const dispose = bridge?.onStateChanged?.((snapshot) => {
      generation += 1;
      publish(snapshot);
    });
    const requestedGeneration = generation;
    Promise.resolve(bridge?.getProfile?.()).then((snapshot) => {
      if (generation === requestedGeneration) publish(snapshot);
    }).catch(() => {
      if (generation === requestedGeneration) publish(null);
    });
    window.addEventListener('pagehide', () => {
      generation += 1;
      dispose?.();
      listeners.clear();
    }, { once: true });
  }
  return () => listeners.delete(listener);
}
