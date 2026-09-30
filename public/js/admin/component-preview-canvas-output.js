import { previewElement } from './component-preview-surface.js';
import { copyText } from '../shared/utils.js';
import { sceneSourceUrl } from './scene-source-url.js';

export function mountPreviewCanvasOutput({ header, footer, connection, controllers, beforeApply, setBusy, report }) {
  let disposed = false;
  let busy = false;
  const source = previewElement('input', 'preview-canvas-source');
  source.readOnly = true;
  source.hidden = true;
  source.setAttribute('aria-label', '直播源地址');
  const copy = previewElement('button', 'secondary', '复制直播源地址');
  const apply = previewElement('button', 'primary', '保存并应用');
  copy.type = apply.type = 'button';
  header.append(source, copy);
  footer.append(apply);
  async function run(action) {
    if (busy || (action === 'publish' && !beforeApply())) return;
    busy = true;
    setBusy(true);
    report(action === 'publish' ? '正在保存组件并更新直播源…' : '正在获取直播源地址…');
    try {
      if (action === 'publish') await Promise.all(controllers.map(({ controller }) => controller.flush()));
      const result = await connection.execute(action);
      if (disposed) return;
      if (action === 'source') {
        const url = sceneSourceUrl(result);
        source.value = url;
        source.hidden = false;
        await copyText(url);
        report('直播源地址已复制。在 OBS 或哔哩哔哩直播姬中添加一个浏览器源，宽高设为画布分辨率。');
      } else report(controllers.some(({ controller }) => controller.getState().dirty)
        ? '本次已应用，期间的新修改仍需保存。' : '已保存并应用到直播源。后续更新继续使用同一地址。');
    } catch (error) {
      if (!disposed) report(error.message);
    } finally {
      busy = false;
      if (!disposed) setBusy(false);
    }
  }
  copy.addEventListener('click', () => { void run('source'); });
  apply.addEventListener('click', () => { void run('publish'); });
  return {
    render(connected, saving) { copy.disabled = apply.disabled = !connected || saving || busy; },
    dispose() { disposed = true; source.remove(); copy.remove(); apply.remove(); },
  };
}
