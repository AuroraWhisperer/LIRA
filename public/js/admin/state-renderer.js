'use strict';

import { formsService } from './forms.js';
import { receiveComponentSettings, projectComponentDrafts } from './component-settings-sync.js';
import { songs } from './songs.js';
import { renderSongCooldownControls } from './song-cooldown-settings.js';
import { renderQueueState, renderSuperChatQueue, applyAdminQueueFontPreview } from './queue.js';
import { renderLiveStatus, renderConnectionStatus } from './topbar-status.js';
export { renderConnectionStatus };

export function createAdminStateRenderer({
  renderQueue = renderQueueState,
  renderSuperChats = renderSuperChatQueue,
  renderSettings = fillSettings,
  renderQueueStyle = applyAdminQueueFontPreview,
  renderGifts,
  renderLive = renderLiveStatus,
  renderCategories = songs.renderCategoryFilter,
  renderSongCount = (count) => {
    document.getElementById('songCount').textContent = `歌库共 ${count || 0} 首`;
  },
} = {}) {
  let queueSettingsSignature;
  return function renderAdminState({ state, changedKeys = Object.keys(state) }) {
    const changed = new Set(changedKeys);
    // Settings must hydrate before the gift view reads its form controls.
    if (changed.has('settings')) {
      renderSettings(state.settings || {});
      renderQueueStyle(projectComponentDrafts(state.settings || {}));
    }
    if (changed.has('queue') || changed.has('settings')) {
      const settings = state.settings || {};
      const signature = JSON.stringify([settings.paused, settings.danmakuMonitoringEnabled]);
      if (changed.has('queue') || signature !== queueSettingsSignature) {
        renderQueue(state.queue, settings);
        queueSettingsSignature = signature;
      }
    }
    if (changed.has('superChats')) renderSuperChats(state.superChats || []);
    if (changed.has('liveStatus')) renderLive(state.liveStatus || {});
    if (changed.has('categories')) renderCategories(state.categories || []);
    if (changed.has('songCount')) renderSongCount(state.songCount);
    if (
      ['gifts', 'giftSprint', 'liveStatus', 'bilibiliDiagnostics', 'settings', 'blindBoxMapping'].some((key) =>
        changed.has(key),
      )
    ) {
      renderGifts(state, changedKeys);
    }
  };
}

function fillSettings(settings) {
  receiveComponentSettings(settings);
  formsService.fillForm(projectComponentDrafts(settings));
  renderSongCooldownControls();
  for (const key of ['danmakuMonitoringEnabled', 'giftMonitoringEnabled']) {
    const toggle = document.getElementById(key);
    if (toggle && !toggle.disabled) toggle.checked = (settings[key] ?? settings.enableBilibili) !== 'false';
  }
  const giftToggle = document.getElementById('giftDetectToggle');
  if (giftToggle) giftToggle.checked = settings.enableGiftSprint !== 'false';
  const autoUpdateToggle = document.getElementById('autoUpdateToggle');
  const autoUpdateLabel = document.getElementById('autoUpdateLabel');
  if (autoUpdateToggle) {
    autoUpdateToggle.checked = settings.enableAutoUpdate === 'true';
    if (autoUpdateLabel) autoUpdateLabel.textContent = autoUpdateToggle.checked ? '已开启' : '已关闭';
  }
}
