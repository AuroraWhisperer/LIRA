// Client settings and canvas parameters share grouping and disclosure rules.
const GROUPS = [
  ['basic', '文字排版', [
    'style', 'desktopLyricFontFamily', 'desktopLyricFontSize', 'desktopLyricTranslationScale', 'desktopLyricFontWeight',
    'desktopLyricTextAlign', 'desktopLyricLineHeight', 'desktopLyricLineGap',
    ['更多排版', 'desktopLyricLetterSpacing', 'desktopLyricTraditionalMode'],
  ], true],
  ['content', '显示内容', [
    'desktopLyricVisibleLines', 'desktopLyricHidePassedLines', 'desktopLyricShowTranslation', 'desktopLyricShowRoma',
    'desktopLyricTranslationOpacity',
  ], true],
  ['highlight', '高亮与配色', [
    'desktopLyricKaraokeMode', 'desktopLyricTextColor', 'desktopLyricSungColor',
    'desktopLyricOpacity', 'desktopLyricCurrentLineEnhanced',
    ['当前行强调', 'desktopLyricBaseOpacity', 'desktopLyricBlurEffect', 'desktopLyricScaleEffect'],
  ]],
  ['effect', '描边与阴影', [
    'desktopLyricStrokeEnabled', 'desktopLyricStrokeColor', 'desktopLyricStrokeWidth',
    'desktopLyricShadowEnabled', 'desktopLyricShadowColor', 'desktopLyricShadowIntensity', 'desktopLyricShadowBlur',
    ['阴影位置微调', 'desktopLyricShadowOffsetX', 'desktopLyricShadowOffsetY'],
  ]],
  ['layout', '位置与动效', [
    'desktopLyricAlignPosition', 'desktopLyricScale', 'desktopLyricSpringAnimation',
    ['位置微调', 'desktopLyricAlignAnchor', 'desktopLyricTranslateX', 'desktopLyricTranslateY', 'desktopLyricInterludeOffsetEm'],
    ['3D 倾斜', 'desktopLyricRotateX', 'desktopLyricRotateY', 'desktopLyricPerspective'],
  ]],
  ['render', '背景与画面', [
    'desktopLyricBackgroundEnabled', 'desktopLyricBackgroundRenderer', 'desktopLyricBgOpacity',
    'desktopLyricGlobalOpacity',
    ['画面调色', 'desktopLyricBrightness', 'desktopLyricContrast', 'desktopLyricSaturation'],
  ]],
  ['visibility', '播放与同步', [
    'desktopLyricHideOnPause', 'desktopLyricTimeOffsetMs',
    'desktopLyricShowTitleWhenNoLyric', 'desktopLyricNoLyricText',
  ]],
];

const DEPENDENCIES = [
  ['desktopLyricShowTranslation', ['desktopLyricTranslationOpacity']],
  ['desktopLyricStrokeEnabled', ['desktopLyricStrokeColor', 'desktopLyricStrokeWidth']],
  ['desktopLyricShadowEnabled', ['desktopLyricShadowColor', 'desktopLyricShadowIntensity',
    'desktopLyricShadowBlur', 'desktopLyricShadowOffsetX', 'desktopLyricShadowOffsetY']],
  ['desktopLyricBackgroundEnabled', ['desktopLyricBackgroundRenderer', 'desktopLyricBgOpacity']],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function createVisibleLinesControl({ input, label }) {
  const row = element('label', 'desktop-lyric-control desktop-lyric-lines-control');
  const select = element('select', '');
  select.dataset.lyricLinePreset = '';
  select.dataset.dropdownVariant = 'settings';
  select.setAttribute('aria-label', '显示行数');
  for (const [value, title] of [['0', '整首'], ['1', '当前句'], ['2', '当前句和下一句'], ['custom', '自定义行数']]) {
    const option = element('option', '', title);
    option.value = value;
    select.append(option);
  }
  const copy = element('span', 'desktop-lyric-control-copy');
  copy.append(element('strong', '', '显示行数'));
  row.append(copy, select);
  let lastValue;
  let customValue = '3';
  const sync = () => {
    if (input.value !== lastValue) {
      select.value = ['0', '1', '2'].includes(input.value) ? input.value : 'custom';
      if (select.value === 'custom') customValue = input.value;
      lastValue = input.value;
    }
    select.disabled = input.disabled;
    label.hidden = select.value !== 'custom';
  };
  input.addEventListener('input', () => {
    lastValue = input.value;
    if (input.checkValidity()) customValue = input.value;
  });
  select.addEventListener('input', event => event.stopPropagation());
  select.addEventListener('change', event => {
    event.stopPropagation();
    input.value = select.value === 'custom' ? customValue : select.value;
    lastValue = input.value;
    sync();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return { row, sync };
}

export function groupDesktopLyricParameters(root, fields, { scene = false } = {}) {
  const groups = [];
  const advancedGroups = [];
  const lines = fields.has('desktopLyricVisibleLines') ? createVisibleLinesControl(fields.get('desktopLyricVisibleLines')) : null;
  if (scene && lines) lines.row.classList.add('scene-parameter-control');
  const definitions = scene ? [
    ['layers', '显示层', ['lyricLayer', 'desktopLyricEnabled', 'advancedLyricEnabled'], true],
    ['advanced-lyrics', '高级歌词', ['advancedLyricLayout', 'advancedLyricFontSize', 'advancedLyricTextColor',
      'advancedLyricAccentColor', 'advancedLyricHideUnsung', 'advancedLyricPositionX', 'advancedLyricPositionY', 'advancedLyricScale']],
    ...GROUPS,
  ] : GROUPS;
  for (const [id, title, entries, open = false] of definitions) {
    const section = element('details', `desktop-lyric-settings-group${scene ? ' scene-parameter-group' : ''}`);
    section.dataset.parameterGroup = id;
    section.open = open;
    const summary = element('summary', '');
    const status = element('span', 'desktop-lyric-group-state');
    summary.append(element('strong', '', title), status);
    const body = element('div', 'desktop-lyric-group-body');
    const controls = [];
    for (const entry of entries) {
      if (Array.isArray(entry)) {
        const [caption, ...keys] = entry;
        const children = keys.map(key => fields.get(key)?.label).filter(Boolean);
        if (!children.length) continue;
        const advanced = element('details', 'desktop-lyric-advanced');
        advanced.append(element('summary', '', caption), ...children);
        body.append(advanced);
        controls.push(...children);
        advancedGroups.push({ section: advanced, controls: children });
      } else {
        const control = fields.get(entry)?.label;
        if (!control) continue;
        if (entry === 'desktopLyricVisibleLines') {
          body.append(lines.row);
          controls.push(lines.row);
        }
        body.append(control);
        controls.push(control);
      }
    }
    if (!controls.length) continue;
    section.append(summary, body);
    root.append(section);
    groups.push({ id, section, controls, status });
  }
  const value = key => {
    const input = fields.get(key)?.input;
    return input?.type === 'checkbox' ? input.checked : input?.value ?? input?.querySelector('input:checked')?.value;
  };
  return () => {
    lines?.sync();
    for (const [parent, children] of DEPENDENCIES) {
      for (const key of children) {
        const field = fields.get(key);
        if (field) field.label.hidden = !value(parent);
      }
    }
    const translationScale = fields.get('desktopLyricTranslationScale');
    if (translationScale) translationScale.label.hidden = !value('desktopLyricShowTranslation') && !value('desktopLyricShowRoma');
    const sung = fields.get('desktopLyricSungColor');
    if (sung) sung.label.hidden = value('desktopLyricKaraokeMode') === 'off';
    for (const { section, controls } of advancedGroups) section.hidden = controls.every(control => control.hidden);
    const enabled = key => value(key) ? '开' : '关';
    const states = {
      content: `${Number(value('desktopLyricVisibleLines')) === 0 ? '整首' : `${value('desktopLyricVisibleLines')} 行`} · 翻译${enabled('desktopLyricShowTranslation')} · 罗马音${enabled('desktopLyricShowRoma')}`,
      highlight: { off: '整句显示', continuous: '连续填充', discrete: '逐字点亮' }[value('desktopLyricKaraokeMode')],
      effect: `描边${enabled('desktopLyricStrokeEnabled')} · 阴影${enabled('desktopLyricShadowEnabled')}`,
    };
    for (const { id, section, controls, status } of groups) {
      const layer = value('lyricLayer');
      section.hidden = controls.every(control => control.hidden)
        || scene && (layer === 'advanced' && !['layers', 'advanced-lyrics'].includes(id)
          || layer === 'basic' && id === 'advanced-lyrics');
      status.textContent = states[id] || '';
      status.hidden = !status.textContent;
    }
  };
}
