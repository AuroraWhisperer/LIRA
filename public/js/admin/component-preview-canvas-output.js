import { previewElement } from './component-preview-surface.js';
import { copyText, localOverlayOrigin } from '../shared/utils.js';
import { sceneSourceUrl } from './scene-source-url.js';
import { getCanvasPublicationEntries } from './component-preview-publication.js';
import { SCENE_COMPONENTS } from '../shared/scene-components.js';

export function mountPreviewCanvasOutput({ sourceHost, applyHost, connection, controllers, beforeApply, getSelection, setBusy, report }) {
  let disposed = false;
  let busy = false;
  const source = previewElement('input', 'preview-canvas-source');
  source.readOnly = true;
  source.hidden = true;
  source.setAttribute('aria-label', '直播源地址');
  const copy = previewElement('button', 'secondary', '复制直播源地址');
  const copyComponent = previewElement('button', 'secondary', '复制单组件地址');
  const apply = previewElement('button', 'primary', '保存并应用');
  copy.type = copyComponent.type = apply.type = 'button';
  sourceHost.append(source, copy, copyComponent);
  applyHost.append(apply);
  async function run(action, item = null) {
    if (busy || (action === 'publish' && !beforeApply())) return;
    busy = true;
    setBusy(true);
    report(action === 'publish' ? '正在保存组件并更新直播源…' : '正在获取直播源地址…');
    try {
      if (action === 'publish') {
        const targets = getCanvasPublicationEntries(controllers);
        const canvas = targets.at(-1).controller;
        const document = JSON.stringify(canvas.getState().draft.document);
        await Promise.all(targets.map(({ controller }) => controller.flush()));
        if (JSON.stringify(canvas.getState().draft.document) !== document) throw new Error('场景已变化，请再次保存并应用。');
      }
      const result = await connection.execute(action);
      if (disposed) return;
      if (action === 'source') {
        if (item && !result.itemIds?.includes(item.id)) throw new Error('请先保存并应用此组件，再复制单组件地址。');
        const url = item?.appearance.mode === 'shared'
          ? new URL(SCENE_COMPONENTS[item.type].sourceUrl, localOverlayOrigin()).href
          : sceneSourceUrl({ ...result, ...(item ? { item: item.id } : {}) });
        source.value = url;
        source.hidden = false;
        await copyText(url);
        report(item ? '单组件地址已复制，使用保存的像素尺寸' : '直播源地址已复制');
      } else report(() => controllers.some(({ controller }) => controller.getState().dirty)
        ? '本次已应用，新修改仍需保存' : '已保存并应用到直播源');
    } catch (error) {
      if (!disposed) report(error.message);
    } finally {
      busy = false;
      if (!disposed) setBusy(false);
    }
  }
  copy.addEventListener('click', () => { void run('source'); });
  copyComponent.addEventListener('click', () => { const item = getSelection?.(); if (item) void run('source', item); });
  apply.addEventListener('click', () => { void run('publish'); });
  return {
    render(connected, saving) {
      copy.disabled = apply.disabled = !connected || saving || busy;
      copyComponent.hidden = !getSelection?.();
      copyComponent.disabled = copy.disabled;
    },
    dispose() { disposed = true; source.remove(); copy.remove(); copyComponent.remove(); apply.remove(); },
  };
}
