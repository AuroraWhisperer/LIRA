import { createDanmakuPreview, openDanmakuCanvas } from './danmaku-canvas-dialog.js';
import { registerComponentPreview } from './component-preview-registry.js';
import { observeAuthorizedAccount } from './authorized-account.js';
import { readDanmakuAppearance, saveDanmakuAppearance } from './danmaku-appearance-api.js';
import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';
import { isValidFullscreenDuration } from '../shared/danmaku-appearance-draft.js';
import { createComponentConfigController, componentSaveMessage } from './component-config-controller.js';
import { bindDanmakuParameters } from './danmaku-parameter-view.js';
import { saveComponentWithFeedback } from './component-save-feedback.js';
import { bindDanmakuStyleLibrary } from './danmaku-style-library.js';

export function initDanmakuOverlaySettings(elements, toast) {
  let account = '';
  let accountGeneration = 0;
  let binding = '';
  let canvasEditor = null;
  const applyButton = document.getElementById('danmakuApplyOverlayBtn');
  const reloadButton = document.getElementById('danmakuReloadOverlayBtn');
  const discardButton = document.getElementById('danmakuDiscardOverlayBtn');

  function settingsFrom(response) {
    if (typeof response?.binding !== 'string' || !response.binding
      || !Object.hasOwn(DANMAKU_STYLE_OPTIONS, response.config?.style)
      || !isValidFullscreenDuration(response.config?.fullscreenDurationSeconds)) {
      throw new Error('本机弹幕外观配置无效，请重新读取。');
    }
    return response.config;
  }

  const controller = createComponentConfigController({
    initial: { style: 'signal', fullscreenDurationSeconds: 6 },
    read: async () => {
      const expectedGeneration = accountGeneration;
      const response = await readDanmakuAppearance();
      const config = settingsFrom(response);
      if (accountGeneration === expectedGeneration) binding = response.binding;
      return config;
    },
    persist: async (submitted) => {
      const expectedBinding = binding;
      const response = await saveDanmakuAppearance({ binding: expectedBinding, config: submitted });
      if (response?.binding !== expectedBinding) throw new Error('账号授权已变化，请重新读取后重试。');
      return settingsFrom(response);
    },
  });
  bindDanmakuStyleLibrary({ buttons: elements.styleButtons, controller, getAccount: () => account });
  registerComponentPreview('danmaku', () => createDanmakuPreview({ controller }));
  controller.subscribe((state) => {
    const { draft, loaded, dirty, saving, loading } = state;
    elements.styleChip.textContent = loaded
      ? `${dirty ? '待应用' : '已应用样式'} · ${DANMAKU_STYLE_OPTIONS[draft.style].label}`
      : loading ? '正在读取样式' : '尚未读取样式';
    elements.styleSaveState.textContent = !account ? '请先连接已授权的 LIRA 账号。' : componentSaveMessage(state);
    elements.previewOverlayButton.disabled = false;
    applyButton.disabled = !loaded || !dirty || saving;
    applyButton.textContent = saving ? '正在保存…' : '保存外观';
    reloadButton.disabled = !account || loading || saving;
    if (discardButton) discardButton.disabled = !dirty || saving;
  });
  bindDanmakuParameters(document, controller, (message) => { elements.styleSaveState.textContent = message; });
  applyButton.addEventListener('click', () => saveComponentWithFeedback(controller, '弹幕姬样式', toast));
  discardButton?.addEventListener('click', () => controller.discard());
  reloadButton.addEventListener('click', () => { if (account) return controller.reload(); });
  elements.previewOverlayButton.addEventListener('click', () => {
    canvasEditor = openDanmakuCanvas({ controller });
  });
  observeAuthorizedAccount((next) => {
    if (next === account) return;
    canvasEditor?.close();
    canvasEditor = null;
    account = next;
    accountGeneration += 1;
    binding = '';
    controller.reset();
    if (account) void controller.reload();
  });
  return controller;
}
