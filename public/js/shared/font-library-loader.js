// Cold pages render immediately using their fallback stack. Only published font
// files enter the shared stylesheet; downloads never hold up renderer requests.
export function startFontLibraryLoader({ window: windowRef = window, document: documentRef = document } = {}) {
  let disposed = false;
  let timer = null;
  let link = null;
  let signature = '';
  let eventSeen = false;
  let unsubscribe = () => {};
  const bridge = windowRef.liraLicense;

  function apply(state = {}) {
    if (disposed) return;
    const next = `${state.status}:${state.completed || 0}:${state.completedAt || ''}`;
    if (signature === next) return;
    signature = next;
    if ((state.completed || 0) > 0 || state.status === 'ready') {
      const previous = link;
      const nextLink = documentRef.createElement('link');
      nextLink.rel = 'stylesheet';
      nextLink.href = `/css/shared/display-fonts.css?state=${encodeURIComponent(signature)}`;
      nextLink.addEventListener('load', () => previous?.remove(), { once: true });
      link = nextLink;
      documentRef.head.append(nextLink);
    }
  }

  async function read() {
    try {
      const response = await windowRef.fetch('/font-library/status');
      if (!response.ok || disposed) return;
      const state = await response.json();
      apply(state);
      if (!disposed && ['checking', 'downloading'].includes(state.status)) timer = windowRef.setTimeout(read, 2000);
    } catch { return; }
  }

  if (bridge?.onFontLibraryStateChanged && bridge?.getFontLibraryState) {
    unsubscribe = bridge.onFontLibraryStateChanged(state => { eventSeen = true; apply(state); });
    bridge.getFontLibraryState().then(state => { if (!eventSeen) apply(state); }).catch(() => undefined);
  } else void read();

  function dispose() {
    disposed = true;
    windowRef.clearTimeout(timer);
    unsubscribe();
    windowRef.removeEventListener('pagehide', dispose);
  }
  windowRef.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}

startFontLibraryLoader();
