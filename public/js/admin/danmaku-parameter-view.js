import { DANMAKU_STYLE_OPTIONS, isRandomDanmakuStyle, styleOptionsFor } from '../shared/danmaku-style-options.js';
import { readAppearanceValue, editStyleOption, resetStyleOptions, isValidFullscreenDuration } from '../shared/danmaku-appearance-draft.js';
import { ensureSavedFontOption, registerLocalFontSelect } from './local-font-library.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from '../shared/parameter-range.js';
import { componentField } from './component-preview-panel.js';

export function bindDanmakuParameters(root, controller, onError) {
  const node = (id) => componentField(root, id);
  const controls = Object.fromEntries(['fontFamily', 'fontSize', 'textColor', 'backgroundOpacity', 'giftImage', 'scrollDirection']
    .map((key) => [key, node(`danmaku${key[0].toUpperCase()}${key.slice(1)}`)]));
  const unregisterFont = registerLocalFontSelect(controls.fontFamily);
  initParameterRanges(controls.backgroundOpacity);

  function render({ draft, loaded }) {
    const limits = DANMAKU_STYLE_OPTIONS[draft.style];
    const options = styleOptionsFor(draft.style, draft.styleOptions);
    const supported = Object.hasOwn(draft, 'styleOptions');
    node('danmakuParametersTitle').textContent = `参数调节 · ${limits.label}`;
    node('danmakuParametersHint').textContent = !loaded ? '登录并读取配置后可调节参数。'
      : !supported ? '当前服务器尚不支持参数调节，请更新服务器。' : '';
    node('danmakuParametersHint').hidden = loaded && supported;
    const selectedFont = { default: draft.style === 'outline' ? '"Segoe UI"' : '"Microsoft YaHei UI"',
      sans: '"Microsoft YaHei UI"', serif: '"SimSun"', kai: '"KaiTi"' }[options.fontFamily] || options.fontFamily;
    ensureSavedFontOption(controls.fontFamily, selectedFont);
    controls.fontFamily.value = selectedFont;
    controls.fontSize.min = String(limits.minFontSize);
    controls.fontSize.max = String(limits.maxFontSize);
    controls.fontSize.value = String(options.fontSize);
    controls.textColor.value = options.textColor;
    node('danmakuTextColorValue').textContent = options.textColor.toUpperCase();
    node('danmakuFontSizeHint').textContent = `${limits.minFontSize}～${limits.maxFontSize} px`;
    node('danmakuBackgroundOpacityField').hidden = !limits.background;
    controls.backgroundOpacity.value = String(options.backgroundOpacity);
    refreshParameterRange(controls.backgroundOpacity);
    node('danmakuBackgroundOpacityValue').textContent = `${options.backgroundOpacity}%`;
    node('danmakuGiftImageField').hidden = !limits.giftImage;
    controls.giftImage.value = options.giftImage;
    node('danmakuScrollDirectionField').hidden = !limits.scrollDirection;
    controls.scrollDirection.value = options.scrollDirection;
    for (const control of Object.values(controls)) control.disabled = !loaded || !supported;
    node('danmakuResetParameters').disabled = !loaded || !supported || !Object.keys(draft.styleOptions?.[draft.style] || {}).length;
    node('danmakuFullscreenDurationField').hidden = !isRandomDanmakuStyle(draft.style);
    node('danmakuFullscreenDurationSeconds').value = String(draft.fullscreenDurationSeconds);
    node('danmakuFullscreenDurationSeconds').disabled = !loaded;
  }

  for (const [key, control] of Object.entries(controls)) {
    control.addEventListener(['backgroundOpacity', 'textColor'].includes(key) ? 'input' : 'change', () => {
      const state = controller.getState();
      if (!state.loaded || !Object.hasOwn(state.draft, 'styleOptions')) return;
      try {
        const value = readAppearanceValue(key, control.value, control.min, control.max);
        controller.edit({ styleOptions: editStyleOption(state.draft, key, value).styleOptions });
      } catch (error) { onError(error.message); render(state); }
    });
  }
  node('danmakuResetParameters').addEventListener('click', () => {
    const state = controller.getState();
    if (state.loaded && Object.hasOwn(state.draft, 'styleOptions')) {
      controller.edit({ styleOptions: resetStyleOptions(state.draft).styleOptions });
    }
  });
  node('danmakuFullscreenDurationSeconds').addEventListener('change', () => {
    const state = controller.getState();
    if (!state.loaded) return;
    const duration = Number(node('danmakuFullscreenDurationSeconds').value);
    if (!isValidFullscreenDuration(duration)) {
      onError('停留时间请输入 2～30 秒的整数。');
      render(state);
      return;
    }
    controller.edit({ fullscreenDurationSeconds: duration });
  });
  const unsubscribe = controller.subscribe(render);
  return { dispose() { unsubscribe(); unregisterFont?.(); disposeParameterRanges(controls.backgroundOpacity); } };
}
