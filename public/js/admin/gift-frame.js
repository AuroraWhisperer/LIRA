// 百宝箱 → 礼物姬：各全屏礼物感谢特效独立的持久化设置与预览。
'use strict';

import { api, toast } from '../shared/utils.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';

// 每个特效自成一组：设置键、控件 id 和预览输入都只属于自己。
const EFFECTS = [
  {
    label: '全屏礼物感谢',
    themeId: 'woodland-bloom',
    enabledKey: 'giftFrameEnabled',
    thresholdKey: 'giftFrameThresholdRmb',
    fallback: '20',
    ids: {
      enabled: 'giftFrameEnabled',
      threshold: 'giftFrameThresholdRmb',
      save: 'giftFrameSaveBtn',
      status: 'giftFrameSaveState',
      previewUser: 'giftFramePreviewUser',
      previewGift: 'giftFramePreviewGift',
      previewNum: 'giftFramePreviewNum',
      previewBtn: 'giftFramePreviewBtn',
    },
  },
];

let initialized = false;
let currentSettings = {};
const draftFields = new Set();
const settingIds = EFFECTS.flatMap((effect) => [effect.enabledKey, effect.thresholdKey]);

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

  for (const effect of EFFECTS) {
    document.getElementById(effect.ids.save).addEventListener('click', () => saveSettings(effect));
    document.getElementById(effect.ids.previewBtn).addEventListener('click', () => playPreview(effect));
  }
  window.addEventListener('app:settings-state', (event) => renderGiftFrame(event.detail || {}));
  initialized = true;
  renderGiftFrame(currentSettings);
}

export function renderGiftFrame(settings = {}) {
  currentSettings = settings;
  if (!document.getElementById('giftFrameEnabled')) return;
  for (const effect of EFFECTS) {
    const { enabled, threshold } = effect.ids;
    if (!draftFields.has(effect.enabledKey)) {
      document.getElementById(enabled).checked = settings[effect.enabledKey] === 'true';
    }
    if (!draftFields.has(effect.thresholdKey)) {
      document.getElementById(threshold).value = settings[effect.thresholdKey] || effect.fallback;
    }
  }
}

async function saveSettings(effect) {
  const { enabled, threshold, status } = effect.ids;
  const amount = Number(document.getElementById(threshold).value);
  if (!Number.isFinite(amount) || amount < 0) {
    setStatus(status, '金额必须是大于等于 0 的数字。', 'error');
    return;
  }
  const submitted = {
    [effect.enabledKey]: String(document.getElementById(enabled).checked),
    [effect.thresholdKey]: document.getElementById(threshold).value,
  };
  const values = { ...submitted, [effect.thresholdKey]: amount.toFixed(2) };
  try {
    await api('/api/settings', values, { notifyError: false });
    renderGiftFrame({ ...currentSettings, ...values });
    for (const [id, key] of [[enabled, effect.enabledKey], [threshold, effect.thresholdKey]]) {
      const current = id === enabled ? String(document.getElementById(id).checked) : document.getElementById(id).value;
      if (current === submitted[key]) {
        draftFields.delete(key);
        document.getElementById(id).dataset.dirty = 'false';
      }
    }
    const message = draftFields.size
      ? `${effect.label}设置已保存，刚才的新修改还没保存。`
      : `${effect.label}设置已保存。`;
    setStatus(status, message, 'success');
    toast(message, { type: 'success' });
  } catch (_) {
    const message = `${effect.label}设置没保存成功，修改还在，请再试一次。`;
    setStatus(status, message, 'error');
    toast(message, { type: 'error' });
  }
}

function playPreview(effect) {
  const { previewUser, previewGift, previewNum, status } = effect.ids;
  const num = Number(document.getElementById(previewNum).value);
  if (!Number.isSafeInteger(num) || num <= 0) {
    setStatus(status, '预览数量必须是正整数。', 'error');
    return;
  }
  const base = sceneExtraPreviewData('gift-frame');
  const event = { ...base.events[0], themeId: effect.themeId };
  event.userName = document.getElementById(previewUser).value.trim() || event.userName;
  event.giftName = document.getElementById(previewGift).value.trim() || event.giftName;
  event.num = num;
  const previewData = { ...base, events: [event] };
  setStatus(status, '', '');
  openComponentPreview({ id: 'gift-frame', previewData });
}

function setStatus(id, message, state) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message;
  node.dataset.state = state;
}
