import { copyText } from '../shared/utils.js';
import { createDanmakuPreview, openDanmakuCanvas } from './danmaku-canvas-dialog.js';
import { registerComponentPreview } from './component-preview-registry.js';
import { observeServerOverlayUrl } from './server-overlay-url.js';
import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';
import { isValidFullscreenDuration } from '../shared/danmaku-appearance-draft.js';
import { createComponentConfigController, componentSaveMessage } from './component-config-controller.js';
import { bindDanmakuParameters } from './danmaku-parameter-view.js';
import { saveComponentWithFeedback } from './component-save-feedback.js';
import { normalizeStyleParameters } from '../shared/component-style-parameters.js';

function bindStyleGroups() {
  const groups = ['Fixed', 'Random', 'Floating'].map((name) => ({
    tab: document.getElementById(`danmaku${name}StyleTab`),
    panel: document.getElementById(`danmaku${name}Styles`),
  }));
  function select(index) {
    groups.forEach(({ tab, panel }, current) => {
      const active = current === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panel.hidden = !active;
    });
  }
  groups.forEach(({ tab }, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % groups.length;
      else if (event.key === 'ArrowLeft') next = (index + groups.length - 1) % groups.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = groups.length - 1;
      else return;
      event.preventDefault();
      groups[next].tab.focus();
      select(next);
    });
  });
  return (style) => {
    const layout = DANMAKU_STYLE_OPTIONS[style].layout;
    select(layout === 'floating' ? 2 : layout === 'fullscreen-random' ? 1 : 0);
  };
}

export function initDanmakuOverlaySettings(elements, toast) {
  let overlayUrl = '';
  let canvasEditor = null;
  const bridge = window.liraLicense;
  const applyButton = document.getElementById('danmakuApplyOverlayBtn');
  const reloadButton = document.getElementById('danmakuReloadOverlayBtn');
  const discardButton = document.getElementById('danmakuDiscardOverlayBtn');
  const showStyleGroup = bindStyleGroups();
  let displayedStyle;

  function settingsFrom(response, expectedUrl) {
    if (!response?.ok) throw new Error(response?.error === 'NETWORK_UNAVAILABLE'
      ? '无法连接服务器，请稍后重试。' : '暂时无法读取弹幕姬设置，请稍后重试；仍有问题时联系管理员。');
    if (!Object.hasOwn(DANMAKU_STYLE_OPTIONS, response.style)
      || !isValidFullscreenDuration(response.fullscreenDurationSeconds) || response.overlayUrl !== expectedUrl) {
      throw new Error('服务器返回的弹幕姬配置无效。');
    }
    return { style: response.style, fullscreenDurationSeconds: response.fullscreenDurationSeconds,
      ...(response.styleParameters === undefined ? {} : { styleParameters: response.styleParameters }),
      ...(response.styleOptions === undefined ? {} : { styleOptions: response.styleOptions }),
      ...(response.layout === undefined ? {} : { layout: response.layout }) };
  }

  const controller = createComponentConfigController({
    initial: { style: 'signal', fullscreenDurationSeconds: 6 },
    read: async () => {
      const expectedUrl = overlayUrl;
      return settingsFrom(await bridge.getOverlaySettings(), expectedUrl);
    },
    persist: async (submitted) => {
      const expectedUrl = overlayUrl;
      const saved = settingsFrom(await bridge.updateOverlaySettings(submitted), expectedUrl);
      if (Object.hasOwn(submitted, 'styleOptions') && !Object.hasOwn(saved, 'styleOptions')) {
        throw new Error('服务器未保存样式参数，请更新服务器后重试。');
      }
      if (Object.hasOwn(submitted, 'styleParameters') && Object.entries(normalizeStyleParameters('danmaku', submitted.styleParameters))
        .some(([style, parameters]) => JSON.stringify(saved.styleParameters?.[style]) !== JSON.stringify(parameters))) {
        throw new Error('服务器未完整保存效果参数，请更新服务器后重试。');
      }
      if (Object.hasOwn(submitted, 'layout') && !Object.hasOwn(saved, 'layout')) {
        throw new Error('服务器未保存画布，请更新服务器后重试。');
      }
      return saved;
    },
  });
  registerComponentPreview('danmaku', () => createDanmakuPreview({ controller }));
  controller.subscribe((state) => {
    const { draft, loaded, dirty, saving, loading } = state;
    if (draft.style !== displayedStyle) {
      showStyleGroup(draft.style);
      displayedStyle = draft.style;
    }
    elements.overlayUrl.value = overlayUrl;
    elements.overlayUrl.placeholder = '登录 LIRA 后显示直播画面链接';
    for (const button of elements.styleButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.danmakuStyle === draft.style));
      button.disabled = !loaded;
    }
    elements.styleChip.textContent = loaded
      ? `${dirty ? '待应用' : '已应用样式'} · ${DANMAKU_STYLE_OPTIONS[draft.style].label}`
      : loading ? '正在读取样式' : '尚未读取样式';
    elements.styleSaveState.textContent = !overlayUrl ? '请先连接已授权的 LIRA 账号。'
      : state.error ? `应用失败，草稿已保留：${state.error}` : componentSaveMessage(state);
    for (const button of [elements.copyOverlayUrlButton, elements.openOverlayButton]) button.disabled = !overlayUrl;
    elements.previewOverlayButton.disabled = false;
    applyButton.disabled = !loaded || !dirty || saving;
    applyButton.textContent = saving ? '正在应用…' : '应用到直播画面';
    reloadButton.disabled = !overlayUrl || loading || saving;
    if (discardButton) discardButton.disabled = !dirty || saving;
  });
  bindDanmakuParameters(document, controller, (message) => { elements.styleSaveState.textContent = message; });
  for (const button of elements.styleButtons) {
    button.addEventListener('click', () => {
      if (controller.getState().loaded && Object.hasOwn(DANMAKU_STYLE_OPTIONS, button.dataset.danmakuStyle)) {
        controller.edit({ style: button.dataset.danmakuStyle });
      }
    });
  }
  applyButton.addEventListener('click', () => saveComponentWithFeedback(controller, '弹幕姬样式', toast));
  discardButton?.addEventListener('click', () => controller.discard());
  reloadButton.addEventListener('click', () => { if (overlayUrl) return controller.reload(); });
  elements.copyOverlayUrlButton.addEventListener('click', async () => {
    if (!overlayUrl) return;
    try { await copyText(overlayUrl); toast('弹幕姬直播画面链接已复制'); }
    catch (error) { toast(error.message || '复制链接失败'); }
  });
  elements.openOverlayButton.addEventListener('click', () => {
    if (overlayUrl) window.open(overlayUrl, '_blank', 'noopener');
  });
  elements.previewOverlayButton.addEventListener('click', () => {
    canvasEditor = openDanmakuCanvas({ controller });
  });
  observeServerOverlayUrl((url) => {
    if (url === overlayUrl) return;
    canvasEditor?.close();
    canvasEditor = null;
    overlayUrl = url;
    controller.reset();
    if (url) void controller.reload();
  });
  return controller;
}
