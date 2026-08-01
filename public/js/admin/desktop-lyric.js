// 编写人：Aurora
// 桌面歌词设置
'use strict';

(function () {
  const {
    value,
    setValue,
    toast,
    api
  } = window.AdminApp.utils;

  function initDesktopLyricForm() {
    const form = document.getElementById('desktopLyricForm');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await api('/api/settings', collectDesktopLyric());
      toast('桌面歌词设置已保存');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

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
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.desktopLyric = {
    initDesktopLyricForm,
    collectDesktopLyric,
    loadDesktopLyricSettings
  };
})();
