import { stateService } from './state.js';
import { applyAdminQueueFontPreview } from './queue.js';
import { setOverlayStyle } from './theme-style-view.js';
// 编写人：Aurora
// 点歌板主题配置
('use strict');

import { renderPresetCards } from './theme-preset-cards.js';
import { createComponentConfigController } from './component-config-controller.js';
import { registerComponentSettings } from './component-settings-sync.js';
import { saveComponentSettings, confirmComponentSettings } from './component-settings-save.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { registerComponentPreview } from './component-preview-registry.js';
import { createQueuePreview } from './queue-preview.js';
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
      confirm: async () => queueConfigFromSettings(await confirmComponentSettings()),
      persist: async (draft, changed) => {
        const settings = await saveComponentSettings(queueSettingsPayload(draft, changed));
        if (settings.overlayQueueStyle !== draft.overlayQueueStyle) throw new Error('服务端未保存点歌板样式，请更新服务后重试。');
        return queueConfigFromSettings(settings);
      },
    });
    bindQueueTheme(form, controller);
    controller.subscribe(({ draft }) => applyAdminQueueFontPreview(draft));
    registerComponentSettings('queue', controller, queueConfigFromSettings, pickQueueSettings);
    const getQueuePreview = () => createQueuePreview({ controller });
    registerComponentPreview('queue', getQueuePreview);
    document.getElementById('queueThemePreview').addEventListener('click', () => openComponentPreview(getQueuePreview()));
    return controller;
  }

  function collectTheme() {
    return collectQueueTheme(document);
  }

  return {
    initThemeForm,
    collectTheme,
    setOverlayStyle,
    renderPresetCards,
  };
})();
