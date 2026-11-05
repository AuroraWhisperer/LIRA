import { refreshSharedFonts } from './font-library.js';

// Cold pages render immediately using their fallback stack. Only published font
// files enter the shared stylesheet; downloads never hold up renderer requests.
export function startFontLibraryLoader({ window: windowRef = window, document: documentRef = document } = {}) {
  let disposed = false;
  let timer = null;
  let styleTimer = null;
  let link = null;
  let pendingLink = null;
  let signature = '';
  let latestSignature = '';
  let pendingSignature = '';
  let latestState = {};
  let styleFailures = 0;
  let readFailures = 0;
  let eventSeen = false;
  let unsubscribe = () => {};
  const bridge = windowRef.liraLicense;
  const desktop = bridge?.onFontLibraryStateChanged && bridge?.getFontLibraryState;

  function apply(state = {}) {
    if (disposed) return;
    const next = `${state.status}:${state.completed || 0}:${state.completedAt || ''}`;
    if (latestSignature !== next) {
      windowRef.clearTimeout(styleTimer);
      styleTimer = null;
      styleFailures = 0;
      pendingLink?.remove();
      pendingLink = null;
      pendingSignature = '';
    }
    latestSignature = next;
    latestState = state;
    if (signature === next || pendingSignature === next || styleTimer !== null) return;
    if ((state.completed || 0) > 0 || state.status === 'ready') {
      const nextLink = documentRef.createElement('link');
      nextLink.rel = 'stylesheet';
      nextLink.href = `/css/shared/display-fonts.css?state=${encodeURIComponent(next)}`;
      nextLink.addEventListener('load', () => {
        if (disposed || pendingLink !== nextLink) return;
        link?.remove();
        link = nextLink;
        pendingLink = null;
        pendingSignature = '';
        signature = next;
        styleFailures = 0;
        refreshSharedFonts();
      }, { once: true });
      nextLink.addEventListener('error', () => {
        nextLink.remove();
        if (disposed || pendingLink !== nextLink) return;
        pendingLink = null;
        pendingSignature = '';
        if (styleFailures++ < 3) styleTimer = windowRef.setTimeout(() => {
          styleTimer = null;
          apply(latestState);
        }, 2000 * 2 ** (styleFailures - 1));
      }, { once: true });
      pendingLink = nextLink;
      pendingSignature = next;
      documentRef.head.append(nextLink);
    }
  }

  async function read() {
    try {
      let state;
      if (desktop) {
        state = await bridge.getFontLibraryState();
        if (eventSeen) return;
      } else {
        const response = await windowRef.fetch('/font-library/status');
        if (!response.ok) throw new Error('Font status unavailable');
        state = await response.json();
      }
      if (disposed) return;
      readFailures = 0;
      apply(state);
      if (!desktop && ['checking', 'downloading'].includes(state.status)) timer = windowRef.setTimeout(read, 2000);
    } catch {
      if (!disposed && !eventSeen && readFailures++ < 3) timer = windowRef.setTimeout(read, 2000 * 2 ** (readFailures - 1));
    }
  }

  if (desktop) {
    unsubscribe = bridge.onFontLibraryStateChanged(state => { eventSeen = true; apply(state); });
  }
  void read();

  function dispose() {
    disposed = true;
    pendingLink?.remove();
    windowRef.clearTimeout(timer);
    windowRef.clearTimeout(styleTimer);
    unsubscribe();
    windowRef.removeEventListener('pagehide', dispose);
  }
  windowRef.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}

startFontLibraryLoader();
