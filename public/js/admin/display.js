// 编写人：Aurora
// 展示板配置
'use strict';

import { formsService } from './forms.js';
import { stateService } from './state.js';
import { theme } from '../shared/theme.js';
import {
  value,
  setValue,
  localOverlayOrigin,
  copyText,
  toast,
  api,
  debounce,
  normalizeRangeValue,
} from '../shared/utils.js';
import { renderPresetCards } from './theme-preset-cards.js';
import { updateBlindboxOverlayUrl } from './settings.js';
import { publishDisplay } from './legacy-admin-bridge.js';
import { observeServerOverlayUrl } from './server-overlay-url.js';

export const display = (() => {
  const { songBoardThemePresets, songBoardPresetLabels, songBoardPresetSwatches } = theme;

  function initDisplayForm() {
    const displayForm = document.getElementById('displayForm');
    const saveDisplay = async () => {
      await api('/api/settings', collectDisplay());
    };
    const autosaveDisplay = debounce(async () => {
      try {
        await saveDisplay();
      } catch (_) {
        // api() already shows the save error to the user.
      }
    }, 180);

    displayForm.addEventListener('input', autosaveDisplay);
    displayForm.addEventListener('change', autosaveDisplay);
    displayForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveDisplay();
      toast('展示板已保存');
      if (stateService && stateService.reloadState) {
        await stateService.reloadState();
      }
    });

    document.getElementById('scrollSecondsRange').addEventListener('input', () => {
      setValue('scrollSeconds', value('scrollSecondsRange'));
    });
    document.getElementById('scrollSeconds').addEventListener('input', () => {
      setValue(
        'scrollSecondsRange',
        String(Math.round(Number(normalizeRangeValue(value('scrollSeconds'), 1, 100, 45)))),
      );
      formsService?.refreshParameterRanges?.(document.getElementById('scrollSecondsRange'));
    });

    // Song board sync toggle
    const songBoardSync = document.getElementById('songBoardSyncTheme');
    const songBoardArea = document.getElementById('songBoardThemeArea');
    songBoardSync.addEventListener('change', () => {
      songBoardArea.hidden = songBoardSync.checked;
      if (songBoardSync.checked) return;
      const appState = stateService.getAppState();
      if (!appState) return;
      const settings = appState.settings || {};
      setValue('songBoardThemePrimary', settings.songBoardThemePrimary || settings.themePrimary || '#ff6f91');
      setValue('songBoardThemeAccent', settings.songBoardThemeAccent || settings.themeAccent || '#21b6a8');
      setValue('songBoardThemeText', settings.songBoardThemeText || settings.themeText || '#fff7fb');
      setValue('songBoardThemeBackground', settings.songBoardThemeBackground || settings.themeBackground || '#181823');
      setValue('songBoardThemeOpacity', settings.songBoardThemeOpacity || settings.themeOpacity || '0.35');
      setValue('songBoardThemeOpacityNumber', settings.songBoardThemeOpacity || settings.themeOpacity || '0.35');
      setValue('songBoardThemeRadius', settings.songBoardThemeRadius || settings.themeRadius || '8');
      setValue('songBoardBackdropBlur', settings.songBoardBackdropBlur || settings.backdropBlur || '0');
      setValue('songBoardBackdropBlurNumber', settings.songBoardBackdropBlur || settings.backdropBlur || '0');
      setValue('songBoardGlowIntensity', settings.songBoardGlowIntensity || settings.glowIntensity || '0');
      setValue('songBoardGlowIntensityNumber', settings.songBoardGlowIntensity || settings.glowIntensity || '0');
      setValue('songBoardEnableGradient', settings.songBoardEnableGradient || settings.enableGradient || 'false');
      setValue('songBoardGradientEnd', settings.songBoardGradientEnd || settings.gradientEnd || '#181823');
      setValue('songBoardFontFamily', settings.songBoardFontFamily || settings.overlayFontFamily || 'Microsoft YaHei');
      setValue('songBoardFontWeight', settings.songBoardFontWeight || settings.overlayFontWeight || '800');
      setValue('songBoardSongColor', settings.songBoardSongColor || settings.overlaySongColor || '');
      setValue('songBoardTitle', settings.songBoardTitle || settings.overlayTitle || '');
      setValue('songBoardSongFontSize', settings.songBoardSongFontSize || '16');
      setValue('songBoardSongFontSizeNumber', settings.songBoardSongFontSize || '16');
      setValue('songBoardTitleFontSize', settings.songBoardTitleFontSize || '15');
      setValue('songBoardTitleFontSizeNumber', settings.songBoardTitleFontSize || '15');
      formsService?.refreshParameterRanges?.();
    });

    // Song board range ↔ number pairs
    if (formsService && formsService.bindRangePair) {
      formsService.bindRangePair('songBoardThemeOpacity', 'songBoardThemeOpacityNumber', 0, 1, 0.35);
      formsService.bindRangePair('songBoardBackdropBlur', 'songBoardBackdropBlurNumber', 0, 30, 0);
      formsService.bindRangePair('songBoardGlowIntensity', 'songBoardGlowIntensityNumber', 0, 20, 0);
      formsService.bindRangePair('songBoardFontSize', 'songBoardFontSizeNumber', 10, 80, 28);
      formsService.bindRangePair('songBoardSongFontSize', 'songBoardSongFontSizeNumber', 10, 40, 16);
      formsService.bindRangePair('songBoardTitleFontSize', 'songBoardTitleFontSizeNumber', 10, 28, 15);
    }

    // Song board presets
    document.getElementById('songBoardPresets').addEventListener('click', async (event) => {
      const card = event.target.closest('[data-theme]');
      if (!card) return;
      if (songBoardSync.checked) return;
      const preset = songBoardThemePresets[card.dataset.theme];
      if (!preset) return;
      if (formsService && formsService.fillForm) {
        formsService.fillForm(preset);
      }
      songBoardSyncAllRangeInputs(preset);
      renderPresetCards('songBoardPresets', songBoardThemePresets, songBoardPresetLabels, songBoardPresetSwatches);
      await saveDisplay();
      toast(`已套用「${songBoardPresetLabels[card.dataset.theme]}」歌单展示板预设`);
    });

    // Song board reset
    document.getElementById('songBoardResetTheme').addEventListener('click', async () => {
      const defaults = {
        songBoardThemePrimary: '#ff6f91',
        songBoardThemeAccent: '#21b6a8',
        songBoardThemeText: '#fff7fb',
        songBoardThemeBackground: '#181823',
        songBoardThemeOpacity: '0.35',
        songBoardThemeRadius: '8',
        songBoardBackdropBlur: '0',
        songBoardGlowIntensity: '0',
        songBoardEnableGradient: 'false',
        songBoardGradientEnd: '#181823',
        songBoardFontFamily: 'Microsoft YaHei',
        songBoardFontWeight: '800',
        songBoardSongColor: '',
        songBoardTitle: '',
        songBoardSongFontSize: '16',
        songBoardTitleFontSize: '15',
      };
      if (formsService && formsService.fillForm) {
        formsService.fillForm(defaults);
      }
      songBoardSyncAllRangeInputs(defaults);
      await saveDisplay();
      toast('歌单展示板主题已恢复默认');
    });

    document.querySelectorAll('[data-copy-url]').forEach((button) => {
      button.addEventListener('click', async () => {
        const url = document.getElementById(button.dataset.copyUrl).textContent;
        if (button.disabled || !url) return;
        try {
          await copyText(url);
          toast('地址已复制');
        } catch (error) {
          toast(error?.message || '复制失败，请手动复制地址');
          prompt('复制以下地址：', url);
        }
      });
    });
    document.querySelectorAll('[data-open-url]').forEach((button) => {
      button.addEventListener('click', () => {
        const url = document.getElementById(button.dataset.openUrl).textContent;
        if (!button.disabled && url) window.open(url, '_blank', 'noopener,noreferrer');
      });
    });
  }

  function initOverlayUrls() {
    const origin = localOverlayOrigin(location);
    document.getElementById('queueUrl').textContent = `${origin}/queue`;
    document.getElementById('songsUrl').textContent = `${origin}/songlist`;
    document.getElementById('lyricsUrl').textContent = `${origin}/lyrics`;
    observeServerOverlayUrl((url) => {
      document.getElementById('liveDanmakuUrl').textContent = url || '连接已授权账号后显示服务器地址';
      document.querySelector('[data-copy-url="liveDanmakuUrl"]').disabled = !url;
    });
    document.getElementById('liveBlindboxUrl').textContent = `${origin}/blindbox`;
    document.getElementById('liveGamesUrl').textContent = `${origin}/games`;
    document.getElementById('liveWheelUrl').textContent = `${origin}/wheel`;
    document.getElementById('liveInteractionsUrl').textContent = `${origin}/interactions`;
    document.getElementById('liveGiftFeedUrl').textContent = `${origin}/gift-feed`;
    document.getElementById('liveGiftWishLongUrl').textContent = `${origin}/gift-wishes?period=long`;
    document.getElementById('liveGiftWishDayUrl').textContent = `${origin}/gift-wishes?period=day`;
    document.getElementById('liveGiftWishSessionUrl').textContent = `${origin}/gift-wishes?period=session`;
    document.getElementById('liveOvertimeUrl').textContent = `${origin}/overtime`;
    document.getElementById('liveGiftEffectsUrl').textContent = `${origin}/gift-effects`;
    document.getElementById('liveOpeningUrl').textContent = `${origin}/opening`;
    document.getElementById('liveClockUrl').textContent = `${origin}/clock`;
    updateBlindboxOverlayUrl();
    initSongPageUrl();
  }

  function initSongPageUrl() {
    const bridge = window.liraLicense;
    let profileChanged = false;
    const render = (snapshot) => {
      let url = '';
      if (snapshot?.state === 'authorized') {
        try {
          const page = new URL(snapshot.streamer?.songPageUrl);
          if (page.protocol === 'https:' && !page.username && !page.password) url = page.href;
        } catch {
          url = '';
        }
      }
      document.getElementById('webSongPageUrl').textContent = url || '连接已授权账号后显示网页歌单地址';
      document.querySelector('[data-copy-url="webSongPageUrl"]').disabled = !url;
      document.querySelector('[data-open-url="webSongPageUrl"]').disabled = !url;
    };
    render(null);
    const dispose = bridge?.onStateChanged?.((snapshot) => {
      profileChanged = true;
      render(snapshot);
    });
    Promise.resolve(bridge?.getProfile?.())
      .then((snapshot) => {
        if (!profileChanged) render(snapshot);
      })
      .catch(() => {
        if (!profileChanged) render(null);
      });
    window.addEventListener(
      'pagehide',
      () => {
        profileChanged = true;
        dispose?.();
      },
      { once: true },
    );
  }

  function collectDisplay() {
    const sync = document.getElementById('songBoardSyncTheme').checked;
    const body = {
      scrollSeconds: value('scrollSeconds'),
      songBoardSyncTheme: sync ? 'true' : 'false',
      songBoardSortMode: value('songBoardSortMode'),
      songBoardFontSize: value('songBoardFontSize'),
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
        songBoardTitleFontSize: value('songBoardTitleFontSize'),
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

  return {
    initDisplayForm,
    initOverlayUrls,
    collectDisplay,
    songBoardSyncAllRangeInputs,
  };
})();
publishDisplay(display);
