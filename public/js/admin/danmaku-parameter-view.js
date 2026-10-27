import { mountStyleParameters } from './component-style-parameters.js';
import { DANMAKU_STYLE_OPTIONS, RIPPLOID_COLOR_DEFAULTS, SPOOKY_THEME_COLORS, SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, TWITTER_COMPOSER_TEXT_MAX_LENGTH, TWITTER_LAYOUT_DEFAULTS, TWITTER_COLOR_DEFAULTS, inspectComposerText, isRandomDanmakuStyle, styleOptionsFor } from '../shared/danmaku-style-options.js';
import { readAppearanceValue, editStyleOption, resetStyleOptions, resetSpookyColors, isValidFullscreenDuration,
  floatingSpeedFromPixelsPerSecond, floatingSpeedToPixelsPerSecond, floatingSpeedLabel } from '../shared/danmaku-appearance-draft.js';
import { ensureSavedFontOption, registerFontSelect } from '../shared/font-library.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from '../shared/parameter-range.js';
import { componentField, syncComponentFieldValue, subscribeComponentFields } from './component-preview-panel.js';
import { enhanceColorControls } from '../shared/color-control.js';

export function bindDanmakuParameters(root, controller, onError) {
  enhanceColorControls(root);
  const node = (id) => componentField(root, id);
  const controls = Object.fromEntries(['minGiftAmount', 'composerText', 'fontFamily', 'fontSize', 'bubbleColor', 'backgroundOpacity', 'giftImage', 'scrollDirection', 'edgeFade', 'entranceAnimation', 'decorationShape', 'spookyTheme', 'spookyFrame', 'floatingSpeed', 'floatingDispersion', 'centerBias', 'dispersion', ...SPOOKY_COLOR_KEYS, ...SPOOKY_OPACITY_KEYS, ...Object.keys(RIPPLOID_COLOR_DEFAULTS), ...Object.keys(TWITTER_LAYOUT_DEFAULTS), ...Object.keys(TWITTER_COLOR_DEFAULTS)]
    .map((key) => [key, node(`danmaku${key[0].toUpperCase()}${key.slice(1)}`)]));
  const unregisterFont = registerFontSelect(controls.fontFamily);
  const ranges = ['backgroundOpacity', 'floatingSpeed', 'floatingDispersion', 'centerBias', 'dispersion', ...SPOOKY_OPACITY_KEYS];
  ranges.forEach((key) => initParameterRanges(controls[key]));
  let renderedStyle;

  function renderComposerTextCount() {
    node('danmakuComposerTextCount').textContent = `${inspectComposerText(controls.composerText.value).length}/${TWITTER_COMPOSER_TEXT_MAX_LENGTH}`;
  }
  controls.composerText.addEventListener('input', renderComposerTextCount);

  function renderRangeValue(key, speed) {
    const value = controls[key].value;
    const label = key === 'floatingSpeed'
      ? floatingSpeedLabel(speed ?? floatingSpeedToPixelsPerSecond(Number(value)))
      : `${value}${key.endsWith('Opacity') ? '%' : ''}`;
    node(`danmaku${key[0].toUpperCase()}${key.slice(1)}Value`).textContent = label;
  }

  function render({ draft, loaded }, force = false) {
    force ||= renderedStyle !== draft.style;
    renderedStyle = draft.style;
    const limits = DANMAKU_STYLE_OPTIONS[draft.style];
    const options = styleOptionsFor(draft.style, draft.styleOptions);
    const supported = Object.hasOwn(draft, 'styleOptions');
    node('danmakuComposerTextField').hidden = !limits.composerText || options.twitterComposer === 'hide';
    syncComponentFieldValue(controls.composerText, options.composerText || '', force);
    renderComposerTextCount();
    for (const [key, fallback] of Object.entries(TWITTER_LAYOUT_DEFAULTS)) {
      node(`danmaku${key[0].toUpperCase()}${key.slice(1)}Field`).hidden = !limits.twitterOptions;
      syncComponentFieldValue(controls[key], options[key] || fallback, force);
    }
    node('danmakuTwitterColors').hidden = !limits.twitterOptions;
    for (const [key, fallback] of Object.entries(TWITTER_COLOR_DEFAULTS)) {
      syncComponentFieldValue(controls[key], options[key] || fallback, force);
    }
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
    const ripploid = draft.style === 'ripploid';
    node('danmakuBubbleColorLabel').textContent = ripploid ? '聊天主色' : '弹幕配色';
    node('danmakuBubbleColorHint').textContent = ripploid
      ? '默认保留 RIPPLOID 聊天的多色徽章、昵称和装饰。自定义会将这些聊天装饰统一为一种颜色；礼物、上舰与 SC 使用下方各自的分级配色。'
      : '默认按当前直播间身份配色。自定义会同时改变普通弹幕的姓名条、边框、头像圈、正文和浅色底，SC、礼物与上舰保留原配色。';
    const customBubbleColor = limits.bubbleColor && options.bubbleColor !== 'default';
    node('danmakuBubbleColorMode').value = customBubbleColor ? 'custom' : 'default';
    node('danmakuBubbleColorMode').disabled = !loaded || !supported;
    node('danmakuBubbleColorField').hidden = !customBubbleColor;
    syncComponentFieldValue(controls.bubbleColor, customBubbleColor ? options.bubbleColor : limits.defaultBubbleColor || limits.defaultTextColor, force);
    node('danmakuRipploidColors').hidden = !limits.ripploidColors;
    for (const key of Object.keys(RIPPLOID_COLOR_DEFAULTS)) {
      syncComponentFieldValue(controls[key], options[key] || RIPPLOID_COLOR_DEFAULTS[key], force);
    }
    const spooky = Boolean(limits.spookyOptions);
    node('danmakuTextColorLabel').textContent = draft.style === 'sketch' ? '主题颜色' : spooky ? '自定义正文颜色' : '正文颜色';
    node('danmakuTextColorModeField').hidden = !spooky;
    node('danmakuTextColorField').hidden = spooky && !Object.hasOwn(draft.styleOptions?.spooky || {}, 'textColor');
    node('danmakuSpookyColors').hidden = !spooky;
    const themeColors = SPOOKY_THEME_COLORS[options.spookyTheme || 'default'];
    for (const key of SPOOKY_COLOR_KEYS) {
      const name = key[0].toUpperCase() + key.slice(1);
      const custom = spooky && Object.hasOwn(draft.styleOptions?.spooky || {}, key) && options[key] !== 'default';
      node(`danmaku${name}Mode`).value = custom ? 'custom' : 'default';
      node(`danmaku${name}Mode`).disabled = !loaded || !supported || !spooky;
      if (key !== 'textColor') node(`danmaku${name}Field`).hidden = !custom;
      if (spooky) syncComponentFieldValue(controls[key], custom ? options[key] : themeColors[key], force);
    }
    for (const key of SPOOKY_OPACITY_KEYS) {
      syncComponentFieldValue(controls[key], options[key] ?? 100, force);
      refreshParameterRange(controls[key]);
      renderRangeValue(key);
    }
    node('danmakuSpookyResetColors').disabled = !loaded || !supported
      || ![...SPOOKY_COLOR_KEYS, ...SPOOKY_OPACITY_KEYS].some(key => Object.hasOwn(draft.styleOptions?.spooky || {}, key));
    node('danmakuFontSizeHint').textContent = `${limits.minFontSize}～${limits.maxFontSize} px`;
    node('danmakuBackgroundOpacityField').hidden = !limits.background;
    syncComponentFieldValue(controls.backgroundOpacity, options.backgroundOpacity, force);
    refreshParameterRange(controls.backgroundOpacity);
    renderRangeValue('backgroundOpacity');
    node('danmakuMinGiftAmountField').hidden = !limits.minGiftAmount;
    syncComponentFieldValue(controls.minGiftAmount, options.minGiftAmount || 0, force);
    node('danmakuGiftImageField').hidden = !limits.giftImage || ['identity', 'transparent', 'outline', 'bubble', 'cream', 'twitter'].includes(draft.style);
    controls.giftImage.value = options.giftImage;
    node('danmakuScrollDirectionField').hidden = !limits.scrollDirection;
    controls.scrollDirection.value = options.scrollDirection;
    node('danmakuEdgeFadeField').hidden = !limits.scrollDirection;
    controls.edgeFade.value = options.edgeFade || 'none';
    for (const key of ['spookyTheme', 'spookyFrame']) {
      node(`danmaku${key[0].toUpperCase()}${key.slice(1)}Field`).hidden = !limits.spookyOptions;
      syncComponentFieldValue(controls[key], options[key] || (key === 'spookyTheme' ? 'default' : 'show'), force);
    }
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
  for (const key of SPOOKY_COLOR_KEYS) {
    const name = key[0].toUpperCase() + key.slice(1);
    node(`danmaku${name}Mode`).addEventListener('change', () => {
      const state = controller.getState();
      if (!state.loaded || !Object.hasOwn(state.draft, 'styleOptions')) return;
      const value = node(`danmaku${name}Mode`).value === 'default' ? undefined : controls[key].value;
      controller.edit({ styleOptions: editStyleOption(state.draft, key, value).styleOptions });
    });
  }
  node('danmakuSpookyResetColors').addEventListener('click', () => {
    const state = controller.getState();
    if (state.loaded && Object.hasOwn(state.draft, 'styleOptions')) {
      controller.edit({ styleOptions: resetSpookyColors(state.draft).styleOptions });
    }
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
