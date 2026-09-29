import { copyText } from '../shared/utils.js';
import { openDanmakuCanvas } from './danmaku-canvas-dialog.js';
import { observeServerOverlayUrl } from './server-overlay-url.js';
import { DANMAKU_STYLE_OPTIONS, isRandomDanmakuStyle, styleOptionsFor } from '../shared/danmaku-style-options.js';
import {
  readAppearanceValue,
  editStyleOption,
  resetStyleOptions,
  isValidFullscreenDuration,
} from '../shared/danmaku-appearance-draft.js';
import { ensureSavedFontOption, registerLocalFontSelect } from './local-font-library.js';
import { initParameterRanges, refreshParameterRange } from '../shared/parameter-range.js';

export function initDanmakuOverlaySettings(elements, toast) {
  let overlayUrl = '';
  let draft = { style: 'signal', fullscreenDurationSeconds: 6 };
  let revision = 0;
  let generation = 0;
  let dirty = false;
  let loaded = false;
  let loading = false;
  let saving = false;
  let canvasEditor = null;
  const bridge = window.liraLicense;
  const applyButton = document.getElementById('danmakuApplyOverlayBtn');
  const reloadButton = document.getElementById('danmakuReloadOverlayBtn');
  const parameterTitle = document.getElementById('danmakuParametersTitle');
  const parameterHint = document.getElementById('danmakuParametersHint');
  const resetButton = document.getElementById('danmakuResetParameters');
  const fontFamily = document.getElementById('danmakuFontFamily');
  const fontSize = document.getElementById('danmakuFontSize');
  const textColor = document.getElementById('danmakuTextColor');
  const backgroundOpacity = document.getElementById('danmakuBackgroundOpacity');
  const giftImage = document.getElementById('danmakuGiftImage');
  const scrollDirection = document.getElementById('danmakuScrollDirection');
  registerLocalFontSelect(fontFamily);
  initParameterRanges(backgroundOpacity);

  function render() {
    elements.overlayUrl.value = overlayUrl;
    elements.overlayUrl.placeholder = '登录 LIRA 后显示直播画面链接';
    elements.styleButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.danmakuStyle === draft.style));
      button.disabled = !loaded;
    });
    elements.styleChip.textContent = loaded
      ? `${dirty ? '待应用' : '已应用样式'} · ${DANMAKU_STYLE_OPTIONS[draft.style].label}`
      : loading
        ? '正在读取样式'
        : '尚未读取样式';
    elements.fullscreenDurationField.hidden = !isRandomDanmakuStyle(draft.style);
    elements.fullscreenDuration.value = String(draft.fullscreenDurationSeconds);
    elements.fullscreenDuration.disabled = !loaded;
    const limits = DANMAKU_STYLE_OPTIONS[draft.style];
    const options = styleOptionsFor(draft.style, draft.styleOptions);
    const supported = Object.hasOwn(draft, 'styleOptions');
    parameterTitle.textContent = `参数调节 · ${limits.label}`;
    parameterHint.textContent = !loaded
      ? '登录并读取配置后可调节参数。'
      : !supported
        ? '当前服务器尚不支持参数调节，请更新服务器。'
        : '各样式独立设置。';
    const selectedFont =
      {
        default: draft.style === 'outline' ? '"Segoe UI"' : '"Microsoft YaHei UI"',
        sans: '"Microsoft YaHei UI"',
        serif: '"SimSun"',
        kai: '"KaiTi"',
      }[options.fontFamily] || options.fontFamily;
    ensureSavedFontOption(fontFamily, selectedFont);
    fontFamily.value = selectedFont;
    fontSize.min = String(limits.minFontSize);
    fontSize.max = String(limits.maxFontSize);
    fontSize.value = String(options.fontSize);
    textColor.value = options.textColor;
    document.getElementById('danmakuTextColorValue').textContent = options.textColor.toUpperCase();
    document.getElementById('danmakuFontSizeHint').textContent = `${limits.minFontSize}～${limits.maxFontSize} px`;
    document.getElementById('danmakuBackgroundOpacityField').hidden = !limits.background;
    backgroundOpacity.value = String(options.backgroundOpacity);
    refreshParameterRange(backgroundOpacity);
    document.getElementById('danmakuBackgroundOpacityValue').textContent = `${options.backgroundOpacity}%`;
    document.getElementById('danmakuGiftImageField').hidden = !limits.giftImage;
    giftImage.value = options.giftImage;
    document.getElementById('danmakuScrollDirectionField').hidden = !limits.scrollDirection;
    scrollDirection.value = options.scrollDirection;
    for (const control of [fontFamily, fontSize, textColor, backgroundOpacity, giftImage, scrollDirection])
      control.disabled = !loaded || !supported;
    resetButton.disabled = !loaded || !supported || !Object.keys(draft.styleOptions?.[draft.style] || {}).length;
    for (const button of [elements.copyOverlayUrlButton, elements.openOverlayButton]) {
      button.disabled = !overlayUrl;
    }
    elements.previewOverlayButton.disabled = false;
    applyButton.disabled = !loaded || !dirty || saving;
    applyButton.textContent = saving ? '正在应用…' : '应用到直播画面';
    reloadButton.disabled = !overlayUrl || loading || saving || dirty;
  }

  function settingsFrom(response) {
    if (!response?.ok)
      throw new Error(
        response?.error === 'NETWORK_UNAVAILABLE'
          ? '无法连接服务器，请稍后重试。'
          : '暂时无法读取弹幕姬设置，请稍后重试；仍有问题时联系管理员。',
      );
    if (
      !Object.hasOwn(DANMAKU_STYLE_OPTIONS, response.style) ||
      !isValidFullscreenDuration(response.fullscreenDurationSeconds) ||
      response.overlayUrl !== overlayUrl
    )
      throw new Error('服务器返回的弹幕姬配置无效。');
    return {
      style: response.style,
      fullscreenDurationSeconds: response.fullscreenDurationSeconds,
      ...(response.styleOptions === undefined ? {} : { styleOptions: response.styleOptions }),
      ...(response.layout === undefined ? {} : { layout: response.layout }),
    };
  }

  async function reload() {
    if (!overlayUrl || loading || saving || dirty) return;
    const requestedGeneration = generation;
    const requestedRevision = revision;
    loading = true;
    elements.styleSaveState.textContent = '正在读取样式…';
    render();
    try {
      const response = await bridge.getOverlaySettings();
      if (requestedGeneration !== generation) return;
      const settings = settingsFrom(response);
      if (requestedRevision === revision) {
        draft = settings;
        loaded = true;
        elements.styleSaveState.textContent = '';
      }
    } catch (error) {
      if (requestedGeneration === generation) elements.styleSaveState.textContent = error.message;
    } finally {
      if (requestedGeneration === generation) {
        loading = false;
        render();
      }
    }
  }

  function edit(nextDraft) {
    draft = nextDraft;
    revision += 1;
    dirty = true;
    elements.styleSaveState.textContent = '修改尚未应用。';
    render();
  }

  elements.styleButtons.forEach((button) =>
    button.addEventListener('click', () => {
      if (loaded && Object.hasOwn(DANMAKU_STYLE_OPTIONS, button.dataset.danmakuStyle)) {
        edit({ ...draft, style: button.dataset.danmakuStyle });
      }
    }),
  );
  for (const [key, control] of Object.entries({
    fontFamily,
    fontSize,
    textColor,
    backgroundOpacity,
    giftImage,
    scrollDirection,
  })) {
    control.addEventListener(['backgroundOpacity', 'textColor'].includes(key) ? 'input' : 'change', () => {
      if (!loaded || !Object.hasOwn(draft, 'styleOptions')) return;
      let value;
      try {
        value = readAppearanceValue(key, control.value, control.min, control.max);
      } catch (error) {
        elements.styleSaveState.textContent = error.message;
        render();
        return;
      }
      edit(editStyleOption(draft, key, value));
    });
  }
  resetButton.addEventListener('click', () => {
    if (!loaded || !Object.hasOwn(draft, 'styleOptions')) return;
    edit(resetStyleOptions(draft));
  });
  elements.fullscreenDuration.addEventListener('change', () => {
    if (!loaded) return;
    const duration = Number(elements.fullscreenDuration.value);
    if (!isValidFullscreenDuration(duration)) {
      elements.styleSaveState.textContent = '停留时间请输入 2～30 秒的整数。';
      elements.fullscreenDuration.value = String(draft.fullscreenDurationSeconds);
      return;
    }
    edit({ ...draft, fullscreenDurationSeconds: duration });
  });
  async function applyDraft() {
    if (!loaded || !dirty || saving) return;
    const submittedRevision = revision;
    const submittedGeneration = generation;
    saving = true;
    canvasEditor?.status(true, '正在应用…');
    render();
    try {
      const response = await bridge.updateOverlaySettings({ ...draft });
      if (submittedGeneration !== generation) return;
      const saved = settingsFrom(response);
      if (Object.hasOwn(draft, 'styleOptions') && !Object.hasOwn(saved, 'styleOptions')) {
        throw new Error('服务器未保存样式参数，请更新服务器后重试。');
      }
      if (Object.hasOwn(draft, 'layout') && !Object.hasOwn(saved, 'layout')) {
        throw new Error('服务器未保存画布，请更新服务器后重试。');
      }
      if (submittedRevision === revision) {
        draft = saved;
        dirty = false;
      }
      elements.styleSaveState.textContent = dirty
        ? '已应用，仍有新修改待应用。'
        : '已应用到直播画面。';
      toast('弹幕姬样式已应用到直播画面');
    } catch (error) {
      if (submittedGeneration === generation)
        elements.styleSaveState.textContent = `应用失败，草稿已保留：${error.message}`;
    } finally {
      if (submittedGeneration === generation) {
        saving = false;
        canvasEditor?.status(false, elements.styleSaveState.textContent);
        render();
      }
    }
  }
  applyButton.addEventListener('click', applyDraft);
  reloadButton.addEventListener('click', reload);
  elements.copyOverlayUrlButton.addEventListener('click', async () => {
    if (!overlayUrl) return;
    try {
      await copyText(overlayUrl);
      toast('弹幕姬直播画面链接已复制');
    } catch (error) {
      toast(error.message || '复制链接失败');
    }
  });
  elements.openOverlayButton.addEventListener('click', () => {
    if (overlayUrl) window.open(overlayUrl, '_blank', 'noopener');
  });
  elements.previewOverlayButton.addEventListener('click', () => {
    canvasEditor?.close();
    canvasEditor = openDanmakuCanvas({ draft,
      canApply: loaded && Object.hasOwn(draft, 'layout') && Object.hasOwn(draft, 'styleOptions'),
      fonts: Array.from(fontFamily.options || []).map((option) => ({ value: option.value, label: option.textContent })),
      onChange: edit, onApply: applyDraft,
    });
  });
  observeServerOverlayUrl((url) => {
    if (url === overlayUrl) return;
    generation += 1;
    canvasEditor?.close();
    canvasEditor = null;
    overlayUrl = url;
    draft = { style: 'signal', fullscreenDurationSeconds: 6 };
    loaded = dirty = loading = saving = false;
    elements.styleSaveState.textContent = url ? '' : '请先连接已授权的 LIRA 账号。';
    render();
    void reload();
  });
  render();
}
