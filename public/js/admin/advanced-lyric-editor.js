import { ADVANCED_LYRIC_FIELDS, parseAdvancedLyricPresets } from '../shared/advanced-lyric-appearance.js';
import { ADVANCED_LYRIC_CATALOG } from '../shared/advanced-lyric-catalog.js';
import { ensureSavedFontOption, populateSystemFontOptions, registerFontSelect } from '../shared/font-library.js';
import { enhanceColorControls } from '../shared/color-control.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from '../shared/parameter-range.js';
import { dangerConfirm, toast } from '../shared/utils.js';

const GROUPS = [
  ['presets', '搭配', '一键套用 · 保存'], ['layout', '编排', '位置 · 构图 · 轮换'],
  ['appearance', '外观', '字体 · 配色 · 字效'], ['motion', '动效', '进出场 · 逐字'],
];
const EFFECT_TOGGLES = [['advancedLyricGlowEnabled', '外发光'], ['advancedLyricExtrudeEnabled', '长投影'], ['advancedLyricChromaticEnabled', '色差'],
  ['advancedLyricEmbossEnabled', '浮雕'], ['advancedLyricEchoEnabled', '回声'], ['advancedLyricHollowEnabled', '空心']];
const DISPLAY_TOGGLES = [['advancedLyricHideUnsung', '隐藏未唱'], ['advancedLyricShowTranslation', '翻译'], ['advancedLyricHideOnPause', '暂停隐藏']];
const SEQUENCES = {
  advancedLyricLayout: { key: 'advancedLyricLayoutSequence', enabled: 'advancedLyricRotateLayouts', label: '排版轮换', catalog: 'layouts' },
  advancedLyricEnter: { key: 'advancedLyricMotionSequence', enabled: 'advancedLyricRotateMotions', label: '入场轮换', catalog: 'enters' },
};
const DEFAULTS = Object.fromEntries(Object.entries(ADVANCED_LYRIC_FIELDS).map(([key, field]) => [key, String(field.default)]));
const PLACEMENT_FIELDS = new Set(['advancedLyricWidth', 'advancedLyricScale', 'advancedLyricPositionX', 'advancedLyricPositionY', 'advancedLyricRotate']);

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createAdvancedLyricEditor(root, { idPrefix = '', savedPresets = true } = {}) {
  let values = { ...DEFAULTS, advancedLyricSavedPresets: '[]' };
  let initialized = false;
  let currentGroup = 'presets';
  let savedList;
  let presetName;
  let presetSignature = '';
  const controls = new Map();
  const cards = [];
  const panels = new Map();
  const navigation = new Map();
  const sequenceLists = new Map();
  const libraries = new Map();
  const descriptions = new Map();
  const rotations = new Map();
  const rotationButtons = [];
  const states = [];
  let savedButtons = [];
  let savedCount;
  let freeLayouts;
  let motionIntro;
  const cleanups = [];

  function changed(patch) {
    values = { ...values, ...patch };
    sync();
    root.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectGroup(group) {
    currentGroup = group;
    for (const [id, panel] of panels) panel.hidden = id !== group;
    for (const [id, tab] of navigation) {
      tab.setAttribute('aria-selected', String(id === group));
      tab.tabIndex = id === group ? 0 : -1;
    }
    initParameterRanges(panels.get(group));
  }

  function createCard(entry, key, kind) {
    const item = element('div', 'advanced-lyric-choice');
    const button = element('button', 'advanced-lyric-style-card');
    button.type = 'button';
    button.dataset.lyricChoice = entry.id;
    button.dataset.lyricField = key;
    button.setAttribute('aria-pressed', 'false');
    const art = element('span', 'advanced-lyric-card-art');
    art.dataset.kind = kind;
    art.dataset.effect = entry.id;
    if (entry.settings) {
      art.dataset.layout = entry.settings.advancedLyricLayout || 'center';
      art.dataset.material = entry.settings.advancedLyricMaterial || 'solid';
      if (entry.settings.advancedLyricFontFamily) art.style.fontFamily = entry.settings.advancedLyricFontFamily;
      for (const [key, variable] of [['advancedLyricTextColor', '--card-lyric-color'], ['advancedLyricAccentColor', '--card-lyric-accent'], ['advancedLyricSecondaryColor', '--card-lyric-secondary']]) {
        if (entry.settings[key]) art.style.setProperty(variable, entry.settings[key]);
      }
    } else {
      if (kind === 'layouts') art.dataset.layout = entry.id;
      if (kind === 'materials') art.dataset.material = entry.id;
    }
    art.setAttribute('aria-hidden', 'true');
    const sample = ['把此刻', '唱成', '一首歌'];
    sample.forEach((text, index) => {
      const word = element('span', 'advanced-lyric-card-word', text);
      word.dataset.text = text;
      word.style.setProperty('--word', index);
      art.append(word);
    });
    const thumbnail = element('span', 'advanced-lyric-card-preview');
    thumbnail.append(art);
    button.append(thumbnail, element('strong', '', entry.label));
    const composition = ADVANCED_LYRIC_CATALOG.layouts.find(layout => layout.id === (entry.settings?.advancedLyricLayout || entry.id));
    if (entry.description || composition?.description) button.title = entry.description || composition.description;
    button.addEventListener('click', () => {
      if (key === 'preset') changed(Object.fromEntries(Object.entries({ ...DEFAULTS, ...entry.settings }).filter(([field]) => !PLACEMENT_FIELDS.has(field))));
      else changed({ [key]: entry.id, ...(SEQUENCES[key] ? { [SEQUENCES[key].enabled]: 'false' } : {}) });
    });
    cards.push({ button, entry, key });
    item.append(button);
    const sequence = SEQUENCES[key];
    if (sequence) {
      // A compact toggle on the card keeps rotation next to the effect it adds.
      const add = element('button', 'advanced-lyric-add-sequence', '+ 轮换');
      add.type = 'button';
      add.setAttribute('aria-label', `${entry.label}加入${sequence.label}`);
      add.addEventListener('click', () => {
        const entries = values[sequence.key]?.split(',').filter(Boolean) || [];
        if (entries.includes(entry.id)) { changed({ [sequence.key]: entries.filter(id => id !== entry.id).join(',') }); return; }
        if (entries.length >= 12) { toast('每组最多轮换 12 种效果。'); return; }
        changed({ [sequence.key]: [...entries, entry.id].join(','), [sequence.enabled]: 'true' });
      });
      rotationButtons.push({ button: add, entry, sequence });
      item.append(add);
    }
    return item;
  }

  function catalogLabel(key) {
    return ADVANCED_LYRIC_CATALOG[ADVANCED_LYRIC_FIELDS[key].catalog].find(entry => entry.id === values[key])?.label || '';
  }

  function createLibrary(key, field, body) {
    const entries = ADVANCED_LYRIC_CATALOG[field.catalog] || [];
    if (SEQUENCES[key]) {
      const rotation = element('div', 'advanced-lyric-rotation');
      const list = element('div', 'advanced-lyric-sequence');
      rotation.append(list);
      body.append(rotation);
      rotations.set(SEQUENCES[key].enabled, rotation);
      sequenceLists.set(key, list);
    }
    const description = element('p', 'hint advanced-lyric-selection-description');
    descriptions.set(key, description);
    const grid = element('div', 'advanced-lyric-card-grid');
    for (const entry of entries.filter(entry => field.catalog !== 'layouts' || entry.choreography)) grid.append(createCard(entry, key, field.catalog));
    body.append(description, grid);
    if (field.catalog === 'layouts') {
      const free = entries.filter(entry => !entry.choreography);
      freeLayouts = element('details', 'advanced-lyric-free-layouts');
      const summary = element('summary');
      summary.append(element('span', '', '自由构图'), element('small', '', `${free.length} 种 · 可自配进出场`));
      const freeGrid = element('div', 'advanced-lyric-card-grid');
      for (const entry of free) freeGrid.append(createCard(entry, key, field.catalog));
      freeLayouts.append(summary, freeGrid);
      body.append(freeLayouts);
    }
  }

  function createControl(key, field, panel) {
    const row = element('label', 'desktop-lyric-control advanced-lyric-control');
    row.htmlFor = `${idPrefix}${key}`;
    const copy = element('span', 'desktop-lyric-control-copy');
    copy.append(element('strong', '', field.label));
    if (field.description) copy.append(element('small', '', field.description));
    row.append(copy);
    let input;
    let numberInput;
    if (key === 'advancedLyricFontFamily' || field.type === 'select') {
      input = element('select');
      const options = field.options || { [field.default]: field.default };
      for (const [value, label] of Object.entries(options)) {
        const option = element('option', '', label);
        option.value = value;
        input.append(option);
      }
      if (key === 'advancedLyricFontFamily') {
        populateSystemFontOptions(input);
        ensureSavedFontOption(input, values[key]);
        cleanups.push(registerFontSelect(input));
      }
      row.append(input);
    } else if (field.type === 'checkbox') {
      input = element('input');
      input.type = 'checkbox';
      const toggle = element('span', 'switch-control');
      toggle.append(input, element('span', 'switch-track'));
      row.append(toggle);
    } else if (field.type === 'number') {
      input = element('input', 'parameter-range');
      input.type = 'range';
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step || 1);
      const range = element('span', 'advanced-lyric-range');
      numberInput = element('input');
      numberInput.type = 'number';
      numberInput.min = input.min;
      numberInput.max = input.max;
      numberInput.step = input.step;
      numberInput.setAttribute('aria-label', `${field.label}数值`);
      numberInput.addEventListener('input', event => {
        event.stopPropagation();
        if (!numberInput.validity.valid || numberInput.value === '') return;
        input.value = numberInput.value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      numberInput.addEventListener('change', event => {
        event.stopPropagation();
        numberInput.value = input.value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      range.append(input, numberInput);
      row.append(range);
      row.classList.add('advanced-lyric-range-control');
    } else {
      input = element('input');
      input.type = field.type === 'color' ? 'color' : 'text';
      if (field.maxLength) input.maxLength = field.maxLength;
      row.append(input);
    }
    input.id = `${idPrefix}${key}`;
    input.dataset.advancedLyricParameter = key;
    input.addEventListener('input', () => {
      values[key] = input.type === 'checkbox' ? String(input.checked) : input.value;
      if (numberInput) numberInput.value = input.value;
      syncCards();
    });
    input.addEventListener('change', () => {
      values[key] = input.type === 'checkbox' ? String(input.checked) : input.value;
      sync();
    });
    controls.set(key, { input, numberInput, row });
    panel.append(row);
  }

  function syncCards() {
    for (const { button, entry, key } of cards) {
      const selected = key === 'preset'
        ? Object.entries({ ...DEFAULTS, ...entry.settings }).every(([field, value]) => PLACEMENT_FIELDS.has(field) || ADVANCED_LYRIC_FIELDS[field]?.hidden || String(values[field]) === String(value))
        : key === 'palette' ? Object.entries(entry.settings).every(([field, value]) => values[field] === value) : values[key] === entry.id;
      button.setAttribute('aria-pressed', String(selected));
    }
    for (const [key, description] of descriptions) {
      const field = ADVANCED_LYRIC_FIELDS[key];
      const selected = ADVANCED_LYRIC_CATALOG[field.catalog].find(entry => entry.id === values[key]);
      description.textContent = selected ? `当前：${selected.label}${selected.description ? ` — ${selected.description}` : ''}` : '';
      description.hidden = !description.textContent;
    }
    for (const { button, settings } of savedButtons) {
      button.setAttribute('aria-pressed', String(Object.entries(settings).every(([field, value]) =>
        PLACEMENT_FIELDS.has(field) || ADVANCED_LYRIC_FIELDS[field]?.hidden || String(values[field]) === String(value))));
    }
    syncStates();
  }

  function syncStates() {
    for (const { node, read } of states) {
      const state = read();
      if (Array.isArray(state)) {
        node.replaceChildren(...state.map(color => {
          const swatch = element('span', 'advanced-lyric-state-swatch');
          swatch.style.backgroundColor = color;
          return swatch;
        }));
      } else node.textContent = state;
    }
  }

  function syncSequences() {
    for (const { button, entry, sequence } of rotationButtons) {
      const entries = values[sequence.key]?.split(',').filter(Boolean) || [];
      const position = entries.indexOf(entry.id) + 1;
      button.textContent = position ? `轮换 ${position}` : '+ 轮换';
      button.setAttribute('aria-pressed', String(position > 0));
    }
    for (const [key, list] of sequenceLists) {
      const sequence = SEQUENCES[key];
      const entries = values[sequence.key]?.split(',').filter(Boolean) || [];
      list.replaceChildren(element('span', 'hint', entries.length ? `${sequence.label}顺序（点击移除）` : '点击卡片上的“+ 轮换”加入，开启后按每句歌词依次切换。'));
      for (const [index, id] of entries.entries()) {
        const entry = ADVANCED_LYRIC_CATALOG[sequence.catalog].find(item => item.id === id);
        if (!entry) continue;
        const remove = element('button', 'advanced-lyric-sequence-item', `${index + 1}. ${entry.label} ×`);
        remove.type = 'button';
        remove.setAttribute('aria-label', `从${sequence.label}中移除${entry.label}`);
        remove.addEventListener('click', () => changed({ [sequence.key]: entries.filter(item => item !== id).join(',') }));
        list.append(remove);
      }
    }
  }

  function syncSavedPresets() {
    if (!savedList || presetSignature === values.advancedLyricSavedPresets) return;
    presetSignature = values.advancedLyricSavedPresets;
    const presets = parseAdvancedLyricPresets(presetSignature);
    savedList.replaceChildren();
    savedButtons = [];
    savedCount = presets.length;
    if (!presets.length) savedList.append(element('p', 'hint', '还没有保存的搭配。调好后在下方起名保存，之后一键套用。'));
    for (const preset of presets) {
      const row = element('div', 'advanced-lyric-saved-preset');
      const use = element('button', 'advanced-lyric-saved-preset-use', preset.name);
      use.type = 'button';
      use.setAttribute('aria-pressed', 'false');
      use.addEventListener('click', () => { presetName.value = preset.name; changed({ ...DEFAULTS, ...preset.settings }); });
      savedButtons.push({ button: use, settings: preset.settings });
      const remove = element('button', 'advanced-lyric-delete-preset', '×');
      remove.type = 'button';
      remove.title = '删除';
      remove.setAttribute('aria-label', `删除搭配 ${preset.name}`);
      remove.addEventListener('click', async () => {
        if (!await dangerConfirm({ title: `删除搭配“${preset.name}”？`, message: '当前正在使用的外观会保留。', confirmLabel: '删除搭配' })) return;
        const next = parseAdvancedLyricPresets(values.advancedLyricSavedPresets).filter(item => item.id !== preset.id);
        changed({ advancedLyricSavedPresets: JSON.stringify(next) });
      });
      row.append(use, remove);
      savedList.append(row);
    }
  }

  function sync() {
    if (!initialized) return;
    const material = values.advancedLyricMaterial;
    const glow = values.advancedLyricGlowEnabled !== 'false' || material === 'neon';
    for (const [key, { input, numberInput, row }] of controls) {
      if (input.type === 'checkbox') input.checked = values[key] !== 'false';
      else {
        if (key === 'advancedLyricFontFamily') ensureSavedFontOption(input, values[key]);
        input.value = values[key];
      }
      if (numberInput) { numberInput.value = values[key]; refreshParameterRange(input); }
      if (['advancedLyricStrokeColor', 'advancedLyricStrokeWidth', 'advancedLyricStrokeLayers'].includes(key)) row.hidden = values.advancedLyricStrokeEnabled === 'false';
      if (['advancedLyricShadowColor', 'advancedLyricShadowDistance', 'advancedLyricShadowAngle', 'advancedLyricShadowBlur'].includes(key)) row.hidden = values.advancedLyricShadowEnabled === 'false';
      if (['advancedLyricGlowRadius', 'advancedLyricGlowOpacity'].includes(key)) row.hidden = !glow;
      if (key === 'advancedLyricGradientAngle') row.hidden = values.advancedLyricHollowEnabled === 'true' || !['gradient', 'sunset', 'aurora', 'metallic', 'glass', 'striped', 'holo', 'ink-wash', 'film'].includes(material);
      if (key === 'advancedLyricTextureScale') row.hidden = values.advancedLyricHollowEnabled === 'true' || !['striped', 'dots', 'chalk', 'holo', 'film'].includes(material);
      if (key === 'advancedLyricHighlightOpacity') row.hidden = values.advancedLyricWordMotion === 'none';
      if (key === 'advancedLyricEffectStrength') row.hidden = !glow && !['ShadowEnabled', 'ExtrudeEnabled', 'ChromaticEnabled'].some(field => values[`advancedLyric${field}`] === 'true');
    }
    syncSavedPresets();
    syncCards();
    syncSequences();
    syncChoreography();
  }

  function syncChoreography() {
    const selected = ADVANCED_LYRIC_CATALOG.layouts.find(layout => layout.id === values.advancedLyricLayout);
    const sequence = values.advancedLyricLayoutSequence.split(',').filter(Boolean);
    const layouts = values.advancedLyricRotateLayouts === 'true'
      ? ADVANCED_LYRIC_CATALOG.layouts.filter(layout => !sequence.length || sequence.includes(layout.id)) : [selected];
    const authored = layouts.every(layout => layout?.choreography);
    for (const key of ['advancedLyricEnter', 'advancedLyricHold', 'advancedLyricExit']) libraries.get(key).hidden = authored;
    controls.get('advancedLyricRotateMotions').row.hidden = authored;
    controls.get('advancedLyricMotionDuration').row.querySelector('strong').textContent = authored ? '词组交接时长（毫秒）' : '进出场时长（毫秒）';
    motionIntro.textContent = authored
      ? '完整编排自带进出场。调整交接快慢、动作幅度和逐字表现即可。'
      : '自由构图可分别搭配入场、停留和退场。轮换中的完整编排使用自己的动作；退场只在尾音结束后有空隙时播放。';
    if (!selected?.choreography) freeLayouts.open = true;
  }

  // Every editor section is a card whose header shows the current value while collapsed.
  function createSection(panel, title, { open = false, state, hint } = {}) {
    const section = element('details', 'advanced-lyric-section');
    section.open = open;
    const summary = element('summary');
    summary.append(element('span', 'advanced-lyric-section-title', title));
    if (state) {
      const node = element('span', 'advanced-lyric-section-state');
      summary.append(node);
      states.push({ node, read: state });
    }
    const body = element('div', 'advanced-lyric-section-body');
    if (hint) body.append(element('p', 'hint advanced-lyric-intro', hint));
    section.append(summary, body);
    panel.append(section);
    return body;
  }

  function subheading(panel, text) {
    panel.append(element('h5', 'advanced-lyric-subheading', text));
  }

  function selectedPresetLabel(authored) {
    return cards.find(({ button, entry, key }) => key === 'preset' && button.getAttribute('aria-pressed') === 'true'
      && Boolean(ADVANCED_LYRIC_CATALOG.layouts.find(layout => layout.id === entry.settings.advancedLyricLayout)?.choreography) === authored)?.entry.label || '';
  }

  function createPresets(panel) {
    if (savedPresets) {
      const mine = createSection(panel, '我的搭配', { open: true, state: () => `${savedCount || 0} / 20 套` });
      savedList = element('div', 'advanced-lyric-saved-presets');
      const save = element('div', 'advanced-lyric-preset-save');
      presetName = element('input');
      presetName.type = 'text';
      presetName.maxLength = 64;
      presetName.placeholder = '给当前搭配起个名字';
      presetName.setAttribute('aria-label', '搭配名称');
      presetName.addEventListener('input', event => event.stopPropagation());
      presetName.addEventListener('change', event => event.stopPropagation());
      const saveButton = element('button', 'secondary', '保存搭配');
      saveButton.type = 'button';
      saveButton.addEventListener('click', async () => {
        const name = presetName.value.trim();
        if (!name) { presetName.focus(); return; }
        const presets = parseAdvancedLyricPresets(values.advancedLyricSavedPresets);
        const existing = presets.find(item => item.name === name);
        if (existing && !await dangerConfirm({ title: `更新搭配“${name}”？`, message: '用当前高级歌词的外观替换已保存的同名搭配。', confirmLabel: '更新搭配' })) return;
        if (!existing && presets.length >= 20) { toast('最多保存 20 套搭配，请先删除不需要的搭配。'); return; }
        const settings = Object.fromEntries(Object.keys(ADVANCED_LYRIC_FIELDS).map(key => [key, values[key]]));
        const next = { id: existing?.id || crypto.randomUUID(), name, settings };
        changed({ advancedLyricSavedPresets: JSON.stringify([...presets.filter(item => item.id !== next.id), next]) });
      });
      save.append(presetName, saveButton);
      mine.append(savedList, save);
    }
    const builtIn = createSection(panel, '内置搭配', { open: true, state: () => selectedPresetLabel(true),
      hint: '一键套用整套编排、配色和动效，之后可在其他分类继续微调；画面位置与尺寸保持不变。' });
    const grid = element('div', 'advanced-lyric-card-grid');
    const freeGrid = element('div', 'advanced-lyric-card-grid');
    let freeCount = 0;
    for (const preset of ADVANCED_LYRIC_CATALOG.presets) {
      const authored = ADVANCED_LYRIC_CATALOG.layouts.find(layout => layout.id === preset.settings.advancedLyricLayout)?.choreography;
      if (!authored) freeCount++;
      (authored ? grid : freeGrid).append(createCard(preset, 'preset', 'presets'));
    }
    builtIn.append(grid);
    const free = createSection(panel, '自由组合搭配', { state: () => selectedPresetLabel(false) || `${freeCount} 种`,
      hint: '自由构图配合独立进出场，适合四角、竖排、气泡等版式。' });
    free.append(freeGrid);
  }

  function createPalettes(panel) {
    subheading(panel, '快速配色');
    panel.append(element('p', 'hint', '只替换文字、强调和辅助颜色，可与任意编排和材质组合。墨色适合浅色画面。'));
    const grid = element('div', 'advanced-lyric-palette-grid');
    for (const entry of ADVANCED_LYRIC_CATALOG.palettes) {
      const button = element('button', 'advanced-lyric-palette');
      button.type = 'button';
      const swatches = element('span', 'advanced-lyric-swatches');
      swatches.setAttribute('aria-hidden', 'true');
      for (const color of Object.values(entry.settings)) {
        const swatch = element('span');
        swatch.style.backgroundColor = color;
        swatches.append(swatch);
      }
      button.append(swatches, element('span', '', entry.label));
      button.addEventListener('click', () => changed(entry.settings));
      cards.push({ button, entry, key: 'palette' });
      grid.append(button);
    }
    panel.append(grid);
    subheading(panel, '自定义颜色');
  }

  function createPositionActions(panel) {
    const actions = element('div', 'advanced-lyric-position-actions');
    for (const [label, patch] of [
      ['水平居中', { advancedLyricPositionX: '50' }],
      ['垂直居中', { advancedLyricPositionY: '50' }],
      ['重置位置', { advancedLyricPositionX: DEFAULTS.advancedLyricPositionX, advancedLyricPositionY: DEFAULTS.advancedLyricPositionY }],
    ]) {
      const button = element('button', 'secondary', label);
      button.type = 'button';
      button.addEventListener('click', () => changed(patch));
      actions.append(button);
    }
    panel.append(actions);
  }

  function enabledLabels(fields) {
    return fields.filter(([key]) => values[key] === 'true').map(([, label]) => label);
  }

  function createSections() {
    const layout = panels.get('layout');
    const placement = createSection(layout, '位置与尺寸', {
      state: () => `水平 ${values.advancedLyricPositionX}% · 垂直 ${values.advancedLyricPositionY}% · 宽 ${values.advancedLyricWidth}%`,
      hint: '也可以直接在预览中拖动歌词，松开后自动保存。' });
    subheading(placement, '画面位置');
    const position = element('div', 'advanced-lyric-control-list');
    placement.append(position);
    createPositionActions(placement);
    subheading(placement, '尺寸与旋转');
    const size = element('div', 'advanced-lyric-control-list');
    placement.append(size);
    const composition = createSection(layout, '编排与构图', { open: true,
      state: () => (values.advancedLyricRotateLayouts === 'true' ? '按句轮换' : catalogLabel('advancedLyricLayout')) });

    const appearance = panels.get('appearance');
    const weights = ADVANCED_LYRIC_FIELDS.advancedLyricFontWeight.options;
    const fontName = () => (controls.get('advancedLyricFontFamily')?.input.selectedOptions[0]?.textContent || values.advancedLyricFontFamily).split(' · ')[0];
    const sections = {
      font: createSection(appearance, '字体', { open: true, state: () => `${fontName()} · ${weights[values.advancedLyricFontWeight] || ''} · ${values.advancedLyricFontSize}` }),
      colors: createSection(appearance, '配色', { state: () => [values.advancedLyricTextColor, values.advancedLyricAccentColor, values.advancedLyricSecondaryColor] }),
      material: createSection(appearance, '文字材质', { state: () => catalogLabel('advancedLyricMaterial') }),
      stroke: createSection(appearance, '描边', { state: () => (values.advancedLyricStrokeEnabled === 'false' ? '关闭' : `宽 ${values.advancedLyricStrokeWidth} · ${values.advancedLyricStrokeLayers} 层`) }),
      shadow: createSection(appearance, '投影', { state: () => (values.advancedLyricShadowEnabled === 'false' ? '关闭' : `距离 ${values.advancedLyricShadowDistance} · ${values.advancedLyricShadowAngle}°`) }),
      effects: createSection(appearance, '光效与特效', { state: () => enabledLabels(EFFECT_TOGGLES).join(' · ') || '未开启' }),
      decoration: createSection(appearance, '装饰', { state: () => catalogLabel('advancedLyricDecoration') }),
      display: createSection(appearance, '显示内容', {
        state: () => [...enabledLabels(DISPLAY_TOGGLES), `不透明度 ${Math.round(Number(values.advancedLyricOpacity) * 100)}%`].join(' · ') }),
    };
    createPalettes(sections.colors);

    const motion = panels.get('motion');
    const rhythm = createSection(motion, '节奏', { open: true, state: () => `${values.advancedLyricMotionDuration} 毫秒 · 幅度 ${values.advancedLyricMotionAmount}` });
    motionIntro = element('p', 'hint advanced-lyric-intro');
    rhythm.append(motionIntro);
    const motionCards = {
      advancedLyricEnter: createSection(motion, '入场', { open: true,
        state: () => (values.advancedLyricRotateMotions === 'true' ? '按句轮换' : catalogLabel('advancedLyricEnter')) }),
      advancedLyricHold: createSection(motion, '停留', { state: () => catalogLabel('advancedLyricHold') }),
      advancedLyricExit: createSection(motion, '退场', { state: () => catalogLabel('advancedLyricExit') }),
      advancedLyricWordMotion: createSection(motion, '逐字动作', { open: true, state: () => catalogLabel('advancedLyricWordMotion') }),
    };
    for (const [key, body] of Object.entries(motionCards)) libraries.set(key, body.parentElement);

    const material = new Set(['advancedLyricMaterial', 'advancedLyricGradientAngle', 'advancedLyricTextureScale']);
    const target = (key, field) => {
      if (key === 'advancedLyricPositionX' || key === 'advancedLyricPositionY') return position;
      if (PLACEMENT_FIELDS.has(key)) return size;
      if (key === 'advancedLyricLayout') return composition;
      if (motionCards[key]) return motionCards[key];
      if (key === 'advancedLyricMotionDuration' || key === 'advancedLyricMotionAmount') return rhythm;
      if (rotations.has(key)) return rotations.get(key);
      if (material.has(key)) return sections.material;
      if (key.startsWith('advancedLyricStroke')) return sections.stroke;
      if (key.startsWith('advancedLyricShadow')) return sections.shadow;
      if (field.group === 'effects') return sections.effects;
      if (field.group === 'font' && field.type === 'color' || field.group === 'colors') return sections.colors;
      return sections[field.group] || panels.get(field.group);
    };
    for (const [key, field] of Object.entries(ADVANCED_LYRIC_FIELDS)) {
      if (field.hidden || key.endsWith('Sequence')) continue;
      const panel = target(key, field);
      if (field.catalog) createLibrary(key, field, panel);
      else createControl(key, field, panel);
    }
    // Rotation switches lead their strip so the order list reads beneath them.
    for (const [key, rotation] of rotations) rotation.prepend(controls.get(key).row);
  }

  function activate() {
    if (initialized || !root) return;
    initialized = true;
    const nav = element('div', 'advanced-lyric-categories');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', '高级歌词编辑分类');
    const body = element('div', 'advanced-lyric-editor-body');
    for (const [index, [id, title, caption]] of GROUPS.entries()) {
      const tab = element('button');
      tab.type = 'button';
      tab.id = `${idPrefix}advancedLyricCategory-${id}`;
      const note = element('small', 'advanced-lyric-category-caption', caption);
      note.id = `${tab.id}-caption`;
      note.setAttribute('aria-hidden', 'true');
      tab.append(element('span', 'advanced-lyric-category-title', title), note);
      tab.setAttribute('aria-describedby', note.id);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `${idPrefix}advancedLyricGroup-${id}`);
      tab.addEventListener('click', () => selectGroup(id));
      tab.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % GROUPS.length
          : event.key === 'ArrowLeft' ? (index + GROUPS.length - 1) % GROUPS.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? GROUPS.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        selectGroup(GROUPS[next][0]);
        navigation.get(GROUPS[next][0]).focus();
      });
      navigation.set(id, tab);
      nav.append(tab);
      const panel = element('section', 'advanced-lyric-group');
      panel.id = `${idPrefix}advancedLyricGroup-${id}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panels.set(id, panel);
      body.append(panel);
    }
    createPresets(panels.get('presets'));
    createSections();
    const actions = element('section', 'advanced-lyric-actions');
    const copy = element('span', 'advanced-lyric-actions-copy');
    copy.append(element('strong', '', '操作'), element('small', '', '恢复排版、配色和动效；已保存的搭配会保留。'));
    const reset = element('button', 'desktop-lyric-reset-button', '恢复高级歌词默认设置');
    reset.type = 'button';
    reset.addEventListener('click', () => root.dispatchEvent(new Event('lyric:reset-advanced', { bubbles: true })));
    actions.append(copy, reset);
    root.append(nav, body, actions);
    enhanceColorControls(root);
    sync();
    selectGroup(currentGroup);
  }

  return {
    activate,
    read: () => ({ ...values }),
    setPosition({ x, y }, commit) {
      for (const [key, value] of [['advancedLyricPositionX', x], ['advancedLyricPositionY', y]]) {
        values[key] = String(value);
        const control = controls.get(key);
        if (control) {
          control.input.value = values[key];
          control.numberInput.value = values[key];
          refreshParameterRange(control.input);
        }
      }
      if (initialized) syncStates();
      root.dispatchEvent(new Event(commit ? 'change' : 'input', { bubbles: true }));
    },
    load(settings) {
      values = { ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).filter(key => settings[key] !== undefined).map(key => [key, String(settings[key])])),
        advancedLyricSavedPresets: settings.advancedLyricSavedPresets ?? '[]' };
      sync();
    },
    reset: () => changed(DEFAULTS),
    dispose() {
      cleanups.forEach(cleanup => cleanup?.());
      if (root) disposeParameterRanges(root);
    },
  };
}
