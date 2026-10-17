import { previewElement, previewToolbarIcon } from './component-preview-surface.js';
import { copyText, localOverlayOrigin } from '../shared/utils.js';
import { bindCopyUrl } from '../shared/copy-url.js';
import { sceneSourceUrl } from './scene-source-url.js';
import { getCanvasPublicationEntries } from './component-preview-publication.js';
import { SCENE_COMPONENTS } from '../shared/scene-components.js';

export function mountPreviewCanvasOutput({ sourceHost, applyHost, connection, controllers, beforeApply, flushAppearance, getSelection, setBusy, report }) {
  let disposed = false;
  let busy = false;
  let sourceButton = null;
  const source = previewElement('button', 'copy-url preview-canvas-source');
  source.id = 'previewCanvasSource';
  source.hidden = true;
  source.setAttribute('aria-label', '复制直播源地址');
  const disposeSource = bindCopyUrl(source, {
    onCopied: () => report('直播源地址已复制', 'success'),
    onError: error => report(error.message, 'error'),
  });
  const copy = previewElement('button', 'secondary preview-canvas-icon-button');
  copy.title = '复制整个场景的直播源地址，应用修改后继续使用此地址';
  copy.setAttribute('aria-label', '复制场景地址');
  copy.append(previewToolbarIcon('link'));
  const copyComponent = previewElement('button', 'secondary', '组件地址');
  copyComponent.setAttribute('aria-label', '复制组件地址');
  copyComponent.title = '复制所选组件的直播源地址';
  const apply = previewElement('button', 'primary', '保存并应用');
  copy.type = copyComponent.type = apply.type = 'button';
  sourceHost.append(source, copy, copyComponent);
  applyHost.append(apply);
  for (const button of [copy, copyComponent]) {
    button.setAttribute('aria-controls', source.id);
    button.setAttribute('aria-expanded', 'false');
  }
  function showSource(button) {
    sourceButton = button;
    source.hidden = !button;
    copy.setAttribute('aria-expanded', String(button === copy));
    copyComponent.setAttribute('aria-expanded', String(button === copyComponent));
  }
  function dismissSource(event) {
    if (!source.hidden && !sourceHost.contains(event.target)) showSource(null);
  }
  function escapeSource(event) {
    if (event.key !== 'Escape' || source.hidden) return;
    event.preventDefault();
    if (document.activeElement === source) sourceButton?.focus({ preventScroll: true });
    showSource(null);
  }
  function toggleSource(item = null) {
    if (sourceButton === (item ? copyComponent : copy)) showSource(null);
    else void run('source', item);
  }
  document.addEventListener('pointerdown', dismissSource, true);
  document.addEventListener('keydown', escapeSource);
  async function run(action, item = null) {
    if (busy || (action === 'publish' && !beforeApply())) return;
    busy = true;
    setBusy(true);
    report(action === 'publish' ? '正在保存组件并更新直播源…' : '正在获取直播源地址…', 'info');
    try {
      if (action === 'publish') {
        await flushAppearance?.();
        const targets = getCanvasPublicationEntries(controllers);
        const canvas = targets.at(-1).controller;
        const document = JSON.stringify(canvas.getState().draft.document);
        await Promise.all(targets.map(({ controller }) => controller.flush()));
        if (JSON.stringify(canvas.getState().draft.document) !== document) throw new Error('场景已变化，请再次保存并应用。');
      }
      const sharedSource = action === 'source' && item?.appearance.mode === 'shared';
      const result = await connection.execute(action);
      if (disposed) return;
      if (action === 'source') {
        if (item && !result.itemIds?.includes(item.id)) throw new Error('请先保存并应用此组件，再复制单组件地址。');
        const url = item?.appearance.mode === 'shared'
          ? new URL(SCENE_COMPONENTS[item.type].sourceUrl, localOverlayOrigin()).href
          : sceneSourceUrl({ ...result, ...(item ? { item: item.id } : {}) });
        source.textContent = url;
        showSource(item ? copyComponent : copy);
        await copyText(url);
        const size = sharedSource ? result.componentSizes?.[item.type] : item ? result.itemSizes?.[item.id] : result.canvas;
        report(`${item ? '单组件地址已复制' : '直播源地址已复制'}${size ? `；请在 OBS 或直播姬中设置为 ${size.width} × ${size.height}` : '；请使用已发布画面的像素尺寸'}。之后保存并应用即可更新，无需重复导入。`, 'success');
      } else report(() => controllers.some(({ controller }) => controller.getState().dirty)
        ? '本次已应用，新修改仍需保存' : '已保存并应用到直播源', 'success');
    } catch (error) {
      if (!disposed) report(error.message);
    } finally {
      busy = false;
      if (!disposed) setBusy(false);
    }
  }
  copy.addEventListener('click', () => toggleSource());
  copyComponent.addEventListener('click', () => { const item = getSelection?.(); if (item) toggleSource(item); });
  apply.addEventListener('click', () => { void run('publish'); });
  return {
    render(connected, saving) {
      copy.disabled = apply.disabled = !connected || saving || busy;
      source.disabled = copy.disabled;
      copyComponent.hidden = !getSelection?.();
      copyComponent.disabled = copy.disabled;
    },
    dispose() {
      disposed = true;
      disposeSource();
      document.removeEventListener('pointerdown', dismissSource, true);
      document.removeEventListener('keydown', escapeSource);
      source.remove(); copy.remove(); copyComponent.remove(); apply.remove();
    },
  };
}
