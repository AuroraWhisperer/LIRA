const TYPES = new Set(['danmaku', 'clock', 'queue', 'overtime']);

export function createSceneRenderer(host, { onStatus = () => {}, timeoutMs = 12000 } = {}) {
  let active = null;
  let staging = null;
  let disposed = false;
  let latestData = {};
  let dataSequence = 1;
  const send = (entry, type, values = {}) => entry.frame.contentWindow?.postMessage({ type: `component-preview:${type}`, ...values }, '*');
  function fit(version) {
    if (!version) return;
    const { width, height } = version.document.canvas;
    version.root.style.transform = `scale(${Math.min(host.clientWidth / width, host.clientHeight / height)})`;
  }
  function release(version) {
    if (!version) return;
    clearTimeout(version.timer);
    for (const entry of version.entries) send(entry, 'dispose');
    version.root.remove();
  }
  function data(version, values) {
    if (!version) return;
    for (const entry of version.entries) {
      if (entry.ready && values[entry.item.type] !== undefined) send(entry, 'data', { data: values[entry.item.type], source: dataSequence });
    }
  }
  function commit() {
    if (!staging || staging.entries.some((entry) => !entry.prepared)) return;
    const next = staging;
    staging = null;
    clearTimeout(next.timer);
    data(next, latestData);
    next.root.classList.remove('is-staging');
    release(active);
    active = next;
    onStatus('', active.version);
  }
  function fail() {
    release(staging);
    staging = null;
    onStatus('新版准备失败，继续显示上一版本。', active?.version || 0);
  }
  function receive(event) {
    if (disposed || !staging || event.origin !== 'null') return;
    const entry = staging.entries.find((candidate) => candidate.frame.contentWindow === event.source);
    if (!entry) return;
    if (event.data?.type === 'component-preview:ready') {
      entry.ready = true;
      send(entry, 'init', { config: entry.item.appearance.config, editable: false });
    } else if (event.data?.type === 'component-preview:prepared' && entry.ready) {
      entry.prepared = true;
      commit();
    } else if (event.data?.type === 'component-preview:status') fail();
  }
  function prepare(document, version) {
    if (disposed || version === active?.version || version === staging?.version) return;
    release(staging);
    staging = null;
    const root = window.document.createElement('div');
    root.className = 'scene-version is-staging';
    root.style.width = `${document.canvas.width}px`;
    root.style.height = `${document.canvas.height}px`;
    const entries = [];
    for (const item of document.items.filter((value) => value.visible)) {
      if (!TYPES.has(item.type) || item.appearance.mode !== 'independent') {
        onStatus('场景版本无效，继续显示上一版本。', active?.version || 0);
        return;
      }
      const frame = window.document.createElement('iframe');
      frame.title = item.name;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.left = `${item.x}px`;
      frame.style.top = `${item.y}px`;
      frame.style.width = `${item.width}px`;
      frame.style.height = `${item.height}px`;
      frame.src = `/${item.type}?componentPreview=1&sceneComponent=1${item.type === 'danmaku' ? '&preview=1' : ''}`;
      root.append(frame);
      entries.push({ item, frame, ready: false, prepared: false });
    }
    staging = { root, document, version, entries, timer: setTimeout(fail, timeoutMs) };
    host.append(root);
    fit(staging);
    commit();
  }
  window.addEventListener('message', receive);
  const observer = new ResizeObserver(() => { fit(active); fit(staging); });
  observer.observe(host);
  return {
    getVersion: () => active?.version || 0,
    update(response) {
      if (disposed) return;
      latestData = response.data || {};
      data(active, latestData);
      if (response.document) prepare(response.document, response.version);
    },
    disconnect() {
      dataSequence += 1;
      data(active, { danmaku: { status: 'offline', epoch: null, reset: true, events: [] } });
    },
    revoke() {
      release(staging);
      release(active);
      staging = null;
      active = null;
      latestData = {};
      dataSequence += 1;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      release(staging);
      release(active);
      observer.disconnect();
      window.removeEventListener('message', receive);
    },
  };
}
