import { copyText, toast } from '../shared/utils.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { prepareComponentPreviews } from './component-preview-registry.js';
import { observeServerOverlayUrl } from './server-overlay-url.js';
import { sceneSourceUrl } from './scene-source-url.js';

export function initCanvasOverlaySource() {
  const address = document.getElementById('liveCanvasUrl');
  const status = document.getElementById('liveCanvasSourceStatus');
  const copy = document.getElementById('copyLiveCanvasUrl');
  let generation = 0;
  let busy = false;
  const stop = observeServerOverlayUrl(() => {
    generation += 1;
    address.textContent = '保存并应用画布后，点击复制获取完整地址';
    status.textContent = '浏览器源的宽高请设为画布分辨率。';
  });
  document.getElementById('liveCanvasPreview').addEventListener('click', () => openComponentPreview());
  copy.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    copy.disabled = true;
    const requested = generation;
    try {
      const components = await prepareComponentPreviews();
      if (requested !== generation) return;
      const canvas = components.find(({ id }) => id === 'canvas');
      const source = await canvas.source();
      if (requested !== generation) return;
      const url = sceneSourceUrl(source);
      address.textContent = url;
      await copyText(url);
      if (requested === generation) {
        status.textContent = '统一地址已复制。画布更新后点击“保存并应用”，直播软件继续使用此地址。';
        toast('统一直播画布地址已复制');
      }
    } catch (error) {
      if (requested === generation) status.textContent = error.message;
    } finally {
      busy = false;
      copy.disabled = false;
    }
  });
  window.addEventListener('pagehide', () => { generation += 1; stop(); }, { once: true });
}
