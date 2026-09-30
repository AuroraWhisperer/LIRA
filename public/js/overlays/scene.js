import { createSceneRenderer } from './scene-renderer.js';

const sceneId = new URLSearchParams(location.search).get('id');
const token = new URLSearchParams(location.hash.slice(1)).get('token');
const status = document.getElementById('sceneStatus');
const renderer = createSceneRenderer(document.getElementById('sceneOutput'), { onStatus(message, version) {
  status.textContent = message;
  status.hidden = version > 0 || !message;
} });
let stopped = false;
let timer = null;
let request = null;
let epoch = '';
let cursor = 0;

async function poll() {
  request = new AbortController();
  const timeout = setTimeout(() => request?.abort(), 8000);
  try {
    const query = new URLSearchParams({ id: sceneId, version: renderer.getVersion(), epoch, cursor });
    const response = await fetch(`/api/scene/output?${query}`, { headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit', cache: 'no-store', signal: request.signal });
    const payload = await response.json();
    if (!stopped && [401, 403, 404, 423].includes(response.status)) renderer.revoke();
    if (!response.ok || !payload.ok) throw new Error('场景未发布、来源已失效或桌面端尚未就绪。');
    if (stopped) return;
    renderer.update(payload.data);
    const cloud = payload.data.data?.danmaku;
    if (cloud) { epoch = cloud.epoch; cursor = cloud.nextCursor; }
  } catch {
    if (!stopped) {
      renderer.disconnect();
      status.textContent = '场景未发布、来源已失效或桌面端尚未就绪。';
      status.hidden = renderer.getVersion() > 0;
    }
  } finally {
    clearTimeout(timeout);
    request = null;
    if (!stopped) timer = setTimeout(poll, 750);
  }
}

window.addEventListener('pagehide', () => {
  stopped = true;
  clearTimeout(timer);
  request?.abort();
  renderer.dispose();
}, { once: true });
if (sceneId && token) void poll();
else status.textContent = '请从桌面端复制完整的场景来源。';
