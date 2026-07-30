// 编写人：Aurora
// 表单工具和通用组件
'use strict';

(function () {
  const { value, setValue, normalizeRangeValue } = window.AdminApp.utils;

  /**
   * Bind a range input and its paired number input for two-way sync.
   */
  function bindRangePair(rangeId, numberId, min, max, fallback) {
    document.getElementById(rangeId).addEventListener('input', () =>
      setValue(numberId, value(rangeId))
    );
    document.getElementById(numberId).addEventListener('input', () =>
      setValue(rangeId, normalizeRangeValue(value(numberId), min, max, fallback))
    );
  }

  function initTabs() {
    document.querySelectorAll('.tab').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
        document.querySelectorAll('.tab-page').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        document.getElementById(button.dataset.tab).classList.add('active');
        const overflow = button.closest('.tab-overflow');
        document.querySelectorAll('.tab-overflow').forEach((details) => {
          details.dataset.hasActiveTab = String(details === overflow);
          details.open = false;
        });
      });
    });
  }

  function initWorkspaceControls() {
    // 全屏播放器
    const playerPanel = document.querySelector('.playback-player-panel');
    const fsEl = document.getElementById('playerFullscreen');
    const fsCloseBtn = document.getElementById('playerFsClose');

    // 点击播放器面板（排除按钮和输入框）打开全屏
    playerPanel?.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a, .playback-seek-wrap')) return;
      openFullscreenPlayer();
    });

    // 收起按钮
    fsCloseBtn?.addEventListener('click', closeFullscreenPlayer);

    function openFullscreenPlayer() {
      if (!fsEl) return;
      fsEl.classList.add('open');
      fsEl.removeAttribute('aria-hidden');
      document.body.classList.add('player-fs-open');
    }

    function closeFullscreenPlayer() {
      if (!fsEl) return;
      fsEl.classList.remove('open');
      fsEl.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('player-fs-open');
    }

    window.openFullscreenPlayer = openFullscreenPlayer;
    window.closeFullscreenPlayer = closeFullscreenPlayer;

    const superChatToggle = document.getElementById('superChatToggle');
    const superChatPanel = superChatToggle?.closest('.panel');
    superChatToggle?.addEventListener('click', () => {
      const collapsed = superChatPanel?.classList.toggle('is-collapsed') || false;
      superChatToggle.setAttribute('aria-expanded', String(!collapsed));
      superChatToggle.title = collapsed ? '展开 SC 队列' : '折叠 SC 队列';
    });

    document.addEventListener('click', (event) => {
      document.querySelectorAll('.tab-overflow[open]').forEach((details) => {
        if (!details.contains(event.target)) details.open = false;
      });
    });
  }

  function fillForm(values) {
    for (const [key, inputValue] of Object.entries(values || {})) {
      const element = document.getElementById(key);
      if (element) element.value = inputValue;
    }
    const overlayStyle = value('overlayQueueStyle') || 'classic';
    if (window.AdminApp.theme && window.AdminApp.theme.setOverlayStyle) {
      window.AdminApp.theme.setOverlayStyle(overlayStyle);
    }

    // Song board sync toggle
    const syncCheckbox = document.getElementById('songBoardSyncTheme');
    const syncArea = document.getElementById('songBoardThemeArea');
    if (syncCheckbox && syncArea) {
      if (values && 'songBoardSyncTheme' in values) {
        const synced = values.songBoardSyncTheme !== 'false';
        syncCheckbox.checked = synced;
        syncArea.hidden = synced;
        if (synced) {
          // Copy main theme values into song board fields for seamless toggle-off
          setValue('songBoardThemePrimary', (values && values.themePrimary) || '#ff6f91');
          setValue('songBoardThemeAccent', (values && values.themeAccent) || '#21b6a8');
          setValue('songBoardThemeText', (values && values.themeText) || '#fff7fb');
          setValue('songBoardThemeBackground', (values && values.themeBackground) || '#181823');
          setValue('songBoardThemeOpacity', (values && values.themeOpacity) || '0.35');
          setValue('songBoardThemeRadius', (values && values.themeRadius) || '8');
          setValue('songBoardBackdropBlur', (values && values.backdropBlur) || '0');
          setValue('songBoardGlowIntensity', (values && values.glowIntensity) || '0');
          setValue('songBoardEnableGradient', (values && values.enableGradient) || 'false');
          setValue('songBoardGradientEnd', (values && values.gradientEnd) || '#181823');
          setValue('songBoardFontFamily', (values && values.overlayFontFamily) || 'Microsoft YaHei');
          setValue('songBoardFontWeight', (values && values.overlayFontWeight) || '800');
          setValue('songBoardSongColor', (values && values.overlaySongColor) || '');
          setValue('songBoardTitle', (values && values.overlayTitle) || '');
        }
      }
    }

    const songFontSize = normalizeFontSize(
      values && values.queueSongFontSize,
      scaleToFontSize(values && values.themeFontScale, 20),
      35
    );
    const titleFontSize = normalizeFontSize(
      values && values.queueTitleFontSize,
      scaleToFontSize(values && values.themeFontScale, 15),
      20
    );
    setValue('queueSongFontSize', songFontSize);
    if (document.getElementById('queueSongFontSizeNumber')) {
      setValue('queueSongFontSizeNumber', songFontSize);
    }

    setValue('queueTitleFontSize', titleFontSize);
    if (document.getElementById('queueTitleFontSizeNumber')) {
      setValue('queueTitleFontSizeNumber', titleFontSize);
    }
    const ruleFontSize = normalizeFontSize(values && values.overlayRuleFontSize, 10, 18);
    if (document.getElementById('overlayRuleFontSize')) {
      setValue('overlayRuleFontSize', ruleFontSize);
    }
    if (document.getElementById('overlayRuleFontSizeNumber')) {
      setValue('overlayRuleFontSizeNumber', ruleFontSize);
    }
    if (document.getElementById('themeOpacityNumber')) {
      setValue('themeOpacityNumber', value('themeOpacity'));
    }
    if (document.getElementById('backdropBlurNumber')) {
      setValue('backdropBlurNumber', value('backdropBlur'));
    }
    if (document.getElementById('glowIntensityNumber')) {
      setValue('glowIntensityNumber', value('glowIntensity'));
    }
    if (document.getElementById('scrollSecondsRange')) {
      setValue('scrollSecondsRange', value('scrollSeconds'));
    }
    if (document.getElementById('queueScrollSpeedRange')) {
      const queueScrollSpeed = normalizeQueueScrollSpeedForDisplay(values && values.queueScrollSpeed);
      setValue('queueScrollSpeed', queueScrollSpeed);
      setValue('queueScrollSpeedRange', queueScrollSpeed);
    }
  }

  function normalizeQueueScrollSpeedForDisplay(input) {
    const valueNumber = Number(input);
    if (!Number.isFinite(valueNumber)) return '80';
    if (valueNumber > 100) {
      const actualSpeed = Math.max(50, Math.min(200, valueNumber));
      return String(Math.round(1 + ((actualSpeed - 50) / 150) * 99));
    }
    return String(Math.max(1, Math.min(100, Math.round(valueNumber))));
  }

  function normalizeFontSize(input, fallback, max = 20) {
    return normalizeRangeValue(input, 5, max, fallback);
  }

  function scaleToFontSize(scale, baseSize) {
    const normalizedScale = Number(normalizeRangeValue(scale, 0.25, 2, 1));
    return Math.round(normalizedScale * baseSize);
  }

  function reconnectErrorMessage(error) {
    const text = String((error && error.message) || error || '');
    if (/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(text)) {
      return '刷新直播失败：本地服务未响应，请重启点歌助手后再试。';
    }
    if (/Unexpected end of JSON input|非 JSON/i.test(text)) {
      return text;
    }
    return text || '刷新直播失败，请稍后重试。';
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.forms = {
    bindRangePair,
    initTabs,
    initWorkspaceControls,
    fillForm,
    normalizeQueueScrollSpeedForDisplay,
    normalizeFontSize,
    scaleToFontSize,
    reconnectErrorMessage
  };
})();
