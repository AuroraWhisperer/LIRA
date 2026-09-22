let initialized = false;
let currentUrl = '';
let currentOwner = '';
let generation = 0;
const listeners = new Set();

export function serverOverlayUrl(snapshot, settings) {
  if (snapshot?.state !== 'authorized' || !settings?.ok) return '';
  try {
    const origin = new URL(snapshot.streamer?.songPageUrl);
    const url = new URL(settings.overlayUrl);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      url.origin !== origin.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/overlay\/[A-Za-z0-9_-]{16}$/.test(url.pathname)
    )
      return '';
    return url.href;
  } catch {
    return '';
  }
}

function publish(url) {
  if (url === currentUrl) return;
  currentUrl = url;
  for (const listener of listeners) listener(currentUrl);
}

async function refresh(snapshot) {
  const requestedGeneration = ++generation;
  const owner =
    snapshot?.state === 'authorized'
      ? JSON.stringify([snapshot.streamer?.accountName, snapshot.streamer?.songPageUrl])
      : '';
  if (owner !== currentOwner) {
    currentOwner = owner;
    publish('');
  }
  if (!owner) return;
  try {
    const settings = await window.liraLicense.getOverlaySettings();
    if (generation === requestedGeneration) publish(serverOverlayUrl(snapshot, settings));
  } catch {
    if (generation === requestedGeneration) publish('');
  }
}

export function observeServerOverlayUrl(listener) {
  listeners.add(listener);
  listener(currentUrl);
  if (!initialized) {
    initialized = true;
    const bridge = window.liraLicense;
    const dispose = bridge?.onStateChanged?.((snapshot) => {
      void refresh(snapshot);
    });
    const requestedGeneration = generation;
    Promise.resolve(bridge?.getProfile?.())
      .then((snapshot) => {
        if (generation === requestedGeneration) void refresh(snapshot);
      })
      .catch(() => {
        if (generation === requestedGeneration) void refresh(null);
      });
    window.addEventListener(
      'pagehide',
      () => {
        generation += 1;
        dispose?.();
        listeners.clear();
        currentUrl = '';
        currentOwner = '';
      },
      { once: true },
    );
  }
  return () => listeners.delete(listener);
}
