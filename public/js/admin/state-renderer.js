'use strict';

import { escapeHtml } from '../shared/utils.js';
import { formsService } from './forms.js';
import { getLegacyAdminModules } from './legacy-admin-bridge.js';
import {
  renderQueueState,
  renderSuperChatQueue,
  applyAdminQueueFontPreview,
} from './queue.js';

export function createAdminStateRenderer({
  renderQueue = renderQueueState,
  renderSuperChats = renderSuperChatQueue,
  renderSettings = fillSettings,
  renderQueueStyle = applyAdminQueueFontPreview,
  renderGifts = renderGiftPanel,
  renderLive = renderLiveStatus,
  renderCategories = (categories) =>
    getLegacyAdminModules().songs?.renderCategoryFilter?.(categories),
  renderSongCount = (count) => {
    document.getElementById('songCount').textContent =
      `歌库共 ${count || 0} 首`;
  },
} = {}) {
  return function renderAdminState({
    state,
    changedKeys = Object.keys(state),
  }) {
    const changed = new Set(changedKeys);
    // Settings must hydrate before the gift view reads its form controls.
    if (changed.has('settings')) {
      renderSettings(state.settings || {});
      renderQueueStyle(state.settings || {});
    }
    if (changed.has('queue')) renderQueue(state.queue);
    if (changed.has('superChats')) renderSuperChats(state.superChats || []);
    if (changed.has('liveStatus')) renderLive(state.liveStatus || {});
    if (changed.has('categories')) renderCategories(state.categories || []);
    if (changed.has('songCount')) renderSongCount(state.songCount);
    if (
      [
        'gifts',
        'giftSprint',
        'liveStatus',
        'bilibiliDiagnostics',
        'settings',
      ].some((key) => changed.has(key))
    ) {
      renderGifts(state);
    }
  };
}

function fillSettings(settings) {
  formsService.fillForm(settings);
  const giftToggle = document.getElementById('giftDetectToggle');
  if (giftToggle) giftToggle.checked = settings.enableGiftSprint !== 'false';
  const autoUpdateToggle = document.getElementById('autoUpdateToggle');
  const autoUpdateLabel = document.getElementById('autoUpdateLabel');
  if (autoUpdateToggle) {
    autoUpdateToggle.checked = settings.enableAutoUpdate === 'true';
    if (autoUpdateLabel)
      autoUpdateLabel.textContent = autoUpdateToggle.checked
        ? '已开启'
        : '已关闭';
  }
}

function renderGiftPanel(state) {
  getLegacyAdminModules().gifts?.renderGiftPanel?.(
    state.gifts || {},
    state.giftSprint || {},
    state.liveStatus || {},
    state.bilibiliDiagnostics || {},
    state.settings || {},
  );
}

function renderLiveStatus(live) {
  const node = document.getElementById('liveStatus');
  const owner = live.ownerName
    ? `<span class="owner-name">${escapeHtml(live.ownerName)}</span>`
    : '';
  const status = escapeHtml(live.message || '弹幕监听未启用');
  let html =
    live.connected && owner
      ? `${owner} ${status}`
      : `${status}${owner ? ` ${owner}` : ''}`;
  if (!live.connected && live.roomId)
    html += ` <span class="room-id-hint">· ${escapeHtml(live.roomId)}</span>`;
  node.innerHTML = html;
  node.className = live.connected
    ? 'pill good'
    : live.enabled
      ? 'pill warn'
      : 'pill';
}
