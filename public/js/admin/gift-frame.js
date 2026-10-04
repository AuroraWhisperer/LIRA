// 百宝箱 → 礼物姬：礼物四方边框的持久化设置与预览。
'use strict';

import { api, toast } from '../shared/utils.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';

let initialized = false;
let currentSettings = {};
const draftFields = new Set();
const settingIds = ['giftFrameEnabled', 'giftFrameThresholdRmb'];

export function initGiftFrame() {
  if (initialized) return;
  const root = document.getElementById('otherGiftFeature');
  const enabled = document.getElementById('giftFrameEnabled');
  if (!root || !enabled) return;
  const markDraft = (event) => {
    if (settingIds.includes(event.target.id)) {
      draftFields.add(event.target.id);
      event.target.dataset.dirty = 'true';
    }
  };
  for (const id of settingIds) document.getElementById(id).dataset.preserveDirty = 'true';
  root.addEventListener('input', markDraft);
  root.addEventListener('change', markDraft);

  document.getElementById('giftFrameSaveBtn').addEventListener('click', saveSettings);
  document.getElementById('giftFramePreviewBtn').addEventListener('click', playPreview);
  window.addEventListener('app:settings-state', (event) => renderGiftFrame(event.detail || {}));
  initialized = true;
  renderGiftFrame(currentSettings);
}

export function renderGiftFrame(settings = {}) {
  currentSettings = settings;
  const enabled = document.getElementById('giftFrameEnabled');
  if (!enabled) return;
  if (!draftFields.has('giftFrameEnabled')) {
    enabled.checked = settings.giftFrameEnabled === 'true';
  }
  for (const [id, fallback] of [
    ['giftFrameThresholdRmb', '20'],
  ]) {
    if (!draftFields.has(id)) document.getElementById(id).value = settings[id] || fallback;
  }
}

async function saveSettings() {
  const threshold = Number(document.getElementById('giftFrameThresholdRmb').value);
  if (!Number.isFinite(threshold) || threshold < 0) {
    setStatus('金额必须是大于等于 0 的数字。', 'error');
    return;
  }
  const submitted = Object.fromEntries(
    settingIds.map((id) => [
      id,
      id === 'giftFrameEnabled' ? String(document.getElementById(id).checked) : document.getElementById(id).value,
    ]),
  );
  const values = {
    ...submitted,
    giftFrameThresholdRmb: threshold.toFixed(2),
  };
  try {
    await api('/api/settings', values, { notifyError: false });
    for (const id of settingIds) {
      const current =
        id === 'giftFrameEnabled' ? String(document.getElementById(id).checked) : document.getElementById(id).value;
      if (current === submitted[id]) {
        draftFields.delete(id);
        document.getElementById(id).dataset.dirty = 'false';
      }
    }
    const message = draftFields.size ? '礼物边框设置已保存，刚才的新修改还没保存。' : '礼物边框设置已保存。';
    setStatus(message, 'success');
    toast(message, { type: 'success' });
    renderGiftFrame({ ...currentSettings, ...values });
  } catch (_) {
    const message = '礼物边框设置没保存成功，修改还在，请再试一次。';
    setStatus(message, 'error');
    toast(message, { type: 'error' });
  }
}

function playPreview() {
  const num = Number(document.getElementById('giftFramePreviewNum').value);
  if (!Number.isSafeInteger(num) || num <= 0) {
    setStatus('预览数量必须是正整数。', 'error');
    return;
  }
  const previewData = sceneExtraPreviewData('gift-frame');
  const event = previewData.events[0];
  event.userName = document.getElementById('giftFramePreviewUser').value.trim() || event.userName;
  event.giftName = document.getElementById('giftFramePreviewGift').value.trim() || event.giftName;
  event.num = num;
  setStatus('', '');
  openComponentPreview({ id: 'gift-frame', previewData });
}

function setStatus(message, state) {
  const node = document.getElementById('giftFrameSaveState');
  if (!node) return;
  node.textContent = message;
  node.dataset.state = state;
}
