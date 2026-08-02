// 编写人：Aurora
// 点歌板主题配置
'use strict';

(function () {
  const {
    value,
    setValue,
    toast,
    api,
    debounce
  } = window.AdminApp.utils;

  const {
    defaultThemeLook,
    classicThemePresets,
    classicPresetLabels,
    classicPresetSwatches
  } = window.AdminApp.theme;

  function initThemeForm() {
    document.getElementById('themeForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api('/api/settings', collectTheme());
      toast('点歌板主题已保存');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

    document.getElementById('classicPresets').addEventListener('click', (event) => {
      const card = event.target.closest('[data-theme]');
      if (!card) return;
      if (value('overlayQueueStyle') !== 'classic') return;
      const preset = classicThemePresets[card.dataset.theme];
      if (!preset) return;
      if (window.AdminApp.forms && window.AdminApp.forms.fillForm) {
        window.AdminApp.forms.fillForm(preset);
      }
      syncAllRangeInputs(preset);
      toast(`已套用「${classicPresetLabels[card.dataset.theme]}」主题预设，保存后生效`);
      renderPresetCards('classicPresets', classicThemePresets, classicPresetLabels, classicPresetSwatches);
    });

    document.getElementById('quickBeautifyBtn').addEventListener('click', () => {
      const beautified = {
        backdropBlur: '20',
        glowIntensity: '4',
        overlayLowPowerMode: 'false',
        enableGradient: 'true',
        gradientEnd: value('gradientEnd') || '#2a1a2e',
        themeOpacity: '0.30',
        themeRadius: '14'
      };
      if (window.AdminApp.forms && window.AdminApp.forms.fillForm) {
        window.AdminApp.forms.fillForm(beautified);
      }
      syncAllRangeInputs(beautified);
      toast('✨ 一键美化已应用！保存后生效');
    });

    document.querySelectorAll('[data-overlay-style]').forEach((button) => {
      button.addEventListener('click', async () => {
        const nextStyle = button.dataset.overlayStyle;
        setOverlayStyle(nextStyle);
        const response = await api('/api/settings', { overlayQueueStyle: nextStyle });
        if (response.data && response.data.settings && response.data.settings.overlayQueueStyle !== nextStyle) {
          toast('请先重启程序，再切换点歌板样式');
          if (window.AdminApp.state && window.AdminApp.state.reloadState) {
            await window.AdminApp.state.reloadState();
          }
          return;
        }
        toast('点歌板样式已切换');
        if (window.AdminApp.state && window.AdminApp.state.reloadState) {
          await window.AdminApp.state.reloadState();
        }
      });
    });

    const autosaveTheme = debounce(async () => {
      await api('/api/settings', collectTheme());
    }, 180);
    document.getElementById('overlayFontFamily').addEventListener('change', () => {
      if (window.AdminApp.queue && window.AdminApp.queue.applyAdminQueueFontPreview) {
        window.AdminApp.queue.applyAdminQueueFontPreview();
      }
      autosaveTheme();
    });
    document.getElementById('overlayFontWeight').addEventListener('change', () => {
      if (window.AdminApp.queue && window.AdminApp.queue.applyAdminQueueFontPreview) {
        window.AdminApp.queue.applyAdminQueueFontPreview();
      }
      autosaveTheme();
    });

    document.getElementById('resetClassicTheme').addEventListener('click', async () => {
      const resetValues = {
        ...defaultThemeLook,
        themeOpacity: '0.48',
        themeRadius: '12',
        backdropBlur: '14',
        glowIntensity: '2'
      };
      if (window.AdminApp.forms && window.AdminApp.forms.fillForm) {
        window.AdminApp.forms.fillForm(resetValues);
      }
      syncAllRangeInputs(resetValues);
      await api('/api/settings', resetValues);
      toast('已恢复风格1默认设置');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

    // range ↔ number pairs
    if (window.AdminApp.forms && window.AdminApp.forms.bindRangePair) {
      const { bindRangePair } = window.AdminApp.forms;
      bindRangePair('themeOpacity', 'themeOpacityNumber', 0, 1, 0.48);
      bindRangePair('songBoardFontSize', 'songBoardFontSizeNumber', 8, 80, 16);
      bindRangePair('queueSongFontSize', 'queueSongFontSizeNumber', 10, 70, 40);
      bindRangePair('queueTitleFontSize', 'queueTitleFontSizeNumber', 10, 40, 30);
      bindRangePair('overlayRuleFontSize', 'overlayRuleFontSizeNumber', 8, 18, 10);
      bindRangePair('identityQueueScrollSpeedRange', 'identityQueueScrollSpeed', 1, 100, 80);
      bindRangePair('backdropBlur', 'backdropBlurNumber', 0, 30, 14);
      bindRangePair('glowIntensity', 'glowIntensityNumber', 0, 20, 2);
    }

    document.getElementById('queueScrollSpeedRange').addEventListener('input', () => {
      setValue('queueScrollSpeed', value('queueScrollSpeedRange'));
    });
    document.getElementById('queueScrollSpeed').addEventListener('input', () => {
      if (window.AdminApp.forms && window.AdminApp.forms.normalizeQueueScrollSpeedForDisplay) {
        setValue('queueScrollSpeedRange', window.AdminApp.forms.normalizeQueueScrollSpeedForDisplay(value('queueScrollSpeed')));
      }
    });
  }

  function collectTheme() {
    return {
      overlayQueueStyle: value('overlayQueueStyle'),
      songBoardFontSize: value('songBoardFontSize'),
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
      queueFixedSixRows: value('queueFixedSixRows'),
      queueScrollMode: value('queueScrollMode'),
      queueScrollSpeed: window.AdminApp.forms.normalizeQueueScrollSpeedForDisplay(value('queueScrollSpeed')),
      identityQueueScrollSpeed: window.AdminApp.forms.normalizeQueueScrollSpeedForDisplay(value('identityQueueScrollSpeed'))
    };
  }

  function syncAllRangeInputs(values) {
    const v = values || {};
    setValue('backdropBlurNumber', v.backdropBlur || value('backdropBlur'));
    setValue('glowIntensityNumber', v.glowIntensity || value('glowIntensity'));
    setValue('themeOpacityNumber', v.themeOpacity || value('themeOpacity'));
    setValue('songBoardFontSizeNumber', v.songBoardFontSize || value('songBoardFontSize'));
    setValue('queueSongFontSizeNumber', v.queueSongFontSize || value('queueSongFontSize'));
    setValue('queueTitleFontSizeNumber', v.queueTitleFontSize || value('queueTitleFontSize'));
    setValue('overlayRuleFontSizeNumber', v.overlayRuleFontSize || value('overlayRuleFontSize'));
    if (window.AdminApp.forms && window.AdminApp.forms.normalizeQueueScrollSpeedForDisplay) {
      const queueScrollSpeed = window.AdminApp.forms.normalizeQueueScrollSpeedForDisplay(v.queueScrollSpeed || value('queueScrollSpeed'));
      setValue('queueScrollSpeed', queueScrollSpeed);
      setValue('queueScrollSpeedRange', queueScrollSpeed);
      const identityScrollSpeed = window.AdminApp.forms.normalizeQueueScrollSpeedForDisplay(
        v.identityQueueScrollSpeed || value('identityQueueScrollSpeed')
      );
      setValue('identityQueueScrollSpeed', identityScrollSpeed);
      setValue('identityQueueScrollSpeedRange', identityScrollSpeed);
    }
    setValue('scrollSecondsRange', v.scrollSeconds || value('scrollSeconds'));
  }

  function setOverlayStyle(style) {
    const nextStyle = (style === 'identity' || style === 'festival') ? 'identity' : 'classic';
    setValue('overlayQueueStyle', nextStyle);
    document.querySelectorAll('[data-overlay-style]').forEach((button) => {
      button.classList.toggle('active', button.dataset.overlayStyle === nextStyle);
    });
    const classicArea = document.getElementById('classicThemeArea');
    const identityArea = document.getElementById('identityThemeArea');
    if (nextStyle === 'identity') {
      if (classicArea) classicArea.hidden = true;
      if (identityArea) identityArea.hidden = false;
    } else {
      if (classicArea) classicArea.hidden = false;
      if (identityArea) identityArea.hidden = true;
      renderPresetCards('classicPresets', classicThemePresets, classicPresetLabels, classicPresetSwatches);
    }
  }

  function renderPresetCards(containerId, presets, labels, swatches) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = Object.entries(presets).map(([key]) => {
      const sw = swatches[key] || ['#181823', '#ccc', '#ccc', '#fff'];
      const label = labels[key] || key;
      return `
        <div class="preset-card" data-theme="${key}">
          <div class="swatch-preview">
            <span style="background:${sw[0]}"></span>
            <span style="background:${sw[1]}"></span>
            <span style="background:${sw[2]}"></span>
            <span style="background:${sw[3]}"></span>
          </div>
          <strong>${label}</strong>
        </div>
      `;
    }).join('');
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.theme = window.AdminApp.theme || {};
  Object.assign(window.AdminApp.theme, {
    initThemeForm,
    collectTheme,
    syncAllRangeInputs,
    setOverlayStyle,
    renderPresetCards
  });
})();
