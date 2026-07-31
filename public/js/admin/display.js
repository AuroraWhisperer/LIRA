// 编写人：Aurora
// 展示板配置
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
    songBoardThemePresets,
    songBoardPresetLabels,
    songBoardPresetSwatches
  } = window.AdminApp.theme;

  function initDisplayForm() {
    document.getElementById('displayForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api('/api/settings', collectDisplay());
      toast('展示板已保存');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

    const autosaveDisplay = debounce(async () => {
      await api('/api/settings', collectDisplay());
    }, 180);
    document.getElementById('scrollSecondsRange').addEventListener('input', () => {
      setValue('scrollSeconds', value('scrollSecondsRange'));
      autosaveDisplay();
    });
    document.getElementById('scrollSeconds').addEventListener('input', () => {
      const { normalizeRangeValue } = window.AdminApp.utils;
      setValue('scrollSecondsRange', String(Math.round(Number(normalizeRangeValue(value('scrollSeconds'), 1, 200, 20)))));
      autosaveDisplay();
    });

    // Song board sync toggle
    const songBoardSync = document.getElementById('songBoardSyncTheme');
    const songBoardArea = document.getElementById('songBoardThemeArea');
    songBoardSync.addEventListener('change', () => {
      songBoardArea.hidden = songBoardSync.checked;
      if (!songBoardSync.checked) {
        const appState = window.AdminApp.state.getAppState();
        if (appState) {
          const s = appState.settings || {};
          setValue('songBoardThemePrimary', s.songBoardThemePrimary || s.themePrimary || '#ff6f91');
          setValue('songBoardThemeAccent', s.songBoardThemeAccent || s.themeAccent || '#21b6a8');
          setValue('songBoardThemeText', s.songBoardThemeText || s.themeText || '#fff7fb');
          setValue('songBoardThemeBackground', s.songBoardThemeBackground || s.themeBackground || '#181823');
          setValue('songBoardThemeOpacity', s.songBoardThemeOpacity || s.themeOpacity || '0.35');
          setValue('songBoardThemeOpacityNumber', s.songBoardThemeOpacity || s.themeOpacity || '0.35');
          setValue('songBoardThemeRadius', s.songBoardThemeRadius || s.themeRadius || '8');
          setValue('songBoardBackdropBlur', s.songBoardBackdropBlur || s.backdropBlur || '0');
          setValue('songBoardBackdropBlurNumber', s.songBoardBackdropBlur || s.backdropBlur || '0');
          setValue('songBoardGlowIntensity', s.songBoardGlowIntensity || s.glowIntensity || '0');
          setValue('songBoardGlowIntensityNumber', s.songBoardGlowIntensity || s.glowIntensity || '0');
          setValue('songBoardEnableGradient', s.songBoardEnableGradient || s.enableGradient || 'false');
          setValue('songBoardGradientEnd', s.songBoardGradientEnd || s.gradientEnd || '#181823');
          setValue('songBoardFontFamily', s.songBoardFontFamily || s.overlayFontFamily || 'Microsoft YaHei');
          setValue('songBoardFontWeight', s.songBoardFontWeight || s.overlayFontWeight || '800');
          setValue('songBoardSongColor', s.songBoardSongColor || s.overlaySongColor || '');
          setValue('songBoardTitle', s.songBoardTitle || s.overlayTitle || '');
          setValue('songBoardSongFontSize', s.songBoardSongFontSize || '16');
          setValue('songBoardSongFontSizeNumber', s.songBoardSongFontSize || '16');
          setValue('songBoardTitleFontSize', s.songBoardTitleFontSize || '15');
          setValue('songBoardTitleFontSizeNumber', s.songBoardTitleFontSize || '15');
        }
      }
    });

    // Song board range ↔ number pairs
    if (window.AdminApp.forms && window.AdminApp.forms.bindRangePair) {
      const { bindRangePair } = window.AdminApp.forms;
      bindRangePair('songBoardThemeOpacity', 'songBoardThemeOpacityNumber', 0, 1, 0.35);
      bindRangePair('songBoardBackdropBlur', 'songBoardBackdropBlurNumber', 0, 30, 0);
      bindRangePair('songBoardGlowIntensity', 'songBoardGlowIntensityNumber', 0, 20, 0);
      bindRangePair('songBoardSongFontSize', 'songBoardSongFontSizeNumber', 10, 40, 16);
      bindRangePair('songBoardTitleFontSize', 'songBoardTitleFontSizeNumber', 10, 28, 15);
    }

    // Song board presets
    document.getElementById('songBoardPresets').addEventListener('click', (event) => {
      const card = event.target.closest('[data-theme]');
      if (!card) return;
      if (songBoardSync.checked) return;
      const preset = songBoardThemePresets[card.dataset.theme];
      if (!preset) return;
      if (window.AdminApp.forms && window.AdminApp.forms.fillForm) {
        window.AdminApp.forms.fillForm(preset);
      }
      songBoardSyncAllRangeInputs(preset);
      if (window.AdminApp.theme && window.AdminApp.theme.renderPresetCards) {
        window.AdminApp.theme.renderPresetCards('songBoardPresets', songBoardThemePresets, songBoardPresetLabels, songBoardPresetSwatches);
      }
      toast(`已套用「${songBoardPresetLabels[card.dataset.theme]}」歌单展示板预设，保存后生效`);
    });

    // Song board reset
    document.getElementById('songBoardResetTheme').addEventListener('click', async () => {
      const defaults = {
        songBoardThemePrimary: '#ff6f91', songBoardThemeAccent: '#21b6a8',
        songBoardThemeText: '#fff7fb', songBoardThemeBackground: '#181823',
        songBoardThemeOpacity: '0.35', songBoardThemeRadius: '8',
        songBoardBackdropBlur: '0', songBoardGlowIntensity: '0',
        songBoardEnableGradient: 'false', songBoardGradientEnd: '#181823',
        songBoardFontFamily: 'Microsoft YaHei', songBoardFontWeight: '800',
        songBoardSongColor: '', songBoardTitle: '',
        songBoardSongFontSize: '16', songBoardTitleFontSize: '15'
      };
      if (window.AdminApp.forms && window.AdminApp.forms.fillForm) {
        window.AdminApp.forms.fillForm(defaults);
      }
      songBoardSyncAllRangeInputs(defaults);
      toast('歌单展示板主题已恢复默认');
    });

    document.getElementById('copyOverlayUrls').addEventListener('click', async () => {
      const text = [
        document.getElementById('queueUrl').textContent,
        document.getElementById('songsUrl').textContent,
        document.getElementById('blindboxOverlayUrl').textContent
      ].join('\n');
      await navigator.clipboard.writeText(text);
      toast('全部 overlay 地址已复制');
    });

    document.querySelectorAll('[data-copy-url]').forEach((button) => {
      button.addEventListener('click', async () => {
        const url = document.getElementById(button.dataset.copyUrl).textContent;
        await navigator.clipboard.writeText(url);
        toast('直播画面地址已复制');
      });
    });
  }

  function initOverlayUrls() {
    const origin = location.origin.replace('127.0.0.1', 'localhost');
    document.getElementById('queueUrl').textContent = `${origin}/queue`;
    document.getElementById('songsUrl').textContent = `${origin}/songlist`;
    // 盲盒盈亏的 URL 由 settings.js 的 buildBlindboxOverlayUrl 生成
    if (window.AdminApp.settings && window.AdminApp.settings.updateBlindboxOverlayUrl) {
      window.AdminApp.settings.updateBlindboxOverlayUrl();
    }
  }

  function collectDisplay() {
    const sync = document.getElementById('songBoardSyncTheme').checked;
    const body = {
      scrollSeconds: value('scrollSeconds'),
      songBoardSyncTheme: sync ? 'true' : 'false',
      songBoardSortMode: value('songBoardSortMode')
    };
    if (!sync) {
      Object.assign(body, {
        songBoardThemePrimary: value('songBoardThemePrimary'),
        songBoardThemeAccent: value('songBoardThemeAccent'),
        songBoardThemeText: value('songBoardThemeText'),
        songBoardThemeBackground: value('songBoardThemeBackground'),
        songBoardThemeOpacity: value('songBoardThemeOpacity'),
        songBoardThemeRadius: value('songBoardThemeRadius'),
        songBoardBackdropBlur: value('songBoardBackdropBlur'),
        songBoardGlowIntensity: value('songBoardGlowIntensity'),
        songBoardEnableGradient: value('songBoardEnableGradient'),
        songBoardGradientEnd: value('songBoardGradientEnd'),
        songBoardFontFamily: value('songBoardFontFamily'),
        songBoardFontWeight: value('songBoardFontWeight'),
        songBoardSongColor: value('songBoardSongColor'),
        songBoardTitle: value('songBoardTitle'),
        songBoardSongFontSize: value('songBoardSongFontSize'),
        songBoardTitleFontSize: value('songBoardTitleFontSize')
      });
    }
    return body;
  }

  function songBoardSyncAllRangeInputs(values) {
    const v = values || {};
    setValue('songBoardThemeOpacityNumber', v.songBoardThemeOpacity || value('songBoardThemeOpacity'));
    setValue('songBoardBackdropBlurNumber', v.songBoardBackdropBlur || value('songBoardBackdropBlur'));
    setValue('songBoardGlowIntensityNumber', v.songBoardGlowIntensity || value('songBoardGlowIntensity'));
    setValue('songBoardSongFontSizeNumber', v.songBoardSongFontSize || value('songBoardSongFontSize'));
    setValue('songBoardTitleFontSizeNumber', v.songBoardTitleFontSize || value('songBoardTitleFontSize'));
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.display = {
    initDisplayForm,
    initOverlayUrls,
    collectDisplay,
    songBoardSyncAllRangeInputs
  };
})();
