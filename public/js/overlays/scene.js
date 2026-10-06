import { createSceneRenderer } from './scene-renderer.js';
import { createSceneSource } from './scene-source.js';

const sceneId = new URLSearchParams(location.search).get('id');
const itemId = new URLSearchParams(location.search).get('item');
const token = new URLSearchParams(location.hash.slice(1)).get('token');
const status = document.getElementById('sceneStatus');
let source = null;
const renderer = createSceneRenderer(document.getElementById('sceneOutput'), { onStatus(message, version) {
  status.textContent = message;
  status.hidden = version > 0 || !message;
  source?.refreshSubscription();
} });
source = createSceneSource({ sceneId, itemId, token, renderer, onError() {
  status.textContent = '场景未发布、来源已失效或桌面端尚未就绪。';
  status.hidden = renderer.getVersion() > 0;
} });
window.addEventListener('pagehide', () => {
  source.dispose();
  renderer.dispose();
}, { once: true });
if (sceneId && token) source.start();
else status.textContent = '请从桌面端复制完整的场景来源。';
