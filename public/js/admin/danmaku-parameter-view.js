import { mountStyleParameters } from './component-style-parameters.js';
import { DANMAKU_STYLE_OPTIONS, isRandomDanmakuStyle, styleOptionsFor } from '../shared/danmaku-style-options.js';
import { readAppearanceValue, editStyleOption, resetStyleOptions, isValidFullscreenDuration,
  floatingSpeedFromPixelsPerSecond, floatingSpeedToPixelsPerSecond, floatingSpeedLabel } from '../shared/danmaku-appearance-draft.js';
import { ensureSavedFontOption, registerFontSelect } from '../shared/font-library.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from '../shared/parameter-range.js';
import { componentField, syncComponentFieldValue, subscribeComponentFields } from './component-preview-panel.js';
import { enhanceColorControls } from '../shared/color-control.js';

export function bindDanmakuParameters(root, controller, onError) {
  enhanceColorControls(root);
  const node = (id) => componentField(root, id);
  const controls = Object.fromEntries(['minGiftAmount', 'fontFamily', 'fontSize', 'textColor', 'bubbleColor', 'backgroundOpacity', 'giftImage', 'scrollDirection', 'edgeFade', 'entranceAnimation', 'decorationShape', 'floatingSpeed', 'floatingDispersion', 'centerBias', 'dispersion']
    .map((key) => [key, node(`danmaku${key[0].toUpperCase()}${key.slice(1)}`)]));
  const unregisterFont = registerFontSelect(controls.fontFamily);
  const ranges = ['backgroundOpacity', 'floatingSpeed', 'floatingDispersion', 'centerBias', 'dispersion'];
  ranges.forEach((key) => initParameterRanges(controls[key]));
  let renderedStyle;

  function renderRangeValue(key, speed) {
    const value = controls[key].value;
    const label = key === 'floatingSpeed'
      ? floatingSpeedLabel(speed ?? floatingSpeedToPixelsPerSecond(Number(value)))
      : `${value}${key === 'backgroundOpacity' ? '%' : ''}`;
    node(`danmaku${key[0].toUpperCase()}${key.slice(1)}Value`).textContent = label;
  }

  function render({ draft, loaded }, force = false) {
    force ||= renderedStyle !== draft.style;
    renderedStyle = draft.style;
    const limits = DANMAKU_STYLE_OPTIONS[draft.style];
    const options = styleOptionsFor(draft.style, draft.styleOptions);
    const supported = Object.hasOwn(draft, 'styleOptions');
    node('danmakuParametersTitle').textContent = `参数调节 · ${limits.label}`;
    node('danmakuParametersHint').textContent = !loaded ? '登录并读取配置后可调节参数。'
      : !supported ? '当前服务暂不支持参数调节，请联系管理员。' : '';
    node('danmakuParametersHint').hidden = loaded && supported;
    const selectedFont = { default: draft.style === 'starveil' ? '"SimSun"' : draft.style === 'outline' ? '"Segoe UI"' : '"Microsoft YaHei UI"',
      sans: '"Microsoft YaHei UI"', serif: '"SimSun"', kai: '"KaiTi"' }[options.fontFamily] || options.fontFamily;
    ensureSavedFontOption(controls.fontFamily, selectedFont);
    controls.fontFamily.value = selectedFont;
    controls.fontSize.min = String(limits.minFontSize);
    controls.fontSize.max = String(limits.maxFontSize);
    syncComponentFieldValue(controls.fontSize, options.fontSize, force);
    syncComponentFieldValue(controls.textColor, options.textColor, force);
    node('danmakuBubbleColorModeField').hidden = !limits.bubbleColor;
    const customBubbleColor = limits.bubbleColor && options.bubbleColor !== 'default';
    node('danmakuBubbleColorMode').value = customBubbleColor ? 'custom' : 'default';
    node('danmakuBubbleColorMode').disabled = !loaded || !supported;
    node('danmakuBubbleColorField').hidden = !customBubbleColor;
    syncComponentFieldValue(controls.bubbleColor, customBubbleColor ? options.bubbleColor : limits.defaultTextColor, force);
    node('danmakuTextColorLabel').textContent = draft.style === 'sketch' ? '主题颜色' : '正文颜色';
    node('danmakuFontSizeHint').textContent = `${limits.minFontSize}～${limits.maxFontSize} px`;
    node('danmakuBackgroundOpacityField').hidden = !limits.background;
    syncComponentFieldValue(controls.backgroundOpacity, options.backgroundOpacity, force);
    refreshParameterRange(controls.backgroundOpacity);
    renderRangeValue('backgroundOpacity');
    node('danmakuMinGiftAmountField').hidden = !limits.minGiftAmount;
    syncComponentFieldValue(controls.minGiftAmount, options.minGiftAmount || 0, force);
    node('danmakuGiftImageField').hidden = !limits.giftImage || ['identity', 'transparent', 'outline', 'bubble', 'cream'].includes(draft.style);
    controls.giftImage.value = options.giftImage;
    node('danmakuScrollDirectionField').hidden = !limits.scrollDirection;
    controls.scrollDirection.value = options.scrollDirection;
    node('danmakuEdgeFadeField').hidden = !limits.scrollDirection;
    controls.edgeFade.value = options.edgeFade || 'none';
    node('danmakuDecorationShapeField').hidden = !limits.decorationShape;
    controls.decorationShape.value = options.decorationShape || 'sparkle';
    node('danmakuEntranceAnimationField').hidden = !limits.entranceAnimation;
    controls.entranceAnimation.value = options.entranceAnimation || 'fade';
    node('danmakuSpeedField').hidden = !limits.speed;
    const speed = options.speedPixelsPerSecond || 120;
    syncComponentFieldValue(controls.floatingSpeed, floatingSpeedFromPixelsPerSecond(speed), force);
    renderRangeValue('floatingSpeed', Number(controls.floatingSpeed.value) === floatingSpeedFromPixelsPerSecond(speed) ? speed : undefined);
    refreshParameterRange(controls.floatingSpeed);
    node('danmakuFloatingDispersionField').hidden = !limits.speed;
    syncComponentFieldValue(controls.floatingDispersion, options.floatingDispersion ?? 50, force);
    renderRangeValue('floatingDispersion');
    refreshParameterRange(controls.floatingDispersion);
    node('danmakuDistributionOptions').hidden = !isRandomDanmakuStyle(draft.style);
    for (const key of ['centerBias', 'dispersion']) {
      const name = key[0].toUpperCase() + key.slice(1);
      node(`danmaku${name}Field`).hidden = !isRandomDanmakuStyle(draft.style);
      syncComponentFieldValue(controls[key], options[key] ?? 1, force);
      renderRangeValue(key);
      refreshParameterRange(controls[key]);
    }
    for (const control of Object.values(controls)) control.disabled = !loaded || !supported;
    node('danmakuResetParameters').disabled = !loaded || !supported || !Object.keys(draft.styleOptions?.[draft.style] || {}).length;
    node('danmakuFullscreenDurationField').hidden = !isRandomDanmakuStyle(draft.style);
    syncComponentFieldValue(node('danmakuFullscreenDurationSeconds'), draft.fullscreenDurationSeconds, force);
    node('danmakuFullscreenDurationSeconds').disabled = !loaded;
  }

  for (const [key, control] of Object.entries(controls)) {
    if (ranges.includes(key)) control.addEventListener('input', () => renderRangeValue(key));
    control.addEventListener('change', () => {
      const state = controller.getState();
      if (!state.loaded || !Object.hasOwn(state.draft, 'styleOptions')) return;
      try {
        const value = readAppearanceValue(key, control.value, control.min, control.max);
        controller.edit({ styleOptions: editStyleOption(state.draft, key, value).styleOptions });
      } catch (error) { onError(error.message, control); render(state, true); }
    });
  }
  node('danmakuBubbleColorMode').addEventListener('change', () => {
    const state = controller.getState();
    if (!state.loaded || !Object.hasOwn(state.draft, 'styleOptions')) return;
    const value = node('danmakuBubbleColorMode').value === 'default' ? 'default' : controls.bubbleColor.value;
    controller.edit({ styleOptions: editStyleOption(state.draft, 'bubbleColor', value).styleOptions });
  });
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
      render(state, true);
      return;
    }
    controller.edit({ fullscreenDurationSeconds: duration });
  });
  const effects = mountStyleParameters(node('danmakuAppearanceEffects'), controller, 'danmaku', {
    messageHost: node('danmakuMessageOptions'),
  });
  const unsubscribe = subscribeComponentFields(node('danmakuParametersTitle').closest('.danmaku-parameters'), controller, render);
  return { dispose() { effects.dispose(); unsubscribe(); unregisterFont?.(); ranges.forEach((key) => disposeParameterRanges(controls[key])); } };
}
