// 百宝箱 → 礼物姬 → 大航海感谢：触发设置与画布预览入口。
'use strict';

import { api } from '../shared/utils.js';
import { openComponentPreview } from './component-preview-dialog.js';

const settingIds = ['guardThanksEnabled', 'guardThanksTextMode'];
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
  document.getElementById('guardThanksPlayBtn').addEventListener('click', () => openComponentPreview({ id: 'guard-thanks' }));
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
  const state = document.getElementById('guardThanksSettingsState');
  state.textContent = enabled.checked ? '已启用' : '未启用';
  state.dataset.state = enabled.checked ? 'enabled' : 'disabled';
}

async function saveSettings() {
  const submitted = {
    guardThanksEnabled: String(document.getElementById('guardThanksEnabled').checked),
    guardThanksTextMode: document.getElementById('guardThanksTextMode').value,
  };
  try {
    await api('/api/settings', submitted);
    for (const id of settingIds) {
      const node = document.getElementById(id);
      const current = id === 'guardThanksEnabled' ? String(node.checked) : node.value;
      if (current === submitted[id]) {
        draftFields.delete(id);
        node.dataset.dirty = 'false';
      }
    }
    setStatus(
      submitted.guardThanksEnabled === 'true' ? '已保存，之后开通的大航海会播放感谢动画。' : '已保存，大航海感谢已关闭。',
      'success',
    );
    renderGuardThanks({ ...currentSettings, ...submitted });
  } catch (_) {
    setStatus('保存失败，请稍后重试。', 'error');
  }
}

function setStatus(message, state) {
  const node = document.getElementById('guardThanksSaveState');
  node.textContent = message;
  node.dataset.state = state;
}
