// 百宝箱 → 礼物姬 → 大航海感谢：触发设置与画布预览入口。
'use strict';

import { api, toast } from '../shared/utils.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';

const settingIds = ['guardThanksEnabled', 'guardThanksTextMode', 'guardThanksStyle'];
const draftFields = new Set();
let initialized = false;
let currentSettings = {};

export function initGuardThanks() {
  if (initialized) return;
  const panel = document.getElementById('guardThanksPanel');
  if (!panel) return;
  initialized = true;
  const markDraft = (event) => {
    if (!settingIds.includes(event.target.id)) return;
    draftFields.add(event.target.id);
    event.target.dataset.dirty = 'true';
  };
  for (const id of settingIds) document.getElementById(id).dataset.preserveDirty = 'true';
  panel.addEventListener('input', markDraft);
  panel.addEventListener('change', markDraft);

  document.getElementById('guardThanksSaveBtn').addEventListener('click', saveSettings);
  document.getElementById('guardThanksPlayBtn').addEventListener('click', playPreview);
  window.addEventListener('app:settings-state', (event) => renderGuardThanks(event.detail || {}));
  renderGuardThanks(currentSettings);
}

export function renderGuardThanks(settings = {}) {
  currentSettings = settings;
  const enabled = document.getElementById('guardThanksEnabled');
  if (!enabled) return;
  if (!draftFields.has('guardThanksEnabled')) enabled.checked = settings.guardThanksEnabled === 'true';
  if (!draftFields.has('guardThanksTextMode')) {
    document.getElementById('guardThanksTextMode').value = settings.guardThanksTextMode || 'bilingual';
  }
  if (!draftFields.has('guardThanksStyle')) {
    document.getElementById('guardThanksStyle').value = settings.guardThanksStyle || 'aurora';
  }
  const state = document.getElementById('guardThanksSettingsState');
  state.textContent = enabled.checked ? '已启用' : '未启用';
  state.dataset.state = enabled.checked ? 'enabled' : 'disabled';
}

function playPreview() {
  const months = Number(document.getElementById('guardThanksPreviewMonths').value);
  if (!Number.isSafeInteger(months) || months < 1 || months > 999) {
    setStatus('预览月数需为 1–999 的整数。', 'error');
    return;
  }
  const previewData = sceneExtraPreviewData('guard-thanks');
  const event = previewData.events[0];
  event.tier = document.getElementById('guardThanksPreviewTier').value;
  event.userName = document.getElementById('guardThanksPreviewUser').value.trim() || event.userName;
  event.months = months;
  event.style = document.getElementById('guardThanksStyle').value;
  setStatus('', '');
  openComponentPreview({ id: 'guard-thanks', previewData });
}

async function saveSettings() {
  const submitted = {
    guardThanksEnabled: String(document.getElementById('guardThanksEnabled').checked),
    guardThanksTextMode: document.getElementById('guardThanksTextMode').value,
    guardThanksStyle: document.getElementById('guardThanksStyle').value,
  };
  try {
    await api('/api/settings', submitted, { notifyError: false });
    for (const id of settingIds) {
      const node = document.getElementById(id);
      const current = id === 'guardThanksEnabled' ? String(node.checked) : node.value;
      if (current === submitted[id]) {
        draftFields.delete(id);
        node.dataset.dirty = 'false';
      }
    }
    const message = draftFields.size ? '大航海感谢设置已保存，刚才的新修改还没保存。'
      : submitted.guardThanksEnabled === 'true' ? '大航海感谢已开启，之后上舰会播放感谢动画。' : '大航海感谢已关闭。';
    setStatus(message, 'success');
    toast(message, { type: 'success' });
    renderGuardThanks({ ...currentSettings, ...submitted });
  } catch (_) {
    const message = '大航海感谢设置没保存成功，修改还在，请再试一次。';
    setStatus(message, 'error');
    toast(message, { type: 'error' });
  }
}

function setStatus(message, state) {
  const node = document.getElementById('guardThanksSaveState');
  node.textContent = message;
  node.dataset.state = state;
}
