import { mountStyleParameters } from './component-style-parameters.js';
import { DANMAKU_STYLE_OPTIONS, isRandomDanmakuStyle, styleOptionsFor } from '../shared/danmaku-style-options.js';
import { readAppearanceValue, editStyleOption, resetStyleOptions, isValidFullscreenDuration } from '../shared/danmaku-appearance-draft.js';
import { ensureSavedFontOption, registerLocalFontSelect } from './local-font-library.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from '../shared/parameter-range.js';
import { componentField, syncComponentFieldValue } from './component-preview-panel.js';

export function bindDanmakuParameters(root, controller, onError) {
  const node = (id) => componentField(root, id);
  const controls = Object.fromEntries(['fontFamily', 'fontSize', 'textColor', 'backgroundOpacity', 'giftImage', 'scrollDirection', 'edgeFade', 'speedPixelsPerSecond', 'centerBias', 'dispersion']
    .map((key) => [key, node(`danmaku${key[0].toUpperCase()}${key.slice(1)}`)]));
  const unregisterFont = registerLocalFontSelect(controls.fontFamily);
  const ranges = ['backgroundOpacity', 'centerBias', 'dispersion'];
  ranges.forEach((key) => initParameterRanges(controls[key]));

  function render({ draft, loaded }, force = false) {
    const limits = DANMAKU_STYLE_OPTIONS[draft.style];
    const options = styleOptionsFor(draft.style, draft.styleOptions);
    const supported = Object.hasOwn(draft, 'styleOptions');
    node('danmakuParametersTitle').textContent = `参数调节 · ${limits.label}`;
    node('danmakuParametersHint').textContent = !loaded ? '登录并读取配置后可调节参数。'
      : !supported ? '当前服务器尚不支持参数调节，请更新服务器。' : '';
    node('danmakuParametersHint').hidden = loaded && supported;
    const selectedFont = { default: draft.style === 'starveil' ? '"SimSun"' : draft.style === 'outline' ? '"Segoe UI"' : '"Microsoft YaHei UI"',
      sans: '"Microsoft YaHei UI"', serif: '"SimSun"', kai: '"KaiTi"' }[options.fontFamily] || options.fontFamily;
    ensureSavedFontOption(controls.fontFamily, selectedFont);
    controls.fontFamily.value = selectedFont;
    controls.fontSize.min = String(limits.minFontSize);
    controls.fontSize.max = String(limits.maxFontSize);
    syncComponentFieldValue(controls.fontSize, options.fontSize, force);
    controls.textColor.value = options.textColor;
    node('danmakuTextColorLabel').textContent = draft.style === 'sketch' ? '主题颜色' : '正文颜色';
    node('danmakuFontSizeHint').textContent = `${limits.minFontSize}～${limits.maxFontSize} px`;
    node('danmakuBackgroundOpacityField').hidden = !limits.background;
    controls.backgroundOpacity.value = String(options.backgroundOpacity);
    refreshParameterRange(controls.backgroundOpacity);
    node('danmakuBackgroundOpacityValue').textContent = `${options.backgroundOpacity}%`;
    node('danmakuGiftImageField').hidden = !limits.giftImage;
    controls.giftImage.value = options.giftImage;
    node('danmakuScrollDirectionField').hidden = !limits.scrollDirection;
    controls.scrollDirection.value = options.scrollDirection;
    node('danmakuEdgeFadeField').hidden = !limits.scrollDirection;
    controls.edgeFade.value = options.edgeFade || 'none';
    node('danmakuSpeedField').hidden = !limits.speed;
    syncComponentFieldValue(controls.speedPixelsPerSecond, options.speedPixelsPerSecond || 120, force);
    node('danmakuDistributionOptions').hidden = !isRandomDanmakuStyle(draft.style);
    for (const key of ['centerBias', 'dispersion']) {
      const name = key[0].toUpperCase() + key.slice(1);
      node(`danmaku${name}Field`).hidden = !isRandomDanmakuStyle(draft.style);
      controls[key].value = String(options[key] ?? 1);
      node(`danmaku${name}Value`).textContent = controls[key].value;
      refreshParameterRange(controls[key]);
    }
    for (const control of Object.values(controls)) control.disabled = !loaded || !supported;
    node('danmakuResetParameters').disabled = !loaded || !supported || !Object.keys(draft.styleOptions?.[draft.style] || {}).length;
    node('danmakuFullscreenDurationField').hidden = !isRandomDanmakuStyle(draft.style);
    syncComponentFieldValue(node('danmakuFullscreenDurationSeconds'), draft.fullscreenDurationSeconds, force);
    node('danmakuFullscreenDurationSeconds').disabled = !loaded;
  }

  for (const [key, control] of Object.entries(controls)) {
    control.addEventListener([...ranges, 'textColor'].includes(key) ? 'input' : 'change', () => {
      const state = controller.getState();
      if (!state.loaded || !Object.hasOwn(state.draft, 'styleOptions')) return;
      try {
        const value = readAppearanceValue(key, control.value, control.min, control.max);
        controller.edit({ styleOptions: editStyleOption(state.draft, key, value).styleOptions });
      } catch (error) { onError(error.message); render(state, true); }
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
      render(state, true);
      return;
    }
    controller.edit({ fullscreenDurationSeconds: duration });
  });
  const effects = mountStyleParameters(node('danmakuAppearanceEffects'), controller, 'danmaku', {
    messageHost: node('danmakuMessageOptions'),
  });
  const unsubscribe = controller.subscribe(render);
  return { dispose() { effects.dispose(); unsubscribe(); unregisterFont?.(); ranges.forEach((key) => disposeParameterRanges(controls[key])); } };
}
