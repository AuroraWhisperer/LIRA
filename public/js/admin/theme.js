import { value, setValue, localOverlayOrigin } from '../shared/utils.js';
import { formsService } from './forms.js';
import { stateService } from './state.js';
import { applyAdminQueueFontPreview } from './queue.js';
import { setOverlayStyle } from './theme-style-view.js';
import { publishTheme } from './legacy-admin-bridge.js';
// 编写人：Aurora
// 点歌板主题配置
('use strict');

import { renderPresetCards } from './theme-preset-cards.js';
import { createComponentConfigController } from './component-config-controller.js';
import { registerComponentSettings } from './component-settings-sync.js';
import { saveComponentSettings } from './component-settings-save.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { registerComponentPreview } from './component-preview-registry.js';
import { cloneComponentPanel, componentField } from './component-preview-panel.js';
import { bindQueueTheme } from './queue-theme-view.js';
import { collectQueueTheme, queueConfigFromSettings, queueSettingsPayload, pickQueueSettings } from './queue-theme-config.js';

export const theme = (() => {
  let controller = null;

  function initThemeForm() {
    if (controller) return controller;
    const form = document.getElementById('themeForm');
    if (!form) return;
    controller = createComponentConfigController({
      initial: queueConfigFromSettings(stateService.getAppState()?.settings || {}),
      persist: async (draft, changed) => {
        const settings = await saveComponentSettings(queueSettingsPayload(draft, changed));
        if (settings.overlayQueueStyle !== draft.overlayQueueStyle) throw new Error('服务端未保存点歌板样式，请更新服务后重试。');
        return queueConfigFromSettings(settings);
      },
    });
    bindQueueTheme(form, controller);
    controller.subscribe(({ draft }) => applyAdminQueueFontPreview(draft));
    registerComponentSettings('queue', controller, queueConfigFromSettings, pickQueueSettings);
    function createQueuePreview() {
      return { id: 'queue', title: '点歌板', controller,
        url: new URL('/queue?componentPreview=1', localOverlayOrigin()).href,
        size: () => [480, 800], projectConfig: pickQueueSettings,
        createPanel: (host, targetController = controller) => {
          const panel = cloneComponentPanel(form, 'preview-queue');
          componentField(panel, 'queueThemeActions').remove();
          componentField(panel, 'queueThemeSaveState').remove();
          host.append(panel);
          return bindQueueTheme(panel, targetController);
        },
        startData: ({ emit }) => {
          emit({ queue: { current: { song_name: '当前演唱 · 示例歌曲', requester_name: '示例观众' },
            waiting: Array.from({ length: 12 }, (_, index) => ({ song_name: `待唱歌曲 ${index + 1}`,
              requester_name: `示例观众 ${index + 1}`, is_pinned: index === 0 })) },
            superChats: [{ message: '这是一条示例留言', price: 30 }] });
        },
      };
    }
    registerComponentPreview('queue', createQueuePreview);
    document.getElementById('queueThemePreview').addEventListener('click', () => openComponentPreview(createQueuePreview()));
    return controller;
  }

  function collectTheme() {
    return collectQueueTheme(document);
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
