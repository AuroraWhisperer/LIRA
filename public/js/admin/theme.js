import { value, setValue, toast, api, debounce } from '../shared/utils.js';
import { theme as sharedTheme } from '../shared/theme.js';
import { formsService } from './forms.js';
import { stateService } from './state.js';
import { applyAdminQueueFontPreview } from './queue.js';
import { setOverlayStyle } from './theme-style-view.js';
import { publishTheme } from './legacy-admin-bridge.js';
// 编写人：Aurora
// 点歌板主题配置
('use strict');

import { renderPresetCards } from './theme-preset-cards.js';
import { registerLocalFontSelect } from './local-font-library.js';
import { normalizePersistedQueueStyle, queueStyleSettingsPayload } from '../shared/queue-style-settings.js';

export const theme = (() => {
  const { defaultThemeLook, classicThemePresets, classicPresetLabels, classicPresetSwatches } = sharedTheme;

  function initThemeForm() {
    const themeForm = document.getElementById('themeForm');
    registerLocalFontSelect(document.getElementById('illustratedQueueFontFamily'));
    const saveTheme = async () => {
      await api('/api/settings', collectTheme());
    };
    const autosaveTheme = debounce(async (styleAtEdit) => {
      if (normalizePersistedQueueStyle(value('overlayQueueStyle')) !== styleAtEdit) return;
      try {
        await saveTheme();
      } catch (_) {
        // api() already shows the save error to the user.
      }
    }, 180);
    const scheduleThemeAutosave = () => {
      autosaveTheme(normalizePersistedQueueStyle(value('overlayQueueStyle')));
    };

    themeForm.addEventListener('input', scheduleThemeAutosave);
    themeForm.addEventListener('change', scheduleThemeAutosave);
    themeForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveTheme();
      toast('点歌板主题已保存');
      if (stateService && stateService.reloadState) {
        await stateService.reloadState();
      }
    });

    document.getElementById('classicPresets').addEventListener('click', async (event) => {
      const card = event.target.closest('[data-theme]');
      if (!card) return;
      if (value('overlayQueueStyle') !== 'classic') return;
      const preset = classicThemePresets[card.dataset.theme];
      if (!preset) return;
      if (formsService && formsService.fillForm) {
        formsService.fillForm(preset);
      }
      syncAllRangeInputs(preset);
      await saveTheme();
      toast(`已套用「${classicPresetLabels[card.dataset.theme]}」主题预设`);
      renderPresetCards('classicPresets', classicThemePresets, classicPresetLabels, classicPresetSwatches);
    });

    document.getElementById('quickBeautifyBtn').addEventListener('click', async () => {
      const beautified = {
        backdropBlur: '20',
        glowIntensity: '4',
        overlayLowPowerMode: 'false',
        enableGradient: 'true',
        gradientEnd: value('gradientEnd') || '#2a1a2e',
        themeOpacity: '0.30',
        themeRadius: '14',
      };
      if (formsService && formsService.fillForm) {
        formsService.fillForm(beautified);
      }
      syncAllRangeInputs(beautified);
      await saveTheme();
      toast('✨ 一键美化已应用');
    });

    document.querySelectorAll('[data-overlay-style]').forEach((button) => {
      button.addEventListener('click', async () => {
        const currentStyle = normalizePersistedQueueStyle(value('overlayQueueStyle'));
        const nextStyle = normalizePersistedQueueStyle(button.dataset.overlayStyle);
        if (currentStyle !== nextStyle) await saveTheme();
        setOverlayStyle(nextStyle);
        const response = await api('/api/settings', {
          overlayQueueStyle: nextStyle,
        });
        if (response.data && response.data.settings && response.data.settings.overlayQueueStyle !== nextStyle) {
          toast('请先重启程序，再切换点歌板样式');
          if (stateService && stateService.reloadState) {
            await stateService.reloadState();
          }
          return;
        }
        toast('点歌板样式已切换');
        if (stateService && stateService.reloadState) {
          await stateService.reloadState();
        }
      });
    });

    document.getElementById('overlayFontFamily').addEventListener('change', () => {
      if (applyAdminQueueFontPreview) {
        applyAdminQueueFontPreview();
      }
    });
    document.getElementById('overlayFontWeight').addEventListener('change', () => {
      if (applyAdminQueueFontPreview) {
        applyAdminQueueFontPreview();
      }
    });

    document.getElementById('resetClassicTheme').addEventListener('click', async () => {
      if (!Object.keys(defaultThemeLook).length) {
        toast('默认主题配置加载失败，请重启后重试');
        return;
      }
      const resetValues = { ...defaultThemeLook };
      if (formsService && formsService.fillForm) {
        formsService.fillForm(resetValues);
      }
      syncAllRangeInputs(resetValues);
      await saveTheme();
      toast('已恢复风格1默认设置');
      if (stateService && stateService.reloadState) {
        await stateService.reloadState();
      }
    });

    // range ↔ number pairs
    if (formsService && formsService.bindRangePair) {
      const bindRangePair = formsService.bindRangePair.bind(formsService);
      bindRangePair('themeOpacity', 'themeOpacityNumber', 0, 1, 0.48, 100);
      bindRangePair('queueSongFontSize', 'queueSongFontSizeNumber', 10, 70, 28);
      bindRangePair('queueTitleFontSize', 'queueTitleFontSizeNumber', 10, 40, 30);
      bindRangePair('identityQueueFontSize', 'identityQueueFontSizeNumber', 9, 78, 28);
      bindRangePair('overlayRuleFontSize', 'overlayRuleFontSizeNumber', 8, 18, 10);
      bindRangePair('identityQueueScrollSpeedRange', 'identityQueueScrollSpeed', 1, 100, 80);
      bindRangePair('backdropBlur', 'backdropBlurNumber', 0, 30, 14);
      bindRangePair('glowIntensity', 'glowIntensityNumber', 0, 20, 2);
    }

    document.getElementById('queueScrollSpeedRange').addEventListener('input', () => {
      setValue('queueScrollSpeed', value('queueScrollSpeedRange'));
    });
    document.getElementById('queueScrollSpeed').addEventListener('input', () => {
      if (formsService && formsService.normalizeQueueScrollSpeedForDisplay) {
        setValue('queueScrollSpeedRange', formsService.normalizeQueueScrollSpeedForDisplay(value('queueScrollSpeed')));
        formsService.refreshParameterRanges?.(document.getElementById('queueScrollSpeedRange'));
      }
    });
  }

  function collectTheme() {
    const style = normalizePersistedQueueStyle(value('overlayQueueStyle'));
    const payload = { overlayQueueStyle: style };
    if (style === 'classic') {
      return {
        ...payload,
        themePrimary: value('themePrimary'),
        themeAccent: value('themeAccent'),
        themeText: value('themeText'),
        themeBackground: value('themeBackground'),
        themeOpacity: value('themeOpacity'),
        themeRadius: value('themeRadius'),
        queueSongFontSize: value('queueSongFontSize'),
        queueTitleFontSize: value('queueTitleFontSize'),
        backdropBlur: value('backdropBlur'),
        glowIntensity: value('glowIntensity'),
        overlayLowPowerMode: value('overlayLowPowerMode'),
        enableGradient: value('enableGradient'),
        gradientEnd: value('gradientEnd'),
        overlayFontFamily: value('overlayFontFamily'),
        overlayFontWeight: value('overlayFontWeight'),
        overlaySongColor: value('overlaySongColor'),
        overlayRequesterColor: value('overlayRequesterColor'),
        overlayTitle: value('overlayTitle'),
        overlayShowIndex: value('overlayShowIndex'),
        overlayIndexThreshold: value('overlayIndexThreshold'),
        overlayIndexColor: value('overlayIndexColor'),
        ...queueStyleSettingsPayload(style, {
          scrollMode: value('queueScrollMode'),
          scrollSpeed: formsService.normalizeQueueScrollSpeedForDisplay(value('queueScrollSpeed')),
        }),
      };
    }

    Object.assign(
      payload,
      queueStyleSettingsPayload(style, {
        fontSize: value('identityQueueFontSize'),
        fontFamily: value('illustratedQueueFontFamily'),
        fontWeight: value('illustratedQueueFontWeight'),
        useCustomTextColor: value('illustratedQueueUseCustomTextColor'),
        textColor: value('illustratedQueueTextColor'),
        scrollMode: value('identityQueueScrollMode'),
        scrollSpeed: formsService.normalizeQueueScrollSpeedForDisplay(value('identityQueueScrollSpeed')),
      }),
    );

    if (style === 'identity')
      Object.assign(payload, {
        overlayPin1: value('overlayPin1'),
        overlayPin2: value('overlayPin2'),
        overlayPin3: value('overlayPin3'),
        overlayRule1: value('overlayRule1'),
        overlayRule2: value('overlayRule2'),
        overlayRule3: value('overlayRule3'),
        overlayRule4: value('overlayRule4'),
        overlayRule5: value('overlayRule5'),
        overlayRule6: value('overlayRule6'),
        overlayRuleColor1: value('overlayRuleColor1'),
        overlayRuleColor2: value('overlayRuleColor2'),
        overlayRuleColor3: value('overlayRuleColor3'),
        overlayRuleColor4: value('overlayRuleColor4'),
        overlayRuleColor5: value('overlayRuleColor5'),
        overlayRuleColor6: value('overlayRuleColor6'),
        overlayRuleFontSize: value('overlayRuleFontSize'),
      });
    return payload;
  }

  function syncAllRangeInputs(values) {
    const v = values || {};
    setValue('backdropBlurNumber', v.backdropBlur || value('backdropBlur'));
    setValue('glowIntensityNumber', v.glowIntensity || value('glowIntensity'));
    setValue('themeOpacityNumber', Math.round(Number(v.themeOpacity ?? value('themeOpacity')) * 100));
    setValue('queueSongFontSizeNumber', v.queueSongFontSize || value('queueSongFontSize'));
    setValue('queueTitleFontSizeNumber', v.queueTitleFontSize || value('queueTitleFontSize'));
    setValue('identityQueueFontSizeNumber', v.identityQueueFontSize || value('identityQueueFontSize'));
    setValue('overlayRuleFontSizeNumber', v.overlayRuleFontSize || value('overlayRuleFontSize'));
    if (formsService && formsService.normalizeQueueScrollSpeedForDisplay) {
      const queueScrollSpeed = formsService.normalizeQueueScrollSpeedForDisplay(
        v.queueScrollSpeed || value('queueScrollSpeed'),
      );
      setValue('queueScrollSpeed', queueScrollSpeed);
      setValue('queueScrollSpeedRange', queueScrollSpeed);
      const identityScrollSpeed = formsService.normalizeQueueScrollSpeedForDisplay(
        v.identityQueueScrollSpeed || value('identityQueueScrollSpeed'),
      );
      setValue('identityQueueScrollSpeed', identityScrollSpeed);
      setValue('identityQueueScrollSpeedRange', identityScrollSpeed);
    }
    if (formsService && formsService.normalizeSongScrollSpeedForDisplay) {
      const songScrollSpeed = formsService.normalizeSongScrollSpeedForDisplay(
        v.scrollSeconds || value('scrollSeconds'),
      );
      setValue('scrollSeconds', songScrollSpeed);
      setValue('scrollSecondsRange', songScrollSpeed);
    }
    formsService?.refreshParameterRanges?.();
  }

  return {
    initThemeForm,
    collectTheme,
    syncAllRangeInputs,
    setOverlayStyle,
    renderPresetCards,
  };
})();

publishTheme(theme);
