// Some inline libraries use display: contents. Their containing panels own visibility.
export function isPanelVisible(element) {
  return element.isConnected && !document.hidden && !element.closest(
    '[hidden], .main-page:not(.active), .tab-page:not(.active), dialog:not([open]), .gift-recent-panel.is-collapsed',
  );
}

export function observePanelVisibility(element, listener) {
  let previous;
  function sync() {
    const visible = isPanelVisible(element);
    if (visible === previous) return;
    previous = visible;
    listener(visible);
  }
  const observer = new MutationObserver(sync);
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    observer.observe(node, { attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
  }
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', sync);
  };
}

// An editor in another window may have changed the data during a quick focus round trip.
export function refreshOnPanelReturn(element, refresh) {
  let lastRead = -Infinity;
  let timer;
  function read() {
    clearTimeout(timer);
    if (!isPanelVisible(element)) return;
    lastRead = Date.now();
    void refresh();
  }
  function focus() {
    if (!isPanelVisible(element)) return;
    const remaining = 3000 - (Date.now() - lastRead);
    clearTimeout(timer);
    if (remaining > 0) timer = setTimeout(read, remaining);
    else read();
  }
  const stop = observePanelVisibility(element, visible => { if (visible) read(); else clearTimeout(timer); });
  window.addEventListener('focus', focus);
  return () => { clearTimeout(timer); stop(); window.removeEventListener('focus', focus); };
}
