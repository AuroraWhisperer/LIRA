'use strict';

import { readApiResponse } from '../shared/json-response.js';
import { localOverlayOrigin, toast } from '../shared/utils.js';
import { bindCopyUrl } from '../shared/copy-url.js';
import { clockSettingsPayload, clockConfigFromSettings } from '../shared/clock-settings.js';
import { createComponentConfigController } from './component-config-controller.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { registerComponentPreview } from './component-preview-registry.js';
import { bindClockParameters, buildClockUrl, createClockPreview } from './clock-preview.js';
import { registerComponentSettings } from './component-settings-sync.js';
import { saveComponentSettings, confirmComponentSettings } from './component-settings-save.js';
import { saveComponentWithFeedback } from './component-save-feedback.js';
import { readComponentOutputSize } from './scene-api.js';
import { bindComponentAutosave } from './settings-autosave.js';

let initialized = false;

function initClockCard() {
  if (initialized) return;
  const preview = document.getElementById('clockPreview');
  if (!preview) return;
  initialized = true;
  const fixedUrl = `${localOverlayOrigin(location)}/clock`;
  const controller = createComponentConfigController({
    initial: clockConfigFromSettings({}),
    confirm: async () => clockConfigFromSettings(await confirmComponentSettings()),
    read: async () => {
      const response = await fetch('/api/clock/config', { cache: 'no-store' });
      const payload = await readApiResponse(response, '时钟配置读取失败，请重新读取。');
      if (!payload.data) throw new Error('时钟配置读取失败，请重新读取。');
      return clockConfigFromSettings(clockSettingsPayload(payload.data));
    },
    persist: async (config) => {
      const settings = await saveComponentSettings(clockSettingsPayload(config));
      if (settings.clockStyle !== config.style) throw new Error('服务端未保存时钟样式，请更新服务后重试。');
      return clockConfigFromSettings(settings);
    },
  });
  bindClockParameters(document, controller);
  function updatePreview() {
    const state = controller.getState();
    if (!state.loaded) return;
    if (!preview.getAttribute('src')) {
      const url = new URL(buildClockUrl(new URL('/clock', location.href).href, state.draft));
      url.searchParams.set('componentPreview', '1');
      url.searchParams.set('previewFit', 'contain');
      preview.src = url.href;
    } else {
      preview.contentWindow?.postMessage({ type: 'component-preview:config', config: state.draft }, '*');
    }
  }
  controller.subscribe((state) => {
    preview.dataset.clockStyle = state.draft.style;
    document.getElementById('clockSave').disabled = !state.loaded || !state.dirty || state.saving;
    document.getElementById('clockDiscard').disabled = !state.dirty || state.saving;
    updatePreview();
  });
  registerComponentSettings('clock', controller, clockConfigFromSettings, clockSettingsPayload);
  preview.addEventListener('load', updatePreview);
  window.addEventListener('message', (event) => {
    if (event.source === preview.contentWindow && event.origin === 'null' && event.data?.type === 'component-preview:ready') updatePreview();
  });
  document.getElementById('clockFixedUrl').textContent = fixedUrl;
  bindCopyUrl(document.getElementById('clockCopyFixed'), {
    getUrl: () => fixedUrl,
    onCopied: async () => {
      const size = await readComponentOutputSize('clock').catch(() => null);
      toast(size ? `时钟浏览器源地址已复制；浏览器源尺寸设为 ${size.width} × ${size.height}`
        : '时钟浏览器源地址已复制；需要固定宽高时，请在画布中调整后点击“保存并应用”。');
    },
    onError: error => toast(error.message || '复制失败，请手动复制网址。'),
  });
  document.getElementById('clockSave').addEventListener('click', () => saveComponentWithFeedback(controller, '时钟设置'));
  document.getElementById('clockDiscard').addEventListener('click', () => controller.discard());
  document.getElementById('clockReload').addEventListener('click', () => controller.reload());
  const getClockPreview = () => createClockPreview({ controller });
  registerComponentPreview('clock', getClockPreview);
  document.getElementById('clockOpenPreview').addEventListener('click', () => openComponentPreview(getClockPreview()));
  bindComponentAutosave(controller, { root: document.getElementById('otherClockFeature'),
    saveButton: document.getElementById('clockSave'), discardButton: document.getElementById('clockDiscard'),
    status: document.getElementById('clockSaveState') });
  void controller.reload();
  return controller;
}

export { initClockCard };
