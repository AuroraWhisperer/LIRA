// 百宝箱 → 礼物姬：礼物四方边框的持久化设置与预览。
'use strict';

import { api, copyText, localOverlayOrigin, toast } from '../shared/utils.js';

let initialized = false;
let currentSettings = {};

export function initGiftFrame() {
  if (initialized) return;
  const root = document.getElementById('otherGiftFeature');
  const enabled = document.getElementById('giftFrameEnabled');
  if (!root || !enabled) return;

  const overlayUrl = `${localOverlayOrigin(location)}/gift-effects`;
  document.getElementById('giftFrameOverlayUrl').textContent = overlayUrl;
  document.getElementById('giftFrameSaveBtn').addEventListener('click', saveSettings);
  document.getElementById('giftFramePreviewBtn').addEventListener('click', playPreview);
  document.getElementById('giftFrameCopyBtn').addEventListener('click', async () => {
    await copyText(overlayUrl);
    toast('礼物边框地址已复制');
  });
  document.getElementById('giftFrameOpenBtn').addEventListener('click', () => {
    window.open(`${overlayUrl}?preview=1&debug=1`, 'liraGiftFramePreview');
  });
  window.addEventListener('app:settings-state', (event) => renderGiftFrame(event.detail || {}));
  initialized = true;
  renderGiftFrame(currentSettings);
}

export function renderGiftFrame(settings = {}) {
  currentSettings = settings;
  const enabled = document.getElementById('giftFrameEnabled');
  if (!enabled) return;
  enabled.checked = settings.giftFrameEnabled === 'true';
  document.getElementById('giftFrameThresholdRmb').value = settings.giftFrameThresholdRmb || '20';
  document.getElementById('giftFrameTheme').value = settings.giftFrameTheme || 'woodland-bloom';
  document.getElementById('giftFrameMotionMode').value = settings.giftFrameMotionMode || 'auto';
  const state = document.getElementById('giftFrameSettingsState');
  state.textContent = enabled.checked ? '已启用' : '未启用';
  state.dataset.state = enabled.checked ? 'enabled' : 'disabled';
}

async function saveSettings() {
  const threshold = Number(document.getElementById('giftFrameThresholdRmb').value);
  if (!Number.isFinite(threshold) || threshold < 0) {
    setStatus('金额必须是大于等于 0 的数字。', 'error');
    return;
  }
  try {
    await api('/api/settings', {
      giftFrameEnabled: document.getElementById('giftFrameEnabled').checked ? 'true' : 'false',
      giftFrameThresholdRmb: threshold.toFixed(2),
      giftFrameTheme: document.getElementById('giftFrameTheme').value,
      giftFrameMotionMode: document.getElementById('giftFrameMotionMode').value
    });
    setStatus('已保存，下一笔达到金额的最终礼物会触发。', 'success');
    renderGiftFrame({
      ...currentSettings,
      giftFrameEnabled: document.getElementById('giftFrameEnabled').checked ? 'true' : 'false',
      giftFrameThresholdRmb: threshold.toFixed(2),
      giftFrameTheme: document.getElementById('giftFrameTheme').value,
      giftFrameMotionMode: document.getElementById('giftFrameMotionMode').value
    });
  } catch (_) {
    setStatus('保存失败，请稍后重试。', 'error');
  }
}

async function playPreview() {
  const amount = Number(document.getElementById('giftFramePreviewAmount').value);
  const num = Number(document.getElementById('giftFramePreviewNum').value);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(num) || num <= 0) {
    setStatus('预览金额和数量需要填写有效值。', 'error');
    return;
  }
  try {
    await api('/api/gifts/frame/preview', {
      userName: document.getElementById('giftFramePreviewUser').value,
      giftName: document.getElementById('giftFramePreviewGift').value,
      num,
      totalPriceRmb: amount,
      themeId: document.getElementById('giftFrameTheme').value,
      motionMode: document.getElementById('giftFrameMotionMode').value
    });
    setStatus('预览已发送到礼物边框地址。', 'success');
  } catch (_) {
    setStatus('预览发送失败，请确认投屏页面已打开。', 'error');
  }
}

function setStatus(message, state) {
  const node = document.getElementById('giftFrameSaveState');
  if (!node) return;
  node.textContent = message;
  node.dataset.state = state;
}
