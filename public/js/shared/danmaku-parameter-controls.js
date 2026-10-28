import { DANMAKU_OPTION_FIELDS, DANMAKU_STYLE_OPTIONS, REAL_GIFT_STYLES, SPOOKY_THEME_COLORS,
  SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, inspectComposerText, styleOptionFields, styleOptionsFor } from './danmaku-style-options.js';
import { readAppearanceValue, editStyleOption, resetStyleOptions, resetSpookyColors,
  floatingSpeedFromPixelsPerSecond, floatingSpeedToPixelsPerSecond, floatingSpeedLabel } from './danmaku-appearance-draft.js';
import { mountStyleParameters } from './component-style-parameter-view.js';
import { syncComponentFieldValue, subscribeComponentFields } from './component-parameter-fields.js';
import { registerFontSelect, ensureSavedFontOption } from './font-library.js';
import { enhanceColorControls } from './color-control.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from './parameter-range.js';

const GROUPS = {
  twitterColors: ['TwitterColors', '礼物与 SC 配色'],
  spookyColors: ['SpookyColors', '背景与装饰配色'],
  ripploidGift: ['RipploidGiftColors', '礼物配色'],
  ripploidGuard: ['RipploidGuardColors', '上舰配色'],
  ripploidSuperchat: ['RipploidSuperchatColors', 'SC 配色'],
  message: ['MessageOptions', '消息显示'],
  distribution: ['DistributionOptions', '位置分布'],
};
const capitalize = value => value[0].toUpperCase() + value.slice(1);

export function mountDanmakuParameters(host, controller, {
  prefix = 'danmaku', desktop = true, onError, resetButton, fontScale = () => 1,
} = {}) {
  host.replaceChildren();
  const document = host.ownerDocument;
  const logicalPrefix = desktop ? 'danmaku' : 'preview';
  function element(tag, className, text, suffix) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    if (suffix) {
      node.id = `${prefix}${suffix}`;
      node.dataset.previewField = `${logicalPrefix}${suffix}`;
    }
    return node;
  }
  const gridClass = desktop ? 'danmaku-parameter-grid' : 'canvas-fields';
  const basic = element('div', gridClass);
  const advanced = element('details', desktop ? 'danmaku-advanced' : '');
  const summary = element('summary', '', '高级参数');
  if (desktop) summary.innerHTML = '<strong>高级参数</strong><svg class="danmaku-details-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>';
  advanced.append(summary);
  const advancedBody = element('div', desktop ? 'danmaku-advanced-body' : '');
  advanced.append(advancedBody);
  host.append(basic, advanced);
  const groups = new Map();
  const ripploid = element('section', 'danmaku-advanced-section', '', 'RipploidColors');
  const ripploidTitle = element(desktop ? 'h6' : 'h3', '', 'RIPPLOID 事件配色', 'RipploidColorsTitle');
  ripploid.setAttribute('aria-labelledby', ripploidTitle.id);
  ripploid.append(ripploidTitle);
  advancedBody.append(ripploid);
  for (const [key, [suffix, label]] of Object.entries(GROUPS)) {
    const section = element('section', 'danmaku-advanced-section', '', key === 'message' ? '' : suffix);
    const title = element(desktop ? 'h6' : 'h3', '', label, `${suffix}Title`);
    section.setAttribute('aria-labelledby', title.id);
    const grid = element('div', gridClass, '', key === 'message' ? suffix : '');
    if (key === 'message') grid.classList.add('danmaku-message-options');
    section.append(title, grid);
    (key.startsWith('ripploid') ? ripploid : advancedBody).append(section);
    groups.set(key, { section, grid });
  }
  function label(text, suffix, input, container) {
    const field = element('label', 'danmaku-parameter-field', '', suffix);
    field.htmlFor = input.id;
    const heading = element('span');
    const title = element('strong', '', text);
    heading.append(title);
    field.append(heading, input);
    container.append(field);
    return { field, heading, title };
  }
  const views = new Map();
  const paletteColumns = new Map();
  for (const [key, definition] of Object.entries(DANMAKU_OPTION_FIELDS)) {
    const name = capitalize(definition.control || key);
    const inputName = !desktop && key === 'durationSeconds' ? 'Duration' : name;
    const fieldName = ({ speedPixelsPerSecond: 'Speed', durationSeconds: desktop ? 'FullscreenDuration' : 'Duration',
      ...(!desktop ? { backgroundOpacity: 'Background', giftImage: 'Gift', scrollDirection: 'Direction' } : {}) })[key] || name;
    const input = element(['select', 'font'].includes(definition.type) ? 'select' : 'input', '', '', inputName);
    input.disabled = true;
    input.setAttribute('aria-label', definition.label);
    let container = groups.get(definition.group)?.grid || basic;
    if (definition.group === 'spookyColors') {
      const colorKey = key.replace('Opacity', 'Color');
      if (!paletteColumns.has(colorKey)) {
        const column = element('div', desktop ? 'danmaku-advanced-section' : 'canvas-color-group');
        container.append(column); paletteColumns.set(colorKey, column);
      }
      container = paletteColumns.get(colorKey);
    }
    const mode = definition.allowDefault || key === 'textColor' ? element('select', '', '', `${name}Mode`) : null;
    let modeView;
    if (mode) {
      for (const [value, title] of [['default', key === 'bubbleColor' ? '默认配色' : '跟随主题'], ['custom', '自定义']]) {
        const option = element('option', '', title); option.value = value; mode.append(option);
      }
      modeView = label(definition.label, `${name}ModeField`, mode, container);
      modeView.title.id = `${prefix}${name}Label`;
      modeView.title.dataset.previewField = `${logicalPrefix}${name}Label`;
    }
    const view = label(mode && key !== 'textColor' ? `自定义${definition.label}` : definition.label, `${fieldName}Field`, input, container);
    if (key === 'textColor') {
      view.title.id = `${prefix}TextColorLabel`;
      view.title.dataset.previewField = `${logicalPrefix}TextColorLabel`;
      modeView.title.removeAttribute('id');
      delete modeView.title.dataset.previewField;
    }
    if (definition.help) {
      if (desktop) {
        const help = element('lira-help', '', definition.help);
        help.setAttribute('label', `${definition.label}说明`); view.title.append(help);
      } else view.field.title = definition.help;
    }
    let output;
    if (definition.input === 'range' || definition.type === 'text') {
      output = element('output', '', '', `${name}${definition.type === 'text' ? 'Count' : 'Value'}`);
      output.htmlFor = input.id; view.heading.append(output);
    }
    if (definition.type === 'select' || definition.type === 'font') {
      const choices = definition.choices || [['default', '样式默认'], ['sans', '微软雅黑'], ['serif', '宋体'], ['kai', '楷体']];
      for (const [value, text] of choices) {
        const option = element('option', '', text); option.value = value; input.append(option);
      }
    } else {
      input.type = definition.input || definition.type;
      if (definition.type === 'number') {
        input.step = String(definition.step || 1);
        if (definition.input === 'range') input.className = 'parameter-range';
      }
      if (definition.type === 'text') input.placeholder = definition.default;
      if (SPOOKY_COLOR_KEYS.includes(key) && key !== 'textColor' && key !== 'spookyAccentColor') {
        input.dataset.colorOpacity = `${prefix}${capitalize(key.replace('Color', 'Opacity'))}`;
      }
    }
    const updateOutput = () => {
      if (!output) return;
      output.textContent = key === 'speedPixelsPerSecond' ? floatingSpeedLabel(floatingSpeedToPixelsPerSecond(Number(input.value)))
        : definition.type === 'text' ? `${inspectComposerText(input.value).length}/${definition.maxLength}`
        : `${input.value}${definition.unit || ''}`;
    };
    input.addEventListener('input', updateOutput);
    input.addEventListener('change', () => {
      const { draft, loaded } = controller.getState();
      if (!loaded || !Object.hasOwn(draft, 'styleOptions')) return;
      try {
        let value = readAppearanceValue(definition.control === 'floatingSpeed' ? 'floatingSpeed' : key, input.value, input.min, input.max);
        if (key === 'fontSize') value = Math.round(value / fontScale(draft));
        controller.edit({ styleOptions: editStyleOption(draft, key === 'speedPixelsPerSecond' ? 'floatingSpeed' : key, value).styleOptions });
      } catch (error) { onError(error.message, input); render(controller.getState(), true); }
    });
    mode?.addEventListener('change', () => {
      const { draft, loaded } = controller.getState();
      if (!loaded || !Object.hasOwn(draft, 'styleOptions')) return;
      const value = mode.value === 'custom' ? input.value : key === 'bubbleColor' ? 'default' : undefined;
      controller.edit({ styleOptions: editStyleOption(draft, key, value).styleOptions });
    });
    views.set(key, { ...view, input, mode, modeView, output, updateOutput });
  }
  const spookyReset = element('button', 'secondary', '恢复当前主题配色', 'SpookyResetColors');
  spookyReset.type = 'button'; groups.get('spookyColors').section.append(spookyReset);
  spookyReset.addEventListener('click', () => {
    const { draft, loaded } = controller.getState();
    if (loaded) controller.edit({ styleOptions: resetSpookyColors(draft).styleOptions });
  });
  const effectsHost = element('div', '', '', 'AppearanceEffects'); advancedBody.append(effectsHost);
  const effects = mountStyleParameters(effectsHost, controller, 'danmaku', { messageHost: groups.get('message').grid, helpPopover: desktop });
  const fontInput = views.get('fontFamily').input;
  const unregisterFont = desktop ? registerFontSelect(fontInput) : null;
  const reset = () => {
    const { draft, loaded } = controller.getState();
    if (loaded && Object.hasOwn(draft, 'styleOptions')) controller.edit({ styleOptions: resetStyleOptions(draft).styleOptions });
  };
  resetButton.addEventListener('click', reset);
  let renderedStyle;
  function render({ draft, loaded }, force = false) {
    force ||= renderedStyle !== draft.style;
    renderedStyle = draft.style;
    const fields = styleOptionFields(draft.style);
    const options = styleOptionsFor(draft.style, draft.styleOptions, draft.fullscreenDurationSeconds);
    const saved = draft.styleOptions?.[draft.style] || {};
    const supported = Object.hasOwn(draft, 'styleOptions');
    const spooky = Boolean(DANMAKU_STYLE_OPTIONS[draft.style]?.spookyOptions);
    const scale = fontScale(draft);
    const visibleGroups = new Set(['message']);
    for (const [key, view] of views) {
      const definition = DANMAKU_OPTION_FIELDS[key];
      const field = fields[key];
      const visible = Boolean(field) && !(key === 'giftImage' && REAL_GIFT_STYLES.includes(draft.style))
        && !(key === 'composerText' && options.twitterComposer === 'hide');
      if (visible && definition.group) visibleGroups.add(definition.group);
      const hasMode = definition.allowDefault || key === 'textColor' && spooky;
      const custom = hasMode && Object.hasOwn(saved, key) && saved[key] !== 'default';
      view.field.hidden = !visible || hasMode && !custom;
      if (view.mode) {
        view.modeView.field.hidden = !visible || !hasMode;
        view.mode.value = custom ? 'custom' : 'default';
        view.mode.disabled = !loaded || !supported;
      }
      if (key === 'bubbleColor') view.modeView.title.textContent = draft.style === 'ripploid' ? '聊天主色' : definition.label;
      if (key === 'textColor') view.title.textContent = draft.style === 'sketch' ? '主题颜色' : spooky ? '自定义正文颜色' : definition.label;
      let value = options[key] ?? definition.default;
      if (definition.type === 'color' && !custom && hasMode) value = spooky
        ? SPOOKY_THEME_COLORS[options.spookyTheme][key]
        : DANMAKU_STYLE_OPTIONS[draft.style].defaultBubbleColor || options.textColor;
      if (key === 'fontFamily') {
        if (desktop) value = { default: draft.style === 'starveil' ? '"SimSun"' : draft.style === 'outline' ? '"Segoe UI"' : '"Microsoft YaHei UI"',
          sans: '"Microsoft YaHei UI"', serif: '"SimSun"', kai: '"KaiTi"' }[value] || value;
        if (desktop) ensureSavedFontOption(fontInput, value);
        else addFonts([{ value, label: value }]);
      }
      if (definition.type === 'number') {
        view.input.min = String(key === 'speedPixelsPerSecond' ? 1 : Math.ceil((field?.min ?? definition.min ?? 18) * (key === 'fontSize' ? scale : 1)));
        view.input.max = String(key === 'speedPixelsPerSecond' ? 100 : Math.floor((field?.max ?? definition.max ?? 48) * (key === 'fontSize' ? scale : 1)));
        if (key === 'fontSize') value = Math.round(value * scale);
        if (key === 'speedPixelsPerSecond') value = floatingSpeedFromPixelsPerSecond(value);
      }
      syncComponentFieldValue(view.input, value, force);
      view.input.disabled = !loaded || !supported;
      view.updateOutput();
      if (key === 'speedPixelsPerSecond' && Number(view.input.value) === floatingSpeedFromPixelsPerSecond(options.speedPixelsPerSecond || 120)) {
        view.output.textContent = floatingSpeedLabel(options.speedPixelsPerSecond || 120);
      }
      if (definition.input === 'range') refreshParameterRange(view.input);
    }
    for (const [key, { section }] of groups) section.hidden = !visibleGroups.has(key);
    ripploid.hidden = !DANMAKU_STYLE_OPTIONS[draft.style]?.ripploidColors;
    spookyReset.disabled = !loaded || !supported || ![...SPOOKY_COLOR_KEYS, ...SPOOKY_OPACITY_KEYS].some(key => Object.hasOwn(saved, key));
    const canReset = Object.keys(saved).some(key => key !== 'durationSeconds' || saved[key] !== 6)
      || fields.durationSeconds && options.durationSeconds !== fields.durationSeconds.default;
    resetButton.disabled = !loaded || !supported || !canReset;
  }
  function addFonts(fonts) {
    for (const { value, label } of fonts) {
      if (Array.from(fontInput.options).some(option => option.value === value)) continue;
      const option = element('option', '', label); option.value = value; fontInput.append(option);
    }
  }
  enhanceColorControls(host);
  initParameterRanges(host);
  const unsubscribe = subscribeComponentFields(host, controller, render);
  return { render, addFonts, dispose() {
    unsubscribe(); effects.dispose(); unregisterFont?.(); resetButton.removeEventListener('click', reset);
    disposeParameterRanges(host); host.replaceChildren();
  } };
}
