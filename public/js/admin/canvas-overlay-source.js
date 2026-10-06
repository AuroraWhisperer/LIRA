import { copyText, toast } from '../shared/utils.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { requestScene } from './scene-api.js';
import { observeServerOverlayUrl } from './server-overlay-url.js';
import { sceneSourceUrl } from './scene-source-url.js';
import { eventBus } from '../shared/event-bus.js';

export function initCanvasOverlaySource() {
  const address = document.getElementById('liveCanvasUrl');
  const status = document.getElementById('liveCanvasSourceStatus');
  const copy = document.getElementById('copyLiveCanvasUrl');
  let generation = 0;
  let sourceUrl = '';
  async function refresh() {
    const requested = ++generation;
    sourceUrl = '';
    copy.disabled = true;
    address.textContent = '正在读取场景地址…';
    status.textContent = '';
    try {
      const scenes = await requestScene('list');
      if (requested !== generation) return;
      const canvas = scenes.length ? await requestScene('canvas') : null;
      if (requested !== generation) return;
      if (!canvas?.publishedVersion) {
        address.textContent = '请先编辑场景，保存并应用后显示地址';
        return;
      }
      const source = await requestScene('source', undefined, canvas.outputId);
      if (requested !== generation) return;
      sourceUrl = sceneSourceUrl(source);
      address.textContent = sourceUrl;
      copy.disabled = false;
    } catch (error) {
      if (requested !== generation) return;
      address.textContent = '场景地址暂时无法读取';
      status.textContent = error.message;
    }
  }
  const stop = observeServerOverlayUrl(refresh);
  const stopPublication = eventBus.on('scene:published', refresh);
  const tab = document.querySelector('[data-tab="overlayPage"]');
  tab.addEventListener('click', refresh);
  window.addEventListener('focus', refresh);
  document.getElementById('liveCanvasPreview').addEventListener('click', () => openComponentPreview());
  copy.addEventListener('click', async () => {
    if (copy.disabled || !sourceUrl) return;
    copy.disabled = true;
    const requested = generation;
    try {
      await copyText(sourceUrl);
      if (requested === generation) {
        status.textContent = '地址已复制。';
        toast('直播场景地址已复制');
      }
    } catch (error) {
      if (requested === generation) status.textContent = error.message;
    } finally {
      if (requested === generation) copy.disabled = false;
    }
  });
  window.addEventListener('pagehide', () => {
    generation += 1;
    stop();
    stopPublication();
    tab.removeEventListener('click', refresh);
    window.removeEventListener('focus', refresh);
  }, { once: true });
}
