// The streaming application's viewport must not resize a saved component.
export function componentOutputViewport(view = window) {
  const style = view.document.documentElement.style;
  return {
    width: Number.parseFloat(style.getPropertyValue('--component-width')) || view.innerWidth,
    height: Number.parseFloat(style.getPropertyValue('--component-height')) || view.innerHeight,
  };
}

export function watchComponentOutputSize(type, onChange = () => {}) {
  let stopped = false;
  let timer;
  let request;
  let previous = '';
  function apply(size) {
    const key = JSON.stringify(size);
    if (key === previous) return;
    previous = key;
    const root = document.documentElement;
    for (const axis of ['width', 'height']) {
      if (size) {
        root.style.setProperty(`--component-${axis}`, `${size[axis]}px`);
        root.style[axis] = `${size[axis]}px`;
      } else {
        root.style.removeProperty(`--component-${axis}`);
        root.style.removeProperty(axis);
      }
    }
    root.style.containerType = size ? 'size' : '';
    if (size) root.style.setProperty('--component-edge', `${Math.min(16, Math.min(size.width, size.height) * 0.02)}px`);
    else root.style.removeProperty('--component-edge');
    onChange(size);
  }
  async function poll() {
    request = new AbortController();
    try {
      const response = await fetch(`/api/component/size?type=${encodeURIComponent(type)}`, {
        headers: { Authorization: `Bearer ${window.__API_TOKEN__}` }, credentials: 'omit',
        cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
      });
      if (stopped) return;
      if ([401, 403, 423].includes(response.status)) { apply(null); return; }
      const payload = await response.json();
      if (stopped || !response.ok || !payload.ok) return;
      const size = payload.data;
      if (size === null || size && ['width', 'height'].every((axis) =>
        Number.isFinite(size[axis]) && size[axis] >= 32 && size[axis] <= 7680)) apply(size);
    } catch {
      // A temporary disconnection retains the last confirmed dimensions.
      return;
    } finally {
      request = null;
      if (!stopped) timer = setTimeout(poll, 750);
    }
  }
  function dispose() {
    stopped = true;
    clearTimeout(timer);
    request?.abort();
  }
  void poll();
  return dispose;
}
