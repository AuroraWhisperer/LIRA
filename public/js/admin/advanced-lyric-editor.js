import { ADVANCED_LYRIC_FIELDS, parseAdvancedLyricPresets } from '../shared/advanced-lyric-appearance.js';
import { ADVANCED_LYRIC_CATALOG } from '../shared/advanced-lyric-catalog.js';
import { ensureSavedFontOption, populateSystemFontOptions, registerFontSelect } from '../shared/font-library.js';
import { enhanceColorControls } from '../shared/color-control.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from '../shared/parameter-range.js';
import { dangerConfirm, toast } from '../shared/utils.js';

const GROUPS = [
  ['presets', '整套搭配'], ['layout', '排版与位置'], ['font', '字体与配色'],
  ['effects', '字效与材质'], ['motion', '动效与轮换'], ['decoration', '装饰'], ['display', '显示内容'],
];
const SEQUENCES = {
  advancedLyricLayout: { key: 'advancedLyricLayoutSequence', enabled: 'advancedLyricRotateLayouts', label: '排版轮换', catalog: 'layouts' },
  advancedLyricEnter: { key: 'advancedLyricMotionSequence', enabled: 'advancedLyricRotateMotions', label: '入场轮换', catalog: 'enters' },
};
const DEFAULTS = Object.fromEntries(Object.entries(ADVANCED_LYRIC_FIELDS).map(([key, field]) => [key, String(field.default)]));

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createAdvancedLyricEditor(root) {
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
      word.style.setProperty('--word', index);
      art.append(word);
    });
    button.append(art, element('strong', '', entry.label));
    if (entry.description) button.title = entry.description;
    button.addEventListener('click', () => {
      if (key === 'preset') changed({ ...DEFAULTS, ...entry.settings });
      else changed({ [key]: entry.id, ...(SEQUENCES[key] ? { [SEQUENCES[key].enabled]: 'false' } : {}) });
    });
    cards.push({ button, entry, key });
    item.append(button);
    const sequence = SEQUENCES[key];
    if (sequence) {
      const add = element('button', 'advanced-lyric-add-sequence', '加入轮换');
      add.type = 'button';
      add.setAttribute('aria-label', `${entry.label}加入${sequence.label}`);
      add.addEventListener('click', () => {
        const entries = values[sequence.key]?.split(',').filter(Boolean) || [];
        if (!entries.includes(entry.id) && entries.length >= 12) { toast('每组最多轮换 12 种效果。'); return; }
        if (!entries.includes(entry.id)) entries.push(entry.id);
        changed({ [sequence.key]: entries.join(','), [sequence.enabled]: 'true' });
      });
      item.append(add);
    }
    return item;
  }

  function createLibrary(key, field, panel) {
    const motion = field.group === 'motion';
    const section = element(motion ? 'details' : 'section', 'advanced-lyric-library');
    section.append(element(motion ? 'summary' : 'h4', 'ui-section-title', field.label));
    if (motion) section.open = field.catalog === 'enters';
    const grid = element('div', 'advanced-lyric-card-grid');
    for (const entry of ADVANCED_LYRIC_CATALOG[field.catalog] || []) grid.append(createCard(entry, key, field.catalog));
    section.append(grid);
    if (SEQUENCES[key]) {
      const list = element('div', 'advanced-lyric-sequence');
      section.append(list);
      sequenceLists.set(key, list);
    }
    panel.append(section);
  }

  function createControl(key, field, panel) {
    const row = element('label', 'desktop-lyric-control advanced-lyric-control');
    row.htmlFor = key;
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
    input.id = key;
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
        ? Object.entries({ ...DEFAULTS, ...entry.settings }).every(([field, value]) => ADVANCED_LYRIC_FIELDS[field]?.hidden || String(values[field]) === String(value))
        : values[key] === entry.id;
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  function syncSequences() {
    for (const [key, list] of sequenceLists) {
      const sequence = SEQUENCES[key];
      const entries = values[sequence.key]?.split(',').filter(Boolean) || [];
      list.replaceChildren(element('span', 'hint', entries.length ? `${sequence.label}顺序` : '点击卡片下方“加入轮换”，按每句歌词切换。'));
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
    if (!presets.length) savedList.append(element('p', 'hint', '把当前的排版、字效和动作保存成自己的搭配。'));
    for (const preset of presets) {
      const row = element('div', 'advanced-lyric-saved-preset');
      const use = element('button', 'secondary', preset.name);
      use.type = 'button';
      use.addEventListener('click', () => { presetName.value = preset.name; changed({ ...DEFAULTS, ...preset.settings }); });
      const remove = element('button', 'advanced-lyric-delete-preset', '删除');
      remove.type = 'button';
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
    for (const [key, { input, numberInput, row }] of controls) {
      if (input.type === 'checkbox') input.checked = values[key] !== 'false';
      else {
        if (key === 'advancedLyricFontFamily') ensureSavedFontOption(input, values[key]);
        input.value = values[key];
      }
      if (numberInput) { numberInput.value = values[key]; refreshParameterRange(input); }
      if (['advancedLyricStrokeColor', 'advancedLyricStrokeWidth', 'advancedLyricStrokeLayers'].includes(key)) row.hidden = values.advancedLyricStrokeEnabled === 'false';
    }
    syncCards();
    syncSequences();
    syncSavedPresets();
  }

  function createPresets(panel) {
    const intro = element('p', 'hint advanced-lyric-intro', '选一套搭配开始，再分别调整排版、字效和动作。');
    const grid = element('div', 'advanced-lyric-card-grid');
    for (const preset of ADVANCED_LYRIC_CATALOG.presets) grid.append(createCard(preset, 'preset', 'presets'));
    panel.append(intro, grid, element('h4', 'ui-section-title', '我的搭配'));
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
    savedList = element('div', 'advanced-lyric-saved-presets');
    panel.append(save, savedList);
  }

  function activate() {
    if (initialized || !root) return;
    initialized = true;
    const nav = element('div', 'advanced-lyric-categories');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', '高级歌词编辑分类');
    const body = element('div', 'advanced-lyric-editor-body');
    for (const [index, [id, title]] of GROUPS.entries()) {
      const tab = element('button', '', title);
      tab.type = 'button';
      tab.id = `advancedLyricCategory-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `advancedLyricGroup-${id}`);
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
      panel.id = `advancedLyricGroup-${id}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panels.set(id, panel);
      body.append(panel);
    }
    createPresets(panels.get('presets'));
    for (const [key, field] of Object.entries(ADVANCED_LYRIC_FIELDS)) {
      if (field.hidden || key.endsWith('Sequence')) continue;
      const panel = panels.get(field.group) || panels.get('display');
      if (field.catalog) createLibrary(key, field, panel);
      else createControl(key, field, panel);
    }
    const reset = element('button', 'desktop-lyric-reset-button', '恢复高级歌词默认设置');
    reset.type = 'button';
    reset.addEventListener('click', () => root.dispatchEvent(new Event('lyric:reset-advanced', { bubbles: true })));
    root.append(nav, body, reset);
    enhanceColorControls(root);
    sync();
    selectGroup(currentGroup);
  }

  return {
    activate,
    read: () => ({ ...values }),
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
