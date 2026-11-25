import { eventBus } from '../shared/event-bus.js';
import { readApiResponse } from '../shared/json-response.js';

// The parent owns HTTP access. A detached editor or a hidden item has no consumer.
export function createCanvasDataReader({ url, games = false, emit }) {
  let active = false;
  let pending;
  let timer;
  let patchTimer;
  let queued = false;
  let drawing = false;
  let openingSettings;

  function schedule(delay) {
    window.clearTimeout(timer);
    timer = window.setTimeout(read, delay);
  }
  function publish(data) {
    drawing = games && data?.game === 'draw-guess' && data.state?.phase === 'drawing';
    emit(data);
  }
  async function read() {
    if (!active) return;
    if (pending) { queued = true; return; }
    window.clearTimeout(timer);
    const request = new AbortController();
    pending = request;
    let data = null;
    let ok = false;
    try {
      const response = await fetch(url, { cache: 'no-store',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) });
      const payload = await readApiResponse(response, '读取画布预览数据失败');
      data = payload.data;
      ok = true;
    } catch {
      if (request.signal.aborted) return;
      data = null;
      ok = false;
    }
    if (request !== pending) return;
    pending = null;
    publish(data);
    // Drawing strokes have no admin DOM event. Also reconcile after missed WS updates.
    if (active) schedule(queued ? 0 : drawing || !ok ? 1000 : 30000);
    queued = false;
  }
  function cancel() {
    window.clearTimeout(timer);
    window.clearTimeout(patchTimer);
    patchTimer = null;
    pending?.abort();
    pending = null;
    queued = false;
  }
  function gameUpdate(event) {
    cancel();
    publish(event.detail);
    if (active) schedule(drawing ? 1000 : 30000);
  }
  function gamePatch() {
    if (patchTimer != null) return;
    patchTimer = window.setTimeout(() => { patchTimer = null; void read(); }, 250);
  }
  function settingsUpdate({ detail }) {
    const signature = JSON.stringify(Object.entries(detail).filter(([key]) => key.startsWith('opening')));
    if (signature === openingSettings) return;
    openingSettings = signature;
    void read();
  }
  let stopReconnect;
  function setActive(value) {
    if (active === value) return;
    active = value;
    if (active) {
      stopReconnect = eventBus.on('ws:connected', read);
      if (games) {
        window.addEventListener('app:game-update', gameUpdate);
        window.addEventListener('app:game-patch', gamePatch);
      } else window.addEventListener('app:settings-state', settingsUpdate);
      void read();
    } else {
      stopReconnect();
      cancel();
      window.removeEventListener('app:game-update', gameUpdate);
      window.removeEventListener('app:game-patch', gamePatch);
      window.removeEventListener('app:settings-state', settingsUpdate);
      publish(null);
    }
  }
  return { setActive };
}
