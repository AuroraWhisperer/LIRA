'use strict';

import { escapeHtml } from '../shared/utils.js';
import { formsService } from './forms.js';
import { receiveComponentSettings, projectComponentDrafts } from './component-settings-sync.js';
import { songs } from './songs.js';
import { renderSongCooldownControls } from './song-cooldown-settings.js';
import { renderQueueState, renderSuperChatQueue, applyAdminQueueFontPreview } from './queue.js';
import { isLiveStatusDegraded } from './live-status-presentation.js';

export function renderConnectionStatus(connectionState) {
  const status = document.getElementById('wsStatus');
  if (!status) return;
  status.hidden = connectionState === 'connected';
  if (status.hidden) return;
  status.textContent = connectionState === 'shutdown' ? '程序已退出' : '与本机服务的连接已断开，正在重连';
  status.className = 'pill warn';
}

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

function renderLiveStatus(live) {
  const node = document.getElementById('liveStatus');
  const owner = live.ownerName ? `<span class="owner-name">${escapeHtml(live.ownerName)}</span>` : '';
  const degraded = isLiveStatusDegraded(live);
  const message = degraded ? '已连接，弹幕可能延迟（正在恢复实时连接）'
    : live.message === '未开播，历史消息监听中' ? '未开播，正在接收弹幕'
      : live.message || '弹幕监听未启用';
  const status = escapeHtml(message);
  let html = live.connected && owner ? `${owner} ${status}` : `${status}${owner ? ` ${owner}` : ''}`;
  if (!live.connected && live.roomId) html += ` <span class="room-id-hint">· ${escapeHtml(live.roomId)}</span>`;
  node.innerHTML = html;
  node.className = degraded ? 'pill warn' : live.connected ? 'pill good' : live.enabled ? 'pill warn' : 'pill';
}
