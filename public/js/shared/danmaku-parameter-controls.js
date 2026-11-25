import { DANMAKU_TEXT_GROUPS, DANMAKU_OPTION_FIELDS, DANMAKU_STYLE_OPTIONS, DANMAKU_FONTS, REAL_GIFT_STYLES, SPOOKY_THEME_COLORS,
  SPOOKY_COLOR_KEYS, SPOOKY_OPACITY_KEYS, inspectComposerText, styleOptionFields, styleOptionsFor } from './danmaku-style-options.js';
import { readAppearanceValue, editStyleOption, resetStyleOptions, resetSpookyColors,
  floatingSpeedFromPixelsPerSecond, floatingSpeedToPixelsPerSecond, floatingSpeedLabel } from './danmaku-appearance-draft.js';
import { mountStyleParameters } from './component-style-parameter-view.js';
import { syncComponentFieldValue, subscribeComponentFields } from './component-parameter-fields.js';
import { registerFontSelect, ensureSavedFontOption, fontValueForStack } from './font-library.js';
import { enhanceColorControls } from './color-control.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from './parameter-range.js';

const GROUPS = {
  neonGlass: ['NeonGlassOptions', '晶透胶囊'],
  astral: ['AstralOptions', '星芒笺'],
  threadAdvanced: ['ThreadAdvancedOptions', '垂丝挂链动效'],
  twitterColors: ['TwitterColors', '礼物与 SC 配色'],
  spookyColors: ['SpookyColors', '背景与装饰配色'],
  ripploidGift: ['RipploidGiftColors', '礼物配色'],
  ripploidGuard: ['RipploidGuardColors', '上舰配色'],
  ripploidSuperchat: ['RipploidSuperchatColors', 'SC 配色'],
  message: ['MessageOptions', '消息显示'],
  randomMotion: ['RandomMotion', '随机弹幕通用参数'],
  floatingMotion: ['FloatingMotion', '飘窗弹幕通用参数'],
  comic: ['ComicOptions', '漫画造型与入场'],
  window: ['WindowOptions', '散落小窗'],
  stardust: ['StardustOptions', '落星尘 · 画面与互动'],
  startrail: ['StartrailOptions', '星芒与光尾'],
  aurora: ['AuroraOptions', '极光薄笺'],
  sinking: ['SinkingOptions', '沉笺 · 水下薄片'],
  stargazer: ['StargazerOptions', '星河漫旅'],
  gradient: ['GradientOptions', '渐变与昵称牌'],
  glassBubble: ['GlassBubbleOptions', '玻璃与显字'],
  celestial: ['CelestialOptions', '星云与星标'],
  charm: ['CharmOptions', '昵称签与横栏'],
  glowy: ['GlowyOptions', '暗夜霓光'],
  glass: ['GlassOptions', '磨砂通知'],
  darkMoon: ['DarkMoonOptions', '月环与星芒'],
  wireframe: ['WireframeOptions', '圈线与描框'],
  seaBreeze: ['SeaBreezeOptions', '海风倒影'],
};
const capitalize = value => value[0].toUpperCase() + value.slice(1);
const isFixedStyle = style => Boolean(DANMAKU_STYLE_OPTIONS[style]) && (DANMAKU_STYLE_OPTIONS[style].layout || 'fixed') === 'fixed';
export function mountDanmakuParameters(host, controller, {
  prefix = 'danmaku', desktop = true, onError, resetButton, fontScale = () => 1, appearanceValues,
} = {}) {
  host.replaceChildren();
  const document = host.ownerDocument;
  host.classList.add('danmaku-parameter-sections');
  if (!document.querySelector('link[data-danmaku-parameters-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/css/components/danmaku-parameter-controls.css';
    link.dataset.danmakuParametersCss = ''; document.head.append(link);
  }
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
  function parameterSection(suffix, title, open = false) {
    const section = element('details', 'danmaku-parameter-section', '', suffix);
    section.open = open;
    const summary = element('summary');
    const chevron = element('span', 'danmaku-parameter-chevron');
    chevron.innerHTML = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>';
    summary.append(chevron, element('strong', '', title));
    const body = element('div', 'danmaku-parameter-section-body');
    section.append(summary, body);
    host.append(section);
    return { section, body };
  }
  const threadBasic = parameterSection('ThreadBasicOptions', '普通参数', true);
  threadBasic.section.hidden = true;
  const threadGrid = element('div', gridClass);
  threadBasic.body.append(threadGrid);
  const typography = parameterSection('TextOptions', '文字样式', true);
  const appearance = parameterSection('AppearanceOptions', '配色与外观');
  const motion = parameterSection('MotionOptions', '消息与动效');
  const advanced = parameterSection('AdvancedOptions', '高级参数');
  const basic = element('div', gridClass);
  appearance.body.append(basic);
  const motionBasic = element('div', gridClass);
  motion.body.append(motionBasic);
  const fixed = element('section', 'danmaku-advanced-section component-style-parameters', '', 'FixedMotion');
  const fixedTitle = element(desktop ? 'h6' : 'h3', '', '位置与变换', 'FixedMotionTitle');
  fixed.setAttribute('aria-labelledby', fixedTitle.id);
  fixed.append(fixedTitle);
  const groups = new Map([['threadBasic', { section: threadBasic.section, grid: threadGrid }]]);
  const table = element('table', 'danmaku-text-table');
  table.setAttribute('aria-label', '文字样式');
  const head = element('thead');
  const headRow = element('tr');
  for (const title of ['文字用途', '字体', '字号（px）', '颜色']) {
    const cell = element('th', '', title); cell.scope = 'col'; headRow.append(cell);
  }
  head.append(headRow);
  const tableBody = element('tbody');
  table.append(head, tableBody);
  typography.body.append(table);
  const textRows = new Map();
  for (const [role, title] of Object.entries({ body: '正文', ...DANMAKU_TEXT_GROUPS })) {
    const row = element('tr');
    row.dataset.textGroup = role;
    const heading = element('th', 'danmaku-text-role', title); heading.scope = 'row';
    row.append(heading);
    const cells = {};
    for (const type of ['font', 'number', 'color']) {
      const cell = element('td');
      const grid = element('div', `danmaku-text-cell danmaku-text-${type}`);
      cell.append(grid); row.append(cell); cells[type] = grid;
    }
    tableBody.append(row);
    textRows.set(role, { row, heading, cells });
    if (role !== 'body') groups.set(`text:${role}`, { section: row });
  }
  const ripploid = element('section', 'danmaku-advanced-section danmaku-event-palette', '', 'RipploidColors');
  const ripploidTitle = element(desktop ? 'h6' : 'h3', '', '先锋票根事件配色', 'RipploidColorsTitle');
  ripploid.setAttribute('aria-labelledby', ripploidTitle.id);
  ripploid.append(ripploidTitle);
  appearance.body.append(ripploid);
  for (const [key, [suffix, label]] of Object.entries(GROUPS)) {
    const section = element('section', 'danmaku-advanced-section', '', key === 'message' ? '' : suffix);
    const title = element(desktop ? 'h6' : 'h3', '', label, `${suffix}Title`);
    section.setAttribute('aria-labelledby', title.id);
    const grid = element('div', gridClass, '', key === 'message' ? suffix : '');
    if (key === 'message') grid.classList.add('danmaku-message-options');
    section.append(title, grid);
    if (['message', 'randomMotion', 'floatingMotion', 'sinking'].includes(key)) motion.body.append(section);
    else if (key.startsWith('ripploid')) ripploid.append(section);
    else if (key === 'twitterColors' || key === 'spookyColors') appearance.body.append(section);
    else advanced.body.append(section);
    groups.set(key, { section, grid });
  }
  motion.body.append(fixed);
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
    const textRole = definition.textRole || (['fontFamily', 'fontSize', 'textColor'].includes(key) ? 'body' : null);
    const textRow = textRows.get(textRole);
    const textSize = Boolean(textRow) && definition.type === 'number';
    const motionField = ['scrollDirection', 'edgeFade', 'ambientMotion', 'seaBreezeAlign', 'composerText', 'twitterHeader', 'twitterComposer', 'twitterActions'].includes(key);
    let container = textRow?.cells[definition.type] || groups.get(definition.group)?.grid || (motionField ? motionBasic : basic);
    if (definition.group === 'spookyColors') {
      const colorKey = key.replace('Opacity', 'Color');
      if (!paletteColumns.has(colorKey)) {
        const column = element('div', desktop ? 'danmaku-advanced-section' : 'canvas-color-group');
        container.append(column); paletteColumns.set(colorKey, column);
      }
      container = paletteColumns.get(colorKey);
    }
    const view = label(definition.label, `${fieldName}Field`, input, container);
    if (key === 'textColor') {
      view.title.id = `${prefix}TextColorLabel`;
      view.title.dataset.previewField = `${logicalPrefix}TextColorLabel`;
    }
    if (definition.help) {
      if (desktop && !definition.textRole) {
        const help = element('lira-help', '', definition.help);
        help.setAttribute('label', `${definition.label}说明`); (textRow?.heading || view.title).append(help);
      } else view.field.title = definition.help;
    }
    if (textRow) {
      view.heading.classList.add('sr-only');
    }
    let output;
    let bounds;
    let sizeScope;
    const appearanceScope = definition.appearanceParent ? element('span', 'danmaku-appearance-scope') : null;
    if (appearanceScope) view.field.insertBefore(appearanceScope, view.heading);
    if (textSize || definition.input === 'range' || definition.type === 'text') {
      output = element('output', '', '', `${name}${definition.type === 'text' ? 'Count' : 'Value'}`);
      output.htmlFor = input.id; view.heading.append(output);
    }
    if (textSize) {
      view.field.classList.add('danmaku-font-size-field');
      sizeScope = element('span', 'danmaku-font-size-scope');
      bounds = element('span', 'danmaku-font-size-bounds', '', `${name}Bounds`);
      input.setAttribute('aria-describedby', bounds.id);
      const info = element('span', 'danmaku-font-size-info');
      info.append(bounds, output);
      view.field.append(sizeScope, info, input);
    }
    if (definition.type === 'select' || definition.type === 'font') {
      const choices = definition.choices || [];
      for (const [value, text] of choices) {
        const option = element('option', '', text); option.value = value; input.append(option);
        if (definition.type === 'font' && DANMAKU_FONTS[value]) option.dataset.fontFamily = DANMAKU_FONTS[value];
      }
    } else {
      input.type = textSize ? 'range' : definition.input || definition.type;
      if (definition.type === 'number') {
        input.step = String(definition.step || 1);
        if (definition.optional && !textSize) {
          input.placeholder = '原样式';
          input.dataset.autosaveOptional = 'true';
        }
        if (input.type === 'range') input.className = 'parameter-range';
      }
      if (definition.type === 'text') input.placeholder = definition.default;
      if (definition.type === 'color') input.dataset.colorAlpha = String(definition.alpha === true);
      if (SPOOKY_COLOR_KEYS.includes(key) && key !== 'textColor' && key !== 'spookyAccentColor') {
        input.dataset.colorOpacity = `${prefix}${capitalize(key.replace('Color', 'Opacity'))}`;
      }
    }
    const updateOutput = () => {
      if (!output) return;
      output.textContent = textSize ? `${input.value} px`
        : key === 'speedPixelsPerSecond' ? floatingSpeedLabel(floatingSpeedToPixelsPerSecond(Number(input.value)))
        : definition.type === 'text' ? `${inspectComposerText(input.value).length}/${definition.maxLength}`
        : `${input.value}${definition.unit || ''}`;
      if (textSize) input.setAttribute('aria-valuetext', output.textContent);
    };
    let pendingInput = false;
    input.addEventListener('input', () => { pendingInput = true; updateOutput(); });
    input.addEventListener('blur', () => { pendingInput = false; });
    input.addEventListener('change', () => {
      pendingInput = false;
      const { draft, loaded } = controller.getState();
      if (!loaded || !Object.hasOwn(draft, 'styleOptions')) return;
      try {
        let value = readAppearanceValue(definition.control === 'floatingSpeed' ? 'floatingSpeed' : key, input.value, input.min, input.max);
        if (value !== undefined && textSize) value = Number((value / fontScale(draft)).toFixed(definition.textRole ? 2 : 0));
        let next = draft;
        for (const target of views.get(key).editKeys || [key]) next = editStyleOption(next, target === 'speedPixelsPerSecond' ? 'floatingSpeed' : target, value);
        controller.edit({ styleOptions: next.styleOptions });
      } catch (error) { onError(error.message, input); render(controller.getState(), true); }
    });
    views.set(key, { ...view, input, output, bounds, sizeScope, appearanceScope, updateOutput, hasPendingInput: () => pendingInput });
  }
  const spookyReset = element('button', 'secondary', '恢复当前主题配色', 'SpookyResetColors');
  spookyReset.type = 'button'; groups.get('spookyColors').section.append(spookyReset);
  spookyReset.addEventListener('click', () => {
    const { draft, loaded } = controller.getState();
    if (loaded) controller.edit({ styleOptions: resetSpookyColors(draft).styleOptions });
  });
  const effectsHost = element('div', '', '', 'AppearanceEffects'); advanced.body.append(effectsHost);
  const effects = mountStyleParameters(effectsHost, controller, 'danmaku', {
    messageHost: groups.get('message').grid, helpPopover: desktop, fieldsRoot: host,
    getTransformHost: draft => isFixedStyle(draft.style) ? fixed : null,
  });
  const unregisterFonts = [...views].filter(([key]) => DANMAKU_OPTION_FIELDS[key].type === 'font')
    .map(([, view]) => registerFontSelect(view.input, { namesOnly: true }));
  const reset = () => {
    const { draft, loaded } = controller.getState();
    if (loaded && Object.hasOwn(draft, 'styleOptions')) controller.edit({ styleOptions: resetStyleOptions(draft).styleOptions });
  };
  resetButton.addEventListener('click', reset);
  let renderedStyle;
  let appearanceKey;
  let actualValues = {};
  let disposed = false;
  function render({ draft, loaded }, force = false) {
    force ||= renderedStyle !== draft.style;
    renderedStyle = draft.style;
    const nextAppearanceKey = JSON.stringify([draft.style, draft.styleOptions]);
    if (appearanceValues && appearanceKey !== nextAppearanceKey) {
      appearanceKey = nextAppearanceKey;
      actualValues = {};
      void appearanceValues.read(draft).then(values => {
        if (disposed || appearanceKey !== nextAppearanceKey) return;
        actualValues = values;
        render(controller.getState());
      }, error => { if (!disposed && appearanceKey === nextAppearanceKey) onError?.(error.message); });
    }
    fixed.hidden = !isFixedStyle(draft.style);
    const fields = styleOptionFields(draft.style);
    const options = styleOptionsFor(draft.style, draft.styleOptions, draft.fullscreenDurationSeconds);
    const saved = draft.styleOptions?.[draft.style] || {};
    const supported = Object.hasOwn(draft, 'styleOptions');
    const spooky = Boolean(DANMAKU_STYLE_OPTIONS[draft.style]?.spookyOptions);
    const scale = fontScale(draft);
    const visibleGroups = new Set(['message']);
    for (const [role, { heading }] of textRows) {
      if (role !== 'body') heading.textContent = fields[`${role}FontSize`]?.textRoleLabel || DANMAKU_TEXT_GROUPS[role];
    }
    for (const [key, view] of views) {
      const definition = DANMAKU_OPTION_FIELDS[key];
      const field = fields[key];
      if (definition.textRole) {
        const roleLabel = definition.textRole === 'body' ? '正文' : fields[`${definition.textRole}FontSize`]?.textRoleLabel || DANMAKU_TEXT_GROUPS[definition.textRole];
        const scope = field?.appearanceLabel || field?.sizeLabel;
        const fieldLabel = `${roleLabel}${scope ? `·${scope}` : ''}${{ font: '字体', number: '字号', color: '颜色' }[definition.type]}`;
        view.title.textContent = fieldLabel;
        view.input.setAttribute('aria-label', fieldLabel);
        if (view.appearanceScope) view.appearanceScope.textContent = field?.appearanceLabel || '';
      }
      if (view.sizeScope) {
        view.sizeScope.textContent = field?.sizeLabel || '';
        view.sizeScope.hidden = !field?.sizeLabel;
        view.field.style.order = String(field?.sizeOrder || 0);
      }
      const visible = Boolean(field) && !field.linkedSizeKey && !field.appearanceParts && !(key === 'giftImage' && REAL_GIFT_STYLES.includes(draft.style))
        && (!field.appearanceWhen || options[field.appearanceWhen[0]] === field.appearanceWhen[1])
        && !(key === 'composerText' && options.twitterComposer === 'hide');
      if (visible && definition.group) visibleGroups.add(definition.group);
      view.field.hidden = !visible;
      view.editKeys = [key];
      if (!field) continue;
      if (key === 'bubbleColor') {
        view.title.textContent = draft.style === 'ripploid' ? '聊天主色' : draft.style === 'whiteframe' ? '边框颜色' : definition.label;
      }
      if (key === 'textColor') view.title.textContent = draft.style === 'sketch' ? '主题颜色' : definition.label;
      let value = options[key] ?? definition.default ?? '';
      if (definition.type === 'color' && value === 'default') value = actualValues[key] || (spooky && !definition.textRole
        ? SPOOKY_THEME_COLORS[options.spookyTheme][key] : key === 'bubbleColor' ? DANMAKU_STYLE_OPTIONS[draft.style].defaultBubbleColor : '');
      if (definition.type === 'font') {
        const stack = actualValues[key] || DANMAKU_FONTS[value] || (value !== 'default' ? value : '');
        value = stack ? fontValueForStack(view.input, stack) : '';
        if (value) ensureSavedFontOption(view.input, value);
      }
      if (definition.type === 'number') {
        const min = field?.min ?? definition.min ?? 18;
        const textSize = key === 'fontSize' || Boolean(definition.textRole);
        view.input.min = String(key === 'speedPixelsPerSecond' ? 1 : textSize ? definition.textRole ? Number((min * scale).toFixed(2)) : Math.ceil(min * scale) : min);
        const max = (field?.max ?? definition.max ?? 48) * (textSize ? scale : 1);
        view.input.max = String(key === 'speedPixelsPerSecond' ? 100 : definition.textRole ? Number(max.toFixed(2)) : Math.floor(max));
        if (view.bounds) {
          view.bounds.textContent = `${view.input.min}–${view.input.max} px`;
        }
        if (textSize && value !== '') value = Number((value * scale).toFixed(definition.textRole ? 2 : 0));
        if (key === 'speedPixelsPerSecond') value = floatingSpeedFromPixelsPerSecond(value);
      }
      // Focus can remain here after an edit in the other window; only unfinished input needs protection.
      if (value !== '') syncComponentFieldValue(view.input, value, force || definition.type !== 'color' && !view.hasPendingInput());
      const disabledByChoice = definition.disabledWhen && options[definition.disabledWhen[0]] === definition.disabledWhen[1];
      view.input.disabled = !loaded || !supported || value === '' || Boolean(disabledByChoice);
      view.updateOutput();
      if (key === 'speedPixelsPerSecond' && Number(view.input.value) === floatingSpeedFromPixelsPerSecond(options.speedPixelsPerSecond || 120)) {
        view.output.textContent = floatingSpeedLabel(options.speedPixelsPerSecond || 120);
      }
    }
    // One control can edit equal-valued parts of the same purpose without flattening other layers.
    const merged = new Map();
    for (const [key, view] of views) {
      const field = fields[key];
      if (!field?.appearanceParent || view.field.hidden || !actualValues[key]) continue;
      const group = JSON.stringify([field.appearanceParent, field.colorProperty || '', view.input.value]);
      const first = merged.get(group);
      if (first) {
        first.editKeys.push(key);
        view.field.hidden = true;
        if (!first.appearanceScope.textContent.split('、').includes(field.appearanceLabel)) {
          first.appearanceScope.textContent += `、${field.appearanceLabel}`;
        }
      } else merged.set(group, view);
    }
    for (const { cells } of textRows.values()) {
      for (const type of ['font', 'color']) {
        const visible = [...views.values()].filter(view => view.field.parentElement === cells[type] && !view.field.hidden);
        if (type === 'color') cells[type].dataset.palette = String(visible.length > 1);
        for (const view of visible) {
          if (view.appearanceScope) {
            view.appearanceScope.hidden = visible.length === 1;
            view.field.title = `${view.appearanceScope.textContent} · ${view.input.value}`;
            view.input.setAttribute('aria-label', `${view.appearanceScope.textContent}${type === 'font' ? '字体' : '颜色'}`);
          }
        }
      }
    }
    for (const [key, { section }] of groups) section.hidden = !visibleGroups.has(key);
    ripploid.hidden = !DANMAKU_STYLE_OPTIONS[draft.style]?.ripploidColors;
    basic.hidden = !Array.from(basic.children).some(field => !field.hidden);
    appearance.section.hidden = !Array.from(appearance.body.children).some(group => !group.hidden);
    motionBasic.hidden = !Array.from(motionBasic.children).some(field => !field.hidden);
    spookyReset.disabled = !loaded || !supported || ![...SPOOKY_COLOR_KEYS, ...SPOOKY_OPACITY_KEYS].some(key => Object.hasOwn(saved, key));
    const canReset = Object.keys(saved).some(key => key !== 'durationSeconds' || saved[key] !== 6)
      || fields.durationSeconds && options.durationSeconds !== fields.durationSeconds.default;
    resetButton.disabled = !loaded || !supported || !canReset;
    for (const { input } of views.values()) if (input.type === 'range') refreshParameterRange(input);
  }
  enhanceColorControls(host);
  const unsubscribe = subscribeComponentFields(host, controller, render);
  initParameterRanges(host);
  return { render, dispose() {
    disposed = true;
    unsubscribe(); effects.dispose(); unregisterFonts.forEach(unregister => unregister?.()); resetButton.removeEventListener('click', reset);
    disposeParameterRanges(host); host.replaceChildren();
  } };
}
