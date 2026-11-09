// 编写人：Aurora
// 桌面歌词设置
'use strict';

import { DESKTOP_LYRIC_DEFAULTS } from '../lyrics/desktop-lyric-defaults.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';
import * as sharedUtils from '../shared/utils.js';
import { formsService } from './forms.js';
import { stateService } from './state.js';
import { desktopLyricPreview } from './desktop-lyric-preview.js';
import { ensureSavedFontOption, registerFontSelect, populateSystemFontOptions } from '../shared/font-library.js';
import { createLyricSourceControls } from './lyric-source-controls.js';
import { syncDesktopLyricKaraokeColorControls } from './desktop-lyric-controls.js';
import { groupDesktopLyricParameters } from './desktop-lyric-parameter-layout.js';
import { LYRIC_DISPLAY_FIELDS } from '../shared/advanced-lyric-appearance.js';
import { createAdvancedLyricEditor } from './advanced-lyric-editor.js';
import { createComponentConfigController } from './component-config-controller.js';
import { saveComponentSettings, confirmComponentSettings } from './component-settings-save.js';

export function createDesktopLyric({
  utils = sharedUtils,
  forms = formsService,
  state = stateService,
  preview = desktopLyricPreview,
  saveSettings = saveComponentSettings,
  confirmSettings = confirmComponentSettings,
} = {}) {
  const AUTOSAVE_DELAY_MS = 500;
  const { setValue, api, dangerConfirm } = utils;
  const lyricSourceControls = createLyricSourceControls({ api, state });
  let syncParameterLayout = () => {};
  let advancedEditor = null;
  let syncEditorMode = () => {};
  const CHECKBOX_KEYS = new Set([
    'desktopLyricStrokeEnabled',
    'desktopLyricShadowEnabled',
    'desktopLyricShowTranslation',
    'desktopLyricKaraokeEnabled',
    'desktopLyricHidePassedLines',
    'desktopLyricTraditionalMode',
    'desktopLyricHideOnPause',
    'desktopLyricCurrentLineEnhanced',
    'desktopLyricShowTitleWhenNoLyric',
    'desktopLyricSpringAnimation',
    'desktopLyricBlurEffect',
    'desktopLyricScaleEffect',
    'desktopLyricBackgroundEnabled',
  ]);
  // 第五项把内部小数换算为数值框中的百分数。
  const RANGE_PAIRS = [
    ['desktopLyricFontSize', 24, 72, 56],
    ['desktopLyricLetterSpacing', -0.1, 2, 0],
    ['desktopLyricLineHeight', 1, 2, 1.4, 100],
    ['desktopLyricStrokeWidth', 0, 6, 3],
    ['desktopLyricShadowIntensity', 0, 1, 0.35, 100],
    ['desktopLyricShadowBlur', 0, 30, 8],
    ['desktopLyricShadowOffsetX', -20, 20, 0],
    ['desktopLyricShadowOffsetY', -20, 20, 3],
    ['desktopLyricTranslationScale', 0.4, 1, 0.65, 100],
    ['desktopLyricInterludeOffsetEm', -10, 10, 0],
    ['desktopLyricOpacity', 0, 1, 0.95, 100],
    ['desktopLyricBaseOpacity', 0, 1, 0.38, 100],
    ['desktopLyricTranslationOpacity', 0, 1, 0.72, 100],
    ['desktopLyricTimeOffsetMs', -5000, 5000, 0],
    ['desktopLyricScale', 0.5, 2, 1, 100],
    ['desktopLyricAlignPosition', 0, 1, 0.5, 100],
    ['desktopLyricTranslateX', -500, 500, 0],
    ['desktopLyricTranslateY', -500, 500, 0],
    ['desktopLyricPerspective', 200, 2000, 800],
    ['desktopLyricRotateX', -45, 45, 0],
    ['desktopLyricRotateY', -45, 45, 0],
    ['desktopLyricBgOpacity', 0, 1, 0.15, 100],
    ['desktopLyricGlobalOpacity', 0, 1, 1, 100],
    ['desktopLyricBrightness', 0.2, 2, 1, 100],
    ['desktopLyricContrast', 0.2, 2, 1, 100],
    ['desktopLyricSaturation', 0, 2, 1, 100],
  ];
  function initDesktopLyricForm() {
    const form = document.getElementById('desktopLyricForm');
    if (!form) return;
    advancedEditor = createAdvancedLyricEditor(document.getElementById('advancedLyricEditor'));
    let editorMode = 'basic';
    const modeTabs = [...document.querySelectorAll('#desktopLyricForm [data-lyric-editor]')];
    syncEditorMode = () => {
      for (const tab of modeTabs) {
        const active = tab.dataset.lyricEditor === editorMode;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
      }
      if (editorMode === 'advanced') advancedEditor.activate();
      document.getElementById('desktopLyricPage')?.classList.toggle('is-advanced', editorMode === 'advanced');
      preview.setPreviewLayer?.(editorMode);
    };
    modeTabs.forEach((tab, index) => {
      const select = () => { editorMode = tab.dataset.lyricEditor; syncEditorMode(); };
      tab.addEventListener('click', select);
      tab.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? 1 - index
          : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        modeTabs[next].click();
        modeTabs[next].focus();
      });
    });
    const groups = document.getElementById('desktopLyricSettingGroups');
    if (groups) {
      const fields = new Map();
      for (const key of Object.keys(DESKTOP_LYRIC_DEFAULTS)) {
        const input = document.getElementById(key);
        const label = input?.closest('.desktop-lyric-control');
        if (label) fields.set(key, { input, label });
      }
      syncParameterLayout = groupDesktopLyricParameters(groups, fields);
      groups.append(document.getElementById('desktopLyricResetBtn').closest('.desktop-lyric-reset-group'));
      syncParameterLayout();
    }
    lyricSourceControls.init();
    populateSystemFontOptions(document.getElementById('desktopLyricFontFamily'));
    registerFontSelect(document.getElementById('desktopLyricFontFamily'));
    const fontSelect = document.getElementById('desktopLyricFontFamily');
    ensureSavedFontOption(fontSelect, DESKTOP_LYRIC_DEFAULTS.desktopLyricFontFamily);
    fontSelect.value = DESKTOP_LYRIC_DEFAULTS.desktopLyricFontFamily;
    preview.init(form, { readSettings: collectDesktopLyric });

    // Range ↔ Number 双向绑定
    if (forms.bindRangePair) {
      RANGE_PAIRS.forEach(([key, minimum, maximum, fallback, displayScale = 1]) => {
        const step = SCENE_EXTRA_COMPONENTS.lyrics.fields[key].step;
        const range = document.getElementById(key), number = document.getElementById(`${key}Number`);
        if (range) range.step = String(step);
        if (number) number.step = String(step * displayScale);
        forms.bindRangePair(key, `${key}Number`, minimum, maximum, fallback, displayScale);
      });
    }

    const autosaveState = document.getElementById('desktopLyricAutosaveState');
    let autosaveTimer = null;
    let pendingInput = false;
    let pendingSave = false;
    let editingForm = false;
    const currentSettings = state.getAppState()?.settings;
    let settingsLoaded = Boolean(currentSettings);
    let renderedValues = collectDesktopLyric();
    const controller = createComponentConfigController({
      initial: currentSettings || {},
      persist: (_draft, patch) => saveSettings(patch),
      confirm: confirmSettings,
    });

    const setAutosaveState = (text, state = '') => {
      if (!autosaveState) return;
      autosaveState.textContent = text;
      autosaveState.className = `desktop-lyric-autosave-state${state ? ` ${state}` : ''}`;
    };

    const stopController = controller.subscribe(config => {
      if (!settingsLoaded) return;
      if (!editingForm) loadDesktopLyricSettings(config.draft);
      renderedValues = collectDesktopLyric();
      if (config.error) setAutosaveState(config.error, 'is-error');
      else if (config.saving) setAutosaveState('正在自动保存…', 'is-saving');
      else if (config.dirty) setAutosaveState('等待自动保存…', 'is-saving');
      else setAutosaveState(config.applied ? '已自动保存' : '修改后自动保存', config.applied ? 'is-saved' : '');
    });

    const editForm = () => {
      const values = collectDesktopLyric();
      // Compare with the rendered form so defaults and unrelated settings are never submitted.
      const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== renderedValues[key]));
      // Range pairs may clamp the saved value while the user is still typing the number.
      editingForm = true;
      try { controller.edit(patch); } finally { editingForm = false; }
    };

    const saveDesktopLyric = async () => {
      if (!settingsLoaded) return;
      editForm();
      if (controller.getStatus().saving) {
        pendingSave = true;
        return;
      }
      if (!controller.getStatus().dirty) return;
      await controller.save();
      if (pendingSave) {
        pendingSave = false;
        void saveDesktopLyric();
      }
    };

    const scheduleAutosave = (immediate = false) => {
      syncParameterLayout();
      syncEditorMode();
      clearTimeout(autosaveTimer);
      if (!settingsLoaded) {
        pendingInput = true;
        setAutosaveState('正在读取设置…', 'is-saving');
        return;
      }
      editForm();
      if (immediate) void saveDesktopLyric();
      else autosaveTimer = setTimeout(() => void saveDesktopLyric(), AUTOSAVE_DELAY_MS);
    };

    const receiveSettings = event => {
      settingsLoaded = true;
      controller.receive(event.detail);
      if (pendingInput) {
        pendingInput = false;
        autosaveTimer = setTimeout(() => void saveDesktopLyric(), AUTOSAVE_DELAY_MS);
      }
    };
    window.addEventListener('app:settings-state', receiveSettings);

    form.addEventListener('input', () => scheduleAutosave());
    form.addEventListener('change', () => scheduleAutosave(true));
    document.getElementById('desktopLyricResetBtn')?.addEventListener('click', async () => {
      if (!await dangerConfirm({ title: '恢复基础歌词默认设置？',
        message: '将恢复基础歌词的外观、显示行为和共用时间偏移。高级歌词外观、显示开关和音乐来源设置会保留。',
        confirmLabel: '恢复基础默认' })) return;
      loadDesktopLyricSettings(DESKTOP_LYRIC_DEFAULTS, {
        includeWeSing: false,
        includeAdvanced: false,
        includeDisplay: false,
      });
      scheduleAutosave(true);
    });
    document.getElementById('advancedLyricEditor')?.addEventListener('lyric:reset-advanced', async () => {
      if (!await dangerConfirm({ title: '恢复高级歌词默认设置？',
        message: '将恢复高级歌词的排版、配色和动效。已保存的搭配与显示开关会保留。',
        confirmLabel: '恢复高级默认' })) return;
      advancedEditor.reset();
    });
    syncEditorMode();
    window.addEventListener('pagehide', () => {
      clearTimeout(autosaveTimer);
      pendingSave = false;
      stopController();
      controller.reset();
      window.removeEventListener('app:settings-state', receiveSettings);
      advancedEditor?.dispose();
    }, { once: true });
  }

  function selectedWeSingLyricSource() {
    return document.querySelector('input[name="weSingLyricSource"]:checked')?.value || 'netease';
  }

  function checkedValue(id) {
    return document.getElementById(id)?.checked ? 'true' : 'false';
  }

  function collectDesktopLyric() {
    const settings = {
      ...advancedEditor?.read(),
      weSingLyricSource: selectedWeSingLyricSource(),
      weSingSmartLyricMatch: checkedValue('weSingSmartLyricMatch'),
    };
    for (const [key, field] of Object.entries(LYRIC_DISPLAY_FIELDS)) {
      const input = document.getElementById(key);
      settings[key] = input ? String(input.checked) : String(field.default);
    }
    Object.entries(DESKTOP_LYRIC_DEFAULTS).forEach(([key, fallback]) => {
      if (key === 'desktopLyricFallbackFontFamily') return;
      if (key === 'desktopLyricTextAlign') {
        settings[key] = selectedTextAlign();
        return;
      }
      if (key === 'desktopLyricKaraokeMode') {
        settings[key] = selectedKaraokeMode();
        return;
      }
      if (key === 'desktopLyricKaraokeEnabled') {
        settings[key] = selectedKaraokeMode() === 'off' ? 'false' : 'true';
        return;
      }
      const input = document.getElementById(key);
      settings[key] = document.getElementById(`${key}Inherited`)?.checked
        ? '' : input ? (CHECKBOX_KEYS.has(key) ? String(input.checked) : input.value) : fallback;
    });
    return settings;
  }

  function selectedTextAlign() {
    return document.querySelector('input[name="desktopLyricTextAlign"]:checked')?.value || 'left';
  }

  function selectedKaraokeMode() {
    return (
      document.querySelector('input[name="desktopLyricKaraokeMode"]:checked')?.value ||
      DESKTOP_LYRIC_DEFAULTS.desktopLyricKaraokeMode
    );
  }

  function loadDesktopLyricSettings(settings, options = {}) {
    if (!settings) return;

    if (options.includeWeSing !== false) loadWeSingLyricSettings(settings);
    if (options.includeAdvanced !== false) advancedEditor?.load(settings);
    if (options.includeDisplay !== false) {
      for (const [key, field] of Object.entries(LYRIC_DISPLAY_FIELDS)) {
        const input = document.getElementById(key);
        if (input) input.checked = String(settings[key] ?? field.default) !== 'false';
      }
    }
    const karaokeMode = ['off', 'continuous', 'discrete'].includes(settings.desktopLyricKaraokeMode)
      ? settings.desktopLyricKaraokeMode
      : settings.desktopLyricKaraokeEnabled === 'false'
        ? 'off'
        : 'continuous';
    Object.entries(DESKTOP_LYRIC_DEFAULTS).forEach(([key, fallback]) => {
      const nextValue = settings[key] ?? fallback;
      if (key === 'desktopLyricTextAlign') {
        const textAlign = ['left', 'center', 'right', 'justify'].includes(nextValue) ? nextValue : fallback;
        document.querySelectorAll('input[name="desktopLyricTextAlign"]').forEach((input) => {
          input.checked = input.value === textAlign;
        });
        return;
      }
      if (key === 'desktopLyricKaraokeMode') {
        document.querySelectorAll('input[name="desktopLyricKaraokeMode"]').forEach((input) => {
          input.checked = input.value === karaokeMode;
        });
        return;
      }
      const input = document.getElementById(key);
      if (key === 'desktopLyricKaraokeEnabled') {
        if (input) input.checked = karaokeMode !== 'off';
        return;
      }
      if (CHECKBOX_KEYS.has(key)) {
        if (input) input.checked = nextValue !== 'false';
        return;
      }
      if (key === 'desktopLyricFontFamily') {
        ensureSavedFontOption(document.getElementById('desktopLyricFontFamily'), nextValue);
      }
      setValue(key, nextValue);
      const rangePair = RANGE_PAIRS.find(([rangeKey]) => rangeKey === key);
      if (rangePair) {
        const displayValue = Number(nextValue) * (rangePair[4] || 1);
        setValue(`${key}Number`, String(Number(displayValue.toFixed(6))));
      }
    });
    forms.refreshParameterRanges?.();
    syncDesktopLyricKaraokeColorControls(settings);
    syncParameterLayout();
    preview.applySettings({ ...settings, ...collectDesktopLyric() });
    syncEditorMode();
  }

  function loadWeSingLyricSettings(settings) {
    if (!settings) return;

    const selectedSource = settings.weSingLyricSource === 'qq' ? 'qq' : 'netease';
    document.querySelectorAll('input[name="weSingLyricSource"]').forEach((input) => {
      input.checked = input.value === selectedSource;
    });
    const smartLyricMatch = document.getElementById('weSingSmartLyricMatch');
    if (smartLyricMatch) smartLyricMatch.checked = settings.weSingSmartLyricMatch !== 'false';
  }

  return {
    initDesktopLyricForm,
    collectDesktopLyric,
    loadDesktopLyricSettings,
  };
}
export const desktopLyric = createDesktopLyric();
