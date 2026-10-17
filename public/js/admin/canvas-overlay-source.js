import { toast } from '../shared/utils.js';
import { bindCopyUrl } from '../shared/copy-url.js';
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
  let sourceSize = null;
  async function refresh() {
    const requested = ++generation;
    sourceUrl = '';
    sourceSize = null;
    copy.disabled = true;
    address.textContent = '正在读取场景地址…';
    status.textContent = '';
    try {
      const canvas = await requestScene('canvas');
      if (requested !== generation) return;
      if (!canvas?.publishedVersion) {
        address.textContent = '请先编辑场景，保存并应用后显示地址';
        return;
      }
      const source = await requestScene('source', undefined, canvas.outputId);
      if (requested !== generation) return;
      sourceUrl = sceneSourceUrl(source);
      sourceSize = source.canvas;
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
  document.querySelectorAll('#liveCanvasPreview, #liveComponentsCanvas').forEach((button) => {
    button.addEventListener('click', () => openComponentPreview());
  });
  bindCopyUrl(copy, {
    getUrl: () => sourceUrl,
    onCopied: url => {
      if (url === sourceUrl) {
        status.textContent = sourceSize
          ? `地址已复制；请在 OBS 或直播姬中设置为 ${sourceSize.width} × ${sourceSize.height}。`
          : '地址已复制。';
        toast('直播场景地址已复制');
      }
    },
    onError: (error, url) => {
      if (url === sourceUrl) status.textContent = error.message;
    },
  });
  window.addEventListener('pagehide', () => {
    generation += 1;
    stop();
    stopPublication();
    tab.removeEventListener('click', refresh);
    window.removeEventListener('focus', refresh);
  }, { once: true });
}
