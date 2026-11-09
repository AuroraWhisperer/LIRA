import { setOverlayStyle } from './theme-style-view.js';
// 编写人：Aurora
// 表单工具和通用组件
('use strict');

import { value, setValue, normalizeRangeValue } from '../shared/utils.js';
import { initParameterRanges } from '../shared/parameter-range.js';
import { readQueueStyleSettings } from '../shared/queue-style-settings.js';
import { ensureSavedFontOption } from '../shared/font-library.js';
import { isComponentFieldEditing } from './component-preview-panel.js';

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
        displayScale === 1 ? rangeValue : String(Number((Number(rangeValue) * displayScale).toFixed(6)));
      setValue(numberId, displayValue);
    });
    document.getElementById(numberId).addEventListener('input', () => {
      setValue(rangeId, normalizeRangeValue(Number(value(numberId)) / displayScale, min, max, fallback));
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
    document.querySelectorAll('.tabs[role="tablist"]').forEach((tablist) => {
      const tabs = [...tablist.querySelectorAll('.tab')];
      const select = (selected) => {
        for (const tab of tabs) {
          const active = tab === selected;
          tab.classList.toggle('active', active);
          tab.setAttribute('aria-selected', String(active));
          tab.tabIndex = active ? 0 : -1;
          const panel = document.getElementById(tab.dataset.tab);
          panel.classList.toggle('active', active);
          panel.hidden = !active;
        }
      };
      tabs.forEach((tab, index) => {
        const panel = document.getElementById(tab.dataset.tab);
        tab.id ||= `${tab.dataset.tab}Tab`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panel.id);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
        tab.addEventListener('click', () => select(tab));
        tab.addEventListener('keydown', (event) => {
          let next;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else return;
          event.preventDefault();
          select(tabs[next]);
          tabs[next].focus();
        });
      });
      select(tabs.find((tab) => tab.classList.contains('active')) || tabs[0]);
    });
  }

  /**
   * 填充表单
   */
  fillForm(values) {
    const setField = (key, inputValue) => {
      const element = document.getElementById(key);
      if (!element || element.closest('#openingAnimationForm, #displayForm, #themeForm, #guardThanksPanel, #desktopLyricForm')) return;
      if (element.dataset.preserveDirty === 'true' && element.dataset.dirty === 'true') return;
      if (!isComponentFieldEditing(element)) element.value = inputValue;
    };
    const overlayStyle = values?.overlayQueueStyle || value('overlayQueueStyle') || 'classic';
    const activeQueueSettings = readQueueStyleSettings(values, overlayStyle);
    ensureSavedFontOption(document.getElementById('illustratedQueueFontFamily'), activeQueueSettings.fontFamily);
    for (const key of ['overlayFontFamily', 'songBoardFontFamily']) {
      ensureSavedFontOption(document.getElementById(key), values?.[key]);
    }
    for (const [key, inputValue] of Object.entries(values || {})) setField(key, inputValue);
    setOverlayStyle(overlayStyle);

    const songFontSize = this.normalizeFontSize(
      values && values.queueSongFontSize,
      this.scaleToFontSize(values && values.themeFontScale, 28),
      70,
      10,
    );
    const titleFontSize = this.normalizeFontSize(
      values && values.queueTitleFontSize,
      this.scaleToFontSize(values && values.themeFontScale, 30),
      40,
      10,
    );
    setField('queueSongFontSize', songFontSize);
    if (document.getElementById('queueSongFontSizeNumber')) {
      setField('queueSongFontSizeNumber', songFontSize);
    }

    setField('queueTitleFontSize', titleFontSize);
    if (document.getElementById('queueTitleFontSizeNumber')) {
      setField('queueTitleFontSizeNumber', titleFontSize);
    }
    const identityFontSize = this.normalizeFontSize(activeQueueSettings.fontSize, 28, 78, 9);
    if (document.getElementById('identityQueueFontSize')) {
      setField('identityQueueFontSize', identityFontSize);
    }
    if (document.getElementById('identityQueueFontSizeNumber')) {
      setField('identityQueueFontSizeNumber', identityFontSize);
    }
    setField('illustratedQueueFontFamily', activeQueueSettings.fontFamily);
    setField('illustratedQueueFontWeight', activeQueueSettings.fontWeight);
    setField('illustratedQueueUseCustomTextColor', activeQueueSettings.useCustomTextColor);
    setField('illustratedQueueTextColor', activeQueueSettings.textColor);
    setField('identityQueueScrollMode', activeQueueSettings.scrollMode);
    const ruleFontSize = this.normalizeFontSize(values && values.overlayRuleFontSize, 10, 18);
    if (document.getElementById('overlayRuleFontSize')) {
      setField('overlayRuleFontSize', ruleFontSize);
    }
    if (document.getElementById('overlayRuleFontSizeNumber')) {
      setField('overlayRuleFontSizeNumber', ruleFontSize);
    }
    if (document.getElementById('themeOpacityNumber')) {
      setField('themeOpacityNumber', Math.round(Number(value('themeOpacity')) * 100));
    }
    if (document.getElementById('backdropBlurNumber')) {
      setField('backdropBlurNumber', value('backdropBlur'));
    }
    if (document.getElementById('glowIntensityNumber')) {
      setField('glowIntensityNumber', value('glowIntensity'));
    }
    if (document.getElementById('queueScrollSpeedRange')) {
      const queueScrollSpeed = this.normalizeQueueScrollSpeedForDisplay(values && values.queueScrollSpeed);
      setField('queueScrollSpeed', queueScrollSpeed);
      setField('queueScrollSpeedRange', queueScrollSpeed);
    }
    if (document.getElementById('identityQueueScrollSpeedRange')) {
      const identityScrollSpeed = this.normalizeQueueScrollSpeedForDisplay(activeQueueSettings.scrollSpeed);
      setField('identityQueueScrollSpeed', identityScrollSpeed);
      setField('identityQueueScrollSpeedRange', identityScrollSpeed);
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
    if (!Number.isFinite(valueNumber)) return '20';
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
    if (/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(text)) {
      return '重新连接直播间失败：本地服务未响应，请重启 LIRA 后再试。';
    }
    if (/Unexpected end of JSON input|非 JSON/i.test(text)) {
      return text;
    }
    return text || '重新连接直播间失败，请稍后重试。';
  }
}

// 创建单例实例
export const formsService = new FormsService();
