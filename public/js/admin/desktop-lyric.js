// 编写人：Aurora
// 桌面歌词设置
'use strict';

(function () {
  const AUTOSAVE_DELAY_MS = 500;
  const {
    value,
    setValue,
    api
  } = window.AdminApp.utils;

  function initDesktopLyricForm() {
    const form = document.getElementById('desktopLyricForm');
    if (!form) return;
    window.AdminApp.desktopLyricPreview?.init(form);

    // Range ↔ Number 双向绑定
    if (window.AdminApp.forms && window.AdminApp.forms.bindRangePair) {
      const { bindRangePair } = window.AdminApp.forms;
      bindRangePair('desktopLyricFontSize', 'desktopLyricFontSizeNumber', 24, 72, 36);
      bindRangePair('desktopLyricStrokeWidth', 'desktopLyricStrokeWidthNumber', 0, 5, 2);
      bindRangePair('desktopLyricOpacity', 'desktopLyricOpacityNumber', 0, 1, 1);
      bindRangePair('desktopLyricBgOpacity', 'desktopLyricBgOpacityNumber', 0, 1, 0);
      bindRangePair('desktopLyricScale', 'desktopLyricScaleNumber', 0.5, 2, 1);
      bindRangePair('desktopLyricLineHeight', 'desktopLyricLineHeightNumber', 1, 2, 1.3);
      bindRangePair('desktopLyricShadowIntensity', 'desktopLyricShadowIntensityNumber', 0, 1, 0.5);
      bindRangePair('desktopLyricTranslationScale', 'desktopLyricTranslationScaleNumber', 0.4, 1, 0.58);
    }

    const autosaveState = document.getElementById('desktopLyricAutosaveState');
    let autosaveTimer = null;
    let dirty = false;
    let saving = false;
    let pendingSave = false;
    let settingsLoaded = Boolean(window.AdminApp.state?.getAppState?.()?.settings);

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

    window.addEventListener('app:settings-state', () => {
      if (settingsLoaded) return;
      settingsLoaded = true;
      if (!dirty) return;
      setAutosaveState('等待自动保存…', 'is-saving');
      autosaveTimer = setTimeout(() => void saveDesktopLyric(), AUTOSAVE_DELAY_MS);
    });

    form.addEventListener('input', () => scheduleAutosave());
    form.addEventListener('change', () => scheduleAutosave(true));
  }

  function collectDesktopLyric() {
    return {
      desktopLyricFontFamily: value('desktopLyricFontFamily'),
      desktopLyricFontWeight: value('desktopLyricFontWeight'),
      desktopLyricTextColor: value('desktopLyricTextColor'),
      desktopLyricStrokeColor: value('desktopLyricStrokeColor'),
      desktopLyricFontSize: value('desktopLyricFontSize'),
      desktopLyricStrokeWidth: value('desktopLyricStrokeWidth'),
      desktopLyricOpacity: value('desktopLyricOpacity'),
      desktopLyricBgOpacity: value('desktopLyricBgOpacity'),
      desktopLyricScale: value('desktopLyricScale'),
      desktopLyricLineHeight: value('desktopLyricLineHeight'),
      desktopLyricShadowIntensity: value('desktopLyricShadowIntensity'),
      desktopLyricTranslationScale: value('desktopLyricTranslationScale')
    };
  }

  function loadDesktopLyricSettings(settings) {
    if (!settings) return;

    setValue('desktopLyricFontFamily', settings.desktopLyricFontFamily || 'Microsoft YaHei');
    setValue('desktopLyricFontWeight', settings.desktopLyricFontWeight || '700');
    setValue('desktopLyricTextColor', settings.desktopLyricTextColor || '#ffffff');
    setValue('desktopLyricStrokeColor', settings.desktopLyricStrokeColor || '#000000');
    setValue('desktopLyricFontSize', settings.desktopLyricFontSize || '36');
    setValue('desktopLyricFontSizeNumber', settings.desktopLyricFontSize || '36');
    setValue('desktopLyricStrokeWidth', settings.desktopLyricStrokeWidth || '2');
    setValue('desktopLyricStrokeWidthNumber', settings.desktopLyricStrokeWidth || '2');
    setValue('desktopLyricOpacity', settings.desktopLyricOpacity || '1');
    setValue('desktopLyricOpacityNumber', settings.desktopLyricOpacity || '1');
    setValue('desktopLyricBgOpacity', settings.desktopLyricBgOpacity || '0');
    setValue('desktopLyricBgOpacityNumber', settings.desktopLyricBgOpacity || '0');
    setValue('desktopLyricScale', settings.desktopLyricScale || '1');
    setValue('desktopLyricScaleNumber', settings.desktopLyricScale || '1');
    setValue('desktopLyricLineHeight', settings.desktopLyricLineHeight || '1.3');
    setValue('desktopLyricLineHeightNumber', settings.desktopLyricLineHeight || '1.3');
    setValue('desktopLyricShadowIntensity', settings.desktopLyricShadowIntensity || '0.5');
    setValue('desktopLyricShadowIntensityNumber', settings.desktopLyricShadowIntensity || '0.5');
    setValue('desktopLyricTranslationScale', settings.desktopLyricTranslationScale || '0.58');
    setValue('desktopLyricTranslationScaleNumber', settings.desktopLyricTranslationScale || '0.58');
    window.AdminApp.desktopLyricPreview?.applySettings(settings);
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.desktopLyric = {
    initDesktopLyricForm,
    collectDesktopLyric,
    loadDesktopLyricSettings
  };
})();
