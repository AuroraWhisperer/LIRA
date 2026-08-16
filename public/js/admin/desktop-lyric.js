// 编写人：Aurora
// 桌面歌词设置
'use strict';

(function () {
  const AUTOSAVE_DELAY_MS = 500;
  const {
    setValue,
    api
  } = window.AdminApp.utils;
  const DESKTOP_LYRIC_DEFAULTS = Object.freeze({
    desktopLyricFontFamily: 'Microsoft YaHei',
    desktopLyricFallbackFontFamily: 'Microsoft JhengHei',
    desktopLyricFontWeight: '800',
    desktopLyricTextColor: '#000000',
    desktopLyricTextAlign: 'left',
    desktopLyricLetterSpacing: '0',
    desktopLyricFontSize: '56',
    desktopLyricLineHeight: '1.4',
    desktopLyricStrokeEnabled: 'true',
    desktopLyricStrokeColor: '#ffffff',
    desktopLyricStrokeWidth: '3',
    desktopLyricShadowEnabled: 'true',
    desktopLyricShadowColor: '#000000',
    desktopLyricShadowIntensity: '0.35',
    desktopLyricShadowBlur: '8',
    desktopLyricShadowOffsetX: '0',
    desktopLyricShadowOffsetY: '3',
    desktopLyricShowTranslation: 'true',
    desktopLyricTranslationScale: '0.65',
    desktopLyricKaraokeEnabled: 'true',
    desktopLyricHidePassedLines: 'false',
    desktopLyricTraditionalMode: 'false',
    desktopLyricInterludeOffsetEm: '0',
    desktopLyricHideOnPause: 'false',
    desktopLyricCurrentLineEnhanced: 'true',
    desktopLyricOpacity: '0.95',
    desktopLyricBaseOpacity: '0.38',
    desktopLyricTranslationOpacity: '0.72',
    desktopLyricTimeOffsetMs: '0',
    desktopLyricShowTitleWhenNoLyric: 'false',
    desktopLyricNoLyricText: '纯音乐，请欣赏',
    desktopLyricSpringAnimation: 'true',
    desktopLyricBlurEffect: 'true',
    desktopLyricScaleEffect: 'true',
    desktopLyricScale: '1',
    desktopLyricAlignPosition: '0.5',
    desktopLyricAlignAnchor: 'center',
    desktopLyricTranslateX: '0',
    desktopLyricTranslateY: '0',
    desktopLyricPerspective: '800',
    desktopLyricRotateX: '0',
    desktopLyricRotateY: '0',
    desktopLyricBackgroundEnabled: 'false',
    desktopLyricBackgroundRenderer: 'mesh',
    desktopLyricBgOpacity: '0.15',
    desktopLyricGlobalOpacity: '1',
    desktopLyricBrightness: '1',
    desktopLyricContrast: '1',
    desktopLyricSaturation: '1'
  });
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
    'desktopLyricBackgroundEnabled'
  ]);
  const RANGE_PAIRS = [
    ['desktopLyricFontSize', 24, 72, 56],
    ['desktopLyricLetterSpacing', -0.1, 0.3, 0],
    ['desktopLyricLineHeight', 1, 2, 1.4],
    ['desktopLyricStrokeWidth', 0, 6, 3],
    ['desktopLyricShadowIntensity', 0, 1, 0.35],
    ['desktopLyricShadowBlur', 0, 30, 8],
    ['desktopLyricShadowOffsetX', -20, 20, 0],
    ['desktopLyricShadowOffsetY', -20, 20, 3],
    ['desktopLyricTranslationScale', 0.4, 1, 0.65],
    ['desktopLyricInterludeOffsetEm', -10, 10, 0],
    ['desktopLyricOpacity', 0, 1, 0.95],
    ['desktopLyricBaseOpacity', 0, 1, 0.38],
    ['desktopLyricTranslationOpacity', 0, 1, 0.72],
    ['desktopLyricTimeOffsetMs', -5000, 5000, 0],
    ['desktopLyricScale', 0.5, 2, 1],
    ['desktopLyricAlignPosition', 0, 1, 0.5],
    ['desktopLyricTranslateX', -500, 500, 0],
    ['desktopLyricTranslateY', -500, 500, 0],
    ['desktopLyricPerspective', 200, 2000, 800],
    ['desktopLyricRotateX', -45, 45, 0],
    ['desktopLyricRotateY', -45, 45, 0],
    ['desktopLyricBgOpacity', 0, 1, 0.15],
    ['desktopLyricGlobalOpacity', 0, 1, 1],
    ['desktopLyricBrightness', 0.2, 2, 1],
    ['desktopLyricContrast', 0.2, 2, 1],
    ['desktopLyricSaturation', 0, 2, 1]
  ];

  function initDesktopLyricForm() {
    const form = document.getElementById('desktopLyricForm');
    if (!form) return;
    window.AdminApp.desktopLyricPreview?.init(form);

    // Range ↔ Number 双向绑定
    if (window.AdminApp.forms && window.AdminApp.forms.bindRangePair) {
      const { bindRangePair } = window.AdminApp.forms;
      RANGE_PAIRS.forEach(([key, minimum, maximum, fallback]) => {
        bindRangePair(key, `${key}Number`, minimum, maximum, fallback);
      });
    }

    const autosaveState = document.getElementById('desktopLyricAutosaveState');
    let autosaveTimer = null;
    let dirty = false;
    let saving = false;
    let pendingSave = false;
    const currentSettings = window.AdminApp.state?.getAppState?.()?.settings;
    let settingsLoaded = Boolean(currentSettings);
    if (currentSettings) loadDesktopLyricSettings(currentSettings);

    const setAutosaveState = (text, state = '') => {
      if (!autosaveState) return;
      autosaveState.textContent = text;
      autosaveState.className = `desktop-lyric-autosave-state${state ? ` ${state}` : ''}`;
    };

    const saveDesktopLyric = async () => {
      if (!dirty || !settingsLoaded) return;
      if (saving) {
        pendingSave = true;
        return;
      }

      saving = true;
      dirty = false;
      setAutosaveState('正在自动保存…', 'is-saving');
      try {
        await api('/api/settings', collectDesktopLyric());
        if (!dirty) setAutosaveState('已自动保存', 'is-saved');
      } catch (_) {
        dirty = true;
        setAutosaveState('自动保存失败，请重试', 'is-error');
      } finally {
        saving = false;
        if (pendingSave) {
          pendingSave = false;
          void saveDesktopLyric();
        }
      }
    };

    const scheduleAutosave = (immediate = false) => {
      dirty = true;
      clearTimeout(autosaveTimer);
      if (!settingsLoaded) {
        setAutosaveState('正在读取设置…', 'is-saving');
        return;
      }
      setAutosaveState(immediate ? '正在自动保存…' : '等待自动保存…', 'is-saving');
      if (immediate) void saveDesktopLyric();
      else autosaveTimer = setTimeout(() => void saveDesktopLyric(), AUTOSAVE_DELAY_MS);
    };

    window.addEventListener('app:settings-state', (event) => {
      loadWeSingLyricSettings(event.detail);
      if (!settingsLoaded) {
        settingsLoaded = true;
        loadDesktopLyricSettings(event.detail);
      } else if (!dirty && !saving) {
        loadDesktopLyricSettings(event.detail);
      }
      if (!dirty) return;
      setAutosaveState('等待自动保存…', 'is-saving');
      autosaveTimer = setTimeout(() => void saveDesktopLyric(), AUTOSAVE_DELAY_MS);
    });

    form.addEventListener('input', () => scheduleAutosave());
    form.addEventListener('change', () => scheduleAutosave(true));
    document.getElementById('desktopLyricResetBtn')?.addEventListener('click', () => {
      loadDesktopLyricSettings(DESKTOP_LYRIC_DEFAULTS, { includeWeSing: false });
      scheduleAutosave(true);
    });
  }

  function selectedWeSingLyricSource() {
    return document.querySelector('input[name="weSingLyricSource"]:checked')?.value || 'netease';
  }

  function checkedValue(id) {
    return document.getElementById(id)?.checked ? 'true' : 'false';
  }

  function collectDesktopLyric() {
    const settings = {
      weSingLyricSource: selectedWeSingLyricSource(),
      weSingSmartLyricMatch: checkedValue('weSingSmartLyricMatch')
    };
    Object.entries(DESKTOP_LYRIC_DEFAULTS).forEach(([key, fallback]) => {
      const input = document.getElementById(key);
      settings[key] = input
        ? CHECKBOX_KEYS.has(key) ? String(input.checked) : input.value
        : fallback;
    });
    return settings;
  }

  function loadDesktopLyricSettings(settings, options = {}) {
    if (!settings) return;

    if (options.includeWeSing !== false) loadWeSingLyricSettings(settings);
    Object.entries(DESKTOP_LYRIC_DEFAULTS).forEach(([key, fallback]) => {
      const nextValue = settings[key] ?? fallback;
      const input = document.getElementById(key);
      if (CHECKBOX_KEYS.has(key)) {
        if (input) input.checked = nextValue !== 'false';
        return;
      }
      setValue(key, nextValue);
      if (RANGE_PAIRS.some(([rangeKey]) => rangeKey === key)) {
        setValue(`${key}Number`, nextValue);
      }
    });
    window.AdminApp.forms?.refreshParameterRanges?.();
    window.AdminApp.desktopLyricPreview?.applySettings({ ...DESKTOP_LYRIC_DEFAULTS, ...settings });
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

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.desktopLyric = {
    initDesktopLyricForm,
    collectDesktopLyric,
    loadDesktopLyricSettings
  };
})();
