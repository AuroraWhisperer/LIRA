// 编写人：Aurora
// 表单工具和通用组件
'use strict';

import { value, setValue, normalizeRangeValue } from '../shared/utils.js';
import { initParameterRanges } from '../shared/parameter-range.js';
import { readQueueStyleSettings } from '../shared/queue-style-settings.js';
import { ensureSavedFontOption } from './local-font-library.js';

/**
 * 表单服务
 * 负责表单相关的工具函数和UI控制
 */
export class FormsService {
  /**
   * 绑定 range 输入和 number 输入的双向同步，可选换算数值框的显示倍率
   */
  bindRangePair(rangeId, numberId, min, max, fallback, displayScale = 1) {
    document.getElementById(rangeId).addEventListener('input', () => {
      const rangeValue = value(rangeId);
      const displayValue =
        displayScale === 1
          ? rangeValue
          : String(Number((Number(rangeValue) * displayScale).toFixed(6)));
      setValue(numberId, displayValue);
    });
    document.getElementById(numberId).addEventListener('input', () => {
      setValue(
        rangeId,
        normalizeRangeValue(
          Number(value(numberId)) / displayScale,
          min,
          max,
          fallback,
        ),
      );
      this.refreshParameterRanges(document.getElementById(rangeId));
    });
  }

  refreshParameterRanges(root = document) {
    return initParameterRanges(root);
  }

  /**
   * 初始化选项卡
   */
  initTabs() {
    document.querySelectorAll('.tab').forEach((button) => {
      button.addEventListener('click', () => {
        document
          .querySelectorAll('.tab')
          .forEach((item) => item.classList.remove('active'));
        document
          .querySelectorAll('.tab-page')
          .forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        document.getElementById(button.dataset.tab).classList.add('active');
      });
    });
  }

  /**
   * 初始化工作区控制
   */
  initWorkspaceControls() {
    // 全屏播放器
    const playerPanel = document.querySelector('.playback-player-panel');
    const fsEl = document.getElementById('playerFullscreen');
    const fsCloseBtn = document.getElementById('playerFsClose');
    const playerDockToggle = document.getElementById('playerDockToggle');

    // 点击播放器面板（排除按钮和输入框）切换全屏
    playerPanel?.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a, .playback-seek-wrap')) return;
      if (fsEl?.classList.contains('open')) {
        this.closeFullscreenPlayer();
      } else {
        this.openFullscreenPlayer();
      }
    });

    // 收起按钮 - 关闭全屏播放器
    fsCloseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeFullscreenPlayer();
    });

    // ESC键关闭全屏播放器，空格键播放/暂停
    playerDockToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = !document.body.classList.contains(
        'player-dock-collapsed',
      );
      this.setPlayerDockCollapsed(collapsed);
    });

    // 播放器默认收起，避免遮挡主工作区；用户仍可通过手柄展开。
    this.setPlayerDockCollapsed(true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && fsEl?.classList.contains('open')) {
        this.closeFullscreenPlayer();
      }
      // 空格键控制播放/暂停（在全屏播放器打开时）
      if (e.key === ' ' && fsEl?.classList.contains('open')) {
        e.preventDefault();
        const audio = document.getElementById('music-player');
        if (audio) {
          if (audio.paused) {
            audio.play().catch((error) => {
              console.warn('[playback] play failed:', error);
            });
          } else {
            audio.pause();
          }
        }
      }
    });
  }

  /**
   * 打开全屏播放器
   */
  openFullscreenPlayer() {
    const fsEl = document.getElementById('playerFullscreen');
    if (!fsEl) return;
    fsEl.classList.add('open');
    fsEl.removeAttribute('aria-hidden');
    document.body.classList.add('player-fs-open');
  }

  /**
   * 关闭全屏播放器
   */
  closeFullscreenPlayer() {
    const fsEl = document.getElementById('playerFullscreen');
    if (!fsEl) return;
    fsEl.classList.remove('open');
    fsEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('player-fs-open');
  }

  setPlayerDockCollapsed(collapsed) {
    const playerPanel = document.querySelector('.playback-player-panel');
    const playerBody = document.getElementById('playbackPlayerBody');
    const playerDockToggle = document.getElementById('playerDockToggle');
    const label = collapsed ? '展开播放器' : '收起播放器';

    document.body.classList.toggle('player-dock-collapsed', collapsed);
    playerPanel?.classList.toggle('is-collapsed', collapsed);
    playerBody?.setAttribute('aria-hidden', String(collapsed));

    if (playerDockToggle) {
      playerDockToggle.title = label;
      playerDockToggle.setAttribute('aria-label', label);
      playerDockToggle.setAttribute('aria-expanded', String(!collapsed));
    }

    if (collapsed) this.closeDockDependentPlaybackUi();
  }

  closeDockDependentPlaybackUi() {
    this.closeFullscreenPlayer();

    const closeQueuePopup = window.AdminApp?.playback?.closeQueuePopup;
    if (typeof closeQueuePopup === 'function') {
      closeQueuePopup();
    } else {
      document.getElementById('queuePopup')?.classList.remove('open');
      document.getElementById('queuePopupBackdrop')?.classList.remove('open');
      document.getElementById('playbackQueueBtn')?.classList.remove('active');
    }

    const volumePanel = document.getElementById('playbackVolumePanel');
    const volumeButton = document.getElementById('playbackVolumeIcon');
    volumeButton?.closest('.playback-volume-wrap')?.classList.remove('open');
    volumeButton?.setAttribute('aria-expanded', 'false');
    volumePanel?.setAttribute('aria-hidden', 'true');
  }

  /**
   * 填充表单
   */
  fillForm(values) {
    const overlayStyle =
      values?.overlayQueueStyle || value('overlayQueueStyle') || 'classic';
    const activeQueueSettings = readQueueStyleSettings(values, overlayStyle);
    ensureSavedFontOption(
      document.getElementById('illustratedQueueFontFamily'),
      activeQueueSettings.fontFamily,
    );
    for (const [key, inputValue] of Object.entries(values || {})) {
      const element = document.getElementById(key);
      // Keep an in-progress edit intact while a live state snapshot arrives.
      if (element?.closest('#openingAnimationForm')) continue;
      if (element && element !== document.activeElement)
        element.value = inputValue;
    }
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
          // Copy main theme values into song board fields
          setValue(
            'songBoardThemePrimary',
            (values && values.themePrimary) || '#ff6f91',
          );
          setValue(
            'songBoardThemeAccent',
            (values && values.themeAccent) || '#21b6a8',
          );
          setValue(
            'songBoardThemeText',
            (values && values.themeText) || '#fff7fb',
          );
          setValue(
            'songBoardThemeBackground',
            (values && values.themeBackground) || '#181823',
          );
          setValue(
            'songBoardThemeOpacity',
            (values && values.themeOpacity) || '0.48',
          );
          setValue(
            'songBoardThemeRadius',
            (values && values.themeRadius) || '8',
          );
          setValue(
            'songBoardBackdropBlur',
            (values && values.backdropBlur) || '14',
          );
          setValue(
            'songBoardGlowIntensity',
            (values && values.glowIntensity) || '2',
          );
          setValue(
            'songBoardEnableGradient',
            (values && values.enableGradient) || 'false',
          );
          setValue(
            'songBoardGradientEnd',
            (values && values.gradientEnd) || '#181823',
          );
          setValue(
            'songBoardFontFamily',
            (values && values.overlayFontFamily) || 'Microsoft YaHei',
          );
          setValue(
            'songBoardFontWeight',
            (values && values.overlayFontWeight) || '800',
          );
          setValue(
            'songBoardSongColor',
            (values && values.overlaySongColor) || '',
          );
          setValue('songBoardTitle', (values && values.overlayTitle) || '');
        }
      }
    }

    const songFontSize = this.normalizeFontSize(
      values && values.queueSongFontSize,
      this.scaleToFontSize(values && values.themeFontScale, 40),
      70,
      10,
    );
    const titleFontSize = this.normalizeFontSize(
      values && values.queueTitleFontSize,
      this.scaleToFontSize(values && values.themeFontScale, 30),
      40,
      10,
    );
    setValue('queueSongFontSize', songFontSize);
    if (document.getElementById('queueSongFontSizeNumber')) {
      setValue('queueSongFontSizeNumber', songFontSize);
    }

    setValue('queueTitleFontSize', titleFontSize);
    if (document.getElementById('queueTitleFontSizeNumber')) {
      setValue('queueTitleFontSizeNumber', titleFontSize);
    }
    const identityFontSize = this.normalizeFontSize(
      activeQueueSettings.fontSize,
      26,
      78,
      9,
    );
    if (document.getElementById('identityQueueFontSize')) {
      setValue('identityQueueFontSize', identityFontSize);
    }
    if (document.getElementById('identityQueueFontSizeNumber')) {
      setValue('identityQueueFontSizeNumber', identityFontSize);
    }
    setValue('illustratedQueueFontFamily', activeQueueSettings.fontFamily);
    setValue('illustratedQueueFontWeight', activeQueueSettings.fontWeight);
    setValue(
      'illustratedQueueUseCustomTextColor',
      activeQueueSettings.useCustomTextColor,
    );
    setValue('illustratedQueueTextColor', activeQueueSettings.textColor);
    setValue('identityQueueScrollMode', activeQueueSettings.scrollMode);
    const ruleFontSize = this.normalizeFontSize(
      values && values.overlayRuleFontSize,
      10,
      18,
    );
    if (document.getElementById('overlayRuleFontSize')) {
      setValue('overlayRuleFontSize', ruleFontSize);
    }
    if (document.getElementById('overlayRuleFontSizeNumber')) {
      setValue('overlayRuleFontSizeNumber', ruleFontSize);
    }
    if (document.getElementById('themeOpacityNumber')) {
      setValue('themeOpacityNumber', value('themeOpacity'));
    }
    if (document.getElementById('songBoardFontSizeNumber')) {
      setValue('songBoardFontSizeNumber', value('songBoardFontSize'));
    }
    if (document.getElementById('backdropBlurNumber')) {
      setValue('backdropBlurNumber', value('backdropBlur'));
    }
    if (document.getElementById('glowIntensityNumber')) {
      setValue('glowIntensityNumber', value('glowIntensity'));
    }
    if (document.getElementById('scrollSecondsRange')) {
      const songScrollSpeed = this.normalizeSongScrollSpeedForDisplay(
        values && values.scrollSeconds !== undefined
          ? values.scrollSeconds
          : value('scrollSeconds'),
      );
      setValue('scrollSeconds', songScrollSpeed);
      setValue('scrollSecondsRange', songScrollSpeed);
    }
    if (document.getElementById('queueScrollSpeedRange')) {
      const queueScrollSpeed = this.normalizeQueueScrollSpeedForDisplay(
        values && values.queueScrollSpeed,
      );
      setValue('queueScrollSpeed', queueScrollSpeed);
      setValue('queueScrollSpeedRange', queueScrollSpeed);
    }
    if (document.getElementById('identityQueueScrollSpeedRange')) {
      const identityScrollSpeed = this.normalizeQueueScrollSpeedForDisplay(
        activeQueueSettings.scrollSpeed,
      );
      setValue('identityQueueScrollSpeed', identityScrollSpeed);
      setValue('identityQueueScrollSpeedRange', identityScrollSpeed);
    }
    this.refreshParameterRanges();
  }

  /**
   * 规范化队列滚动速度用于显示
   */
  normalizeQueueScrollSpeedForDisplay(input) {
    const valueNumber = Number(input);
    if (!Number.isFinite(valueNumber)) return '80';
    if (valueNumber > 100) {
      const actualSpeed = Math.max(50, Math.min(200, valueNumber));
      return String(Math.round(1 + ((actualSpeed - 50) / 150) * 99));
    }
    return String(Math.max(1, Math.min(100, Math.round(valueNumber))));
  }

  normalizeSongScrollSpeedForDisplay(input) {
    const valueNumber = Number(input);
    if (!Number.isFinite(valueNumber)) return '45';
    return String(Math.max(1, Math.min(100, Math.round(valueNumber))));
  }

  /**
   * 规范化字体大小
   */
  normalizeFontSize(input, fallback, max = 20, min = 5) {
    return normalizeRangeValue(input, min, max, fallback);
  }

  /**
   * 缩放到字体大小
   */
  scaleToFontSize(scale, baseSize) {
    const normalizedScale = Number(normalizeRangeValue(scale, 0.25, 2, 1));
    return Math.round(normalizedScale * baseSize);
  }

  /**
   * 重连错误消息
   */
  reconnectErrorMessage(error) {
    const text = String((error && error.message) || error || '');
    if (
      /Failed to fetch|NetworkError|Load failed|ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(
        text,
      )
    ) {
      return '刷新直播失败：本地服务未响应，请重启 LIRA 后再试。';
    }
    if (/Unexpected end of JSON input|非 JSON/i.test(text)) {
      return text;
    }
    return text || '刷新直播失败，请稍后重试。';
  }
}

// 创建单例实例
export const formsService = new FormsService();

// 【过渡期兼容层】- 保持window.AdminApp.forms可用
// 阶段5时删除
if (typeof window !== 'undefined') {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.forms = {
    bindRangePair: (...args) => formsService.bindRangePair(...args),
    initTabs: () => formsService.initTabs(),
    initWorkspaceControls: () => formsService.initWorkspaceControls(),
    refreshParameterRanges: (root) => formsService.refreshParameterRanges(root),
    fillForm: (values) => formsService.fillForm(values),
    normalizeQueueScrollSpeedForDisplay: (input) =>
      formsService.normalizeQueueScrollSpeedForDisplay(input),
    normalizeSongScrollSpeedForDisplay: (input) =>
      formsService.normalizeSongScrollSpeedForDisplay(input),
    normalizeFontSize: (...args) => formsService.normalizeFontSize(...args),
    scaleToFontSize: (...args) => formsService.scaleToFontSize(...args),
    reconnectErrorMessage: (error) => formsService.reconnectErrorMessage(error),
  };

  // 全局函数（为了兼容现有代码）
  window.openFullscreenPlayer = () => formsService.openFullscreenPlayer();
  window.closeFullscreenPlayer = () => formsService.closeFullscreenPlayer();
}
