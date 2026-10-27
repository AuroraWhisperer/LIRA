import { DANMAKU_STYLE_OPTIONS, RIPPLOID_COLOR_DEFAULTS, SPOOKY_THEME_COLORS, SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, TWITTER_COMPOSER_TEXT_MAX_LENGTH, TWITTER_LAYOUT_DEFAULTS, TWITTER_COLOR_DEFAULTS, inspectComposerText, isRandomDanmakuStyle, styleOptionsFor } from '../shared/danmaku-style-options.js';
import { canvasContentScale } from './danmaku-canvas.js';
import {
  readAppearanceValue,
  editStyleOption,
  resetStyleOptions,
  resetSpookyColors,
  isValidFullscreenDuration,
  floatingSpeedFromPixelsPerSecond,
  floatingSpeedToPixelsPerSecond,
  floatingSpeedLabel,
} from '../shared/danmaku-appearance-draft.js';

export function initPreviewAppearance({ getDraft, change, error }) {
  const byId = (id) => document.getElementById(id);
  const fields = {
    fontFamily: byId('previewFontFamily'), fontSize: byId('previewFontSize'),
    textColor: byId('previewTextColor'), bubbleColor: byId('previewBubbleColor'), backgroundOpacity: byId('previewBackgroundOpacity'),
    giftImage: byId('previewGiftImage'), scrollDirection: byId('previewScrollDirection'),
    minGiftAmount: byId('previewMinGiftAmount'),
    composerText: byId('previewComposerText'),
    edgeFade: byId('previewEdgeFade'),
    entranceAnimation: byId('previewEntranceAnimation'),
    decorationShape: byId('previewDecorationShape'),
    spookyTheme: byId('previewSpookyTheme'), spookyFrame: byId('previewSpookyFrame'),
    floatingSpeed: byId('previewFloatingSpeed'), floatingDispersion: byId('previewFloatingDispersion'),
    centerBias: byId('previewCenterBias'), dispersion: byId('previewDispersion'),
  };
  for (const key of [...Object.keys(RIPPLOID_COLOR_DEFAULTS), ...Object.keys(TWITTER_LAYOUT_DEFAULTS), ...Object.keys(TWITTER_COLOR_DEFAULTS)]) {
    fields[key] = byId(`preview${key[0].toUpperCase()}${key.slice(1)}`);
  }
  for (const key of [...SPOOKY_COLOR_KEYS, ...SPOOKY_OPACITY_KEYS]) {
    fields[key] = byId(`preview${key[0].toUpperCase()}${key.slice(1)}`);
  }
  function renderComposerTextCount() {
    byId('previewComposerTextCount').textContent = `${inspectComposerText(fields.composerText.value).length}/${TWITTER_COMPOSER_TEXT_MAX_LENGTH}`;
  }
  fields.composerText.addEventListener('input', renderComposerTextCount);
  fields.floatingSpeed.addEventListener('input', () => {
    byId('previewFloatingSpeedValue').textContent = floatingSpeedLabel(floatingSpeedToPixelsPerSecond(Number(fields.floatingSpeed.value)));
  });
  fields.floatingDispersion.addEventListener('input', () => {
    byId('previewFloatingDispersionValue').textContent = fields.floatingDispersion.value;
  });
  for (const [key, control] of Object.entries(fields)) {
    control.addEventListener('change', () => {
      const draft = getDraft();
      let value;
      try {
        value = readAppearanceValue(key, control.value, control.min, control.max);
      } catch (reason) {
        error(reason.message);
        render();
        return;
      }
      if (key === 'fontSize') value = Math.round(value / canvasContentScale(draft.layout, draft.style));
      change(editStyleOption(draft, key, value));
    });
  }
  byId('previewBubbleColorMode').addEventListener('change', () => {
    const value = byId('previewBubbleColorMode').value === 'default' ? 'default' : fields.bubbleColor.value;
    change(editStyleOption(getDraft(), 'bubbleColor', value));
  });
  for (const key of SPOOKY_COLOR_KEYS) {
    const name = key[0].toUpperCase() + key.slice(1);
    byId(`preview${name}Mode`).addEventListener('change', () => {
      const value = byId(`preview${name}Mode`).value === 'default' ? undefined : fields[key].value;
      change(editStyleOption(getDraft(), key, value));
    });
  }
  byId('previewSpookyResetColors').addEventListener('click', () => change(resetSpookyColors(getDraft())));
  byId('previewAppearanceReset').addEventListener('click', () => {
    change(resetStyleOptions(getDraft()));
  });
  byId('previewDuration').addEventListener('change', (event) => {
    const value = Number(event.target.value);
    if (!isValidFullscreenDuration(value)) {
      error('停留时间请输入 2～30 秒的整数。');
      render();
      return;
    }
    change({ ...getDraft(), fullscreenDurationSeconds: value });
  });
  function addFonts(fonts) {
    for (const { value, label } of fonts) {
      if (Array.from(fields.fontFamily.options).some((option) => option.value === value)) continue;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      fields.fontFamily.append(option);
    }
  }
  function render() {
    const draft = getDraft();
    const options = styleOptionsFor(draft.style, draft.styleOptions);
    const limits = DANMAKU_STYLE_OPTIONS[draft.style];
    const spooky = Boolean(limits.spookyOptions);
    byId('previewTextColorLabel').textContent = draft.style === 'sketch' ? '主题颜色' : spooky ? '自定义正文颜色' : '正文颜色';
    const scale = canvasContentScale(draft.layout, draft.style);
    addFonts([{ value: options.fontFamily, label: options.fontFamily }]);
    for (const [key, control] of Object.entries(fields)) control.value = String(options[key]);
    byId('previewComposerTextField').hidden = !limits.composerText || options.twitterComposer === 'hide';
    fields.composerText.value = options.composerText || '';
    renderComposerTextCount();
    for (const [key, fallback] of Object.entries(TWITTER_LAYOUT_DEFAULTS)) {
      byId(`preview${key[0].toUpperCase()}${key.slice(1)}Field`).hidden = !limits.twitterOptions;
      fields[key].value = options[key] || fallback;
    }
    byId('previewTwitterColors').hidden = !limits.twitterOptions;
    for (const [key, fallback] of Object.entries(TWITTER_COLOR_DEFAULTS)) fields[key].value = options[key] || fallback;
    byId('previewTextColorModeField').hidden = !spooky;
    byId('previewTextColorField').hidden = spooky && !Object.hasOwn(draft.styleOptions?.spooky || {}, 'textColor');
    byId('previewSpookyColors').hidden = !spooky;
    const themeColors = SPOOKY_THEME_COLORS[options.spookyTheme || 'default'];
    for (const key of SPOOKY_COLOR_KEYS) {
      const name = key[0].toUpperCase() + key.slice(1);
      const custom = spooky && Object.hasOwn(draft.styleOptions?.spooky || {}, key) && options[key] !== 'default';
      byId(`preview${name}Mode`).value = custom ? 'custom' : 'default';
      if (key !== 'textColor') byId(`preview${name}Field`).hidden = !custom;
      if (spooky) fields[key].value = custom ? options[key] : themeColors[key];
    }
    for (const key of SPOOKY_OPACITY_KEYS) fields[key].value = String(options[key] ?? 100);
    byId('previewSpookyResetColors').disabled = ![...SPOOKY_COLOR_KEYS, ...SPOOKY_OPACITY_KEYS]
      .some(key => Object.hasOwn(draft.styleOptions?.spooky || {}, key));
    const customBubbleColor = limits.bubbleColor && options.bubbleColor !== 'default';
    const ripploid = draft.style === 'ripploid';
    byId('previewBubbleColorLabel').textContent = ripploid ? '聊天主色' : '弹幕配色';
    byId('previewBubbleColorHint').textContent = ripploid
      ? '默认保留多色聊天装饰；自定义只统一聊天主色，事件颜色在下方独立设置。'
      : '默认按当前直播间身份配色。';
    byId('previewBubbleColorModeField').hidden = !limits.bubbleColor;
    byId('previewBubbleColorMode').value = customBubbleColor ? 'custom' : 'default';
    byId('previewBubbleColorField').hidden = !customBubbleColor;
    fields.bubbleColor.value = customBubbleColor ? options.bubbleColor : limits.defaultBubbleColor || limits.defaultTextColor;
    byId('previewRipploidColors').hidden = !limits.ripploidColors;
    for (const key of Object.keys(RIPPLOID_COLOR_DEFAULTS)) {
      fields[key].value = options[key] || RIPPLOID_COLOR_DEFAULTS[key];
    }
    fields.fontSize.value = String(Math.round(options.fontSize * scale));
    fields.fontSize.min = String(Math.ceil(limits.minFontSize * scale));
    fields.fontSize.max = String(Math.floor(limits.maxFontSize * scale));
    byId('previewBackgroundField').hidden = !limits.background;
    byId('previewGiftField').hidden = !limits.giftImage || ['identity', 'transparent', 'outline', 'bubble', 'cream', 'twitter'].includes(draft.style);
    byId('previewMinGiftAmountField').hidden = !limits.minGiftAmount;
    fields.minGiftAmount.value = String(options.minGiftAmount || 0);
    byId('previewDirectionField').hidden = !limits.scrollDirection;
    byId('previewEdgeFadeField').hidden = !limits.scrollDirection;
    byId('previewSpookyThemeField').hidden = !limits.spookyOptions;
    byId('previewSpookyFrameField').hidden = !limits.spookyOptions;
    byId('previewDecorationShapeField').hidden = !limits.decorationShape;
    fields.decorationShape.value = options.decorationShape || 'sparkle';
    byId('previewEntranceAnimationField').hidden = !limits.entranceAnimation;
    fields.entranceAnimation.value = options.entranceAnimation || 'fade';
    byId('previewSpeedField').hidden = !limits.speed;
    fields.floatingSpeed.value = String(floatingSpeedFromPixelsPerSecond(options.speedPixelsPerSecond || 120));
    byId('previewFloatingSpeedValue').textContent = floatingSpeedLabel(options.speedPixelsPerSecond || 120);
    byId('previewFloatingDispersionField').hidden = !limits.speed;
    fields.floatingDispersion.value = String(options.floatingDispersion ?? 50);
    byId('previewFloatingDispersionValue').textContent = fields.floatingDispersion.value;
    byId('previewDurationField').hidden = !isRandomDanmakuStyle(draft.style);
    byId('previewCenterBiasField').hidden = !isRandomDanmakuStyle(draft.style);
    byId('previewDispersionField').hidden = !isRandomDanmakuStyle(draft.style);
    byId('previewDuration').value = String(draft.fullscreenDurationSeconds);
  }
  return { render, addFonts };
}
