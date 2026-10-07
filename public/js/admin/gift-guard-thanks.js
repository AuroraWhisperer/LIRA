// 百宝箱 → 礼物姬 → 大航海感谢：各风格独立的设置与画布预览入口。
'use strict';

import { api, toast } from '../shared/utils.js';
import { GUARD_THANKS_EFFECTS, readGuardThanksEffect } from '../shared/guard-thanks-settings.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';

const settingIds = GUARD_THANKS_EFFECTS.flatMap(({ prefix }) => [`${prefix}Enabled`, `${prefix}TextMode`]);
const draftFields = new Set();
let initialized = false;
let currentSettings = {};
const field = (effect, name) => document.getElementById(`${effect.prefix}${name}`);

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
  for (const effect of GUARD_THANKS_EFFECTS) {
    field(effect, 'SaveBtn').addEventListener('click', () => saveSettings(effect));
    field(effect, 'PlayBtn').addEventListener('click', () => playPreview(effect));
  }
  window.addEventListener('app:settings-state', (event) => renderGuardThanks(event.detail || {}));
  renderGuardThanks(currentSettings);
}

export function renderGuardThanks(settings = {}) {
  currentSettings = settings;
  for (const effect of GUARD_THANKS_EFFECTS) {
    const enabled = field(effect, 'Enabled');
    if (!enabled) continue;
    const values = readGuardThanksEffect(settings, effect);
    if (!draftFields.has(enabled.id)) enabled.checked = values.enabled;
    const text = field(effect, 'TextMode');
    if (!draftFields.has(text.id)) text.value = values.textMode;
  }
}

function playPreview(effect) {
  const months = Number(field(effect, 'PreviewMonths').value);
  if (!Number.isSafeInteger(months) || months < 1 || months > 999) {
    setStatus(effect, '预览月数需为 1–999 的整数。', 'error');
    return;
  }
  const previewData = sceneExtraPreviewData('guard-thanks');
  const event = previewData.events[0];
  event.tier = field(effect, 'PreviewTier').value;
  event.userName = field(effect, 'PreviewUser')?.value.trim() || event.userName;
  event.months = months;
  event.style = effect.style;
  event.textMode = field(effect, 'TextMode').value;
  setStatus(effect, '', '');
  openComponentPreview({ id: 'guard-thanks', previewData });
}

async function saveSettings(effect) {
  const button = field(effect, 'SaveBtn');
  if (button.disabled) return;
  const enabledKey = `${effect.prefix}Enabled`;
  const textKey = `${effect.prefix}TextMode`;
  const submitted = {
    [enabledKey]: String(field(effect, 'Enabled').checked),
    [textKey]: field(effect, 'TextMode').value,
  };
  button.disabled = true;
  setStatus(effect, '正在保存…', '');
  try {
    await api('/api/settings', submitted, { notifyError: false });
    for (const id of [enabledKey, textKey]) {
      const node = document.getElementById(id);
      const current = id === enabledKey ? String(node.checked) : node.value;
      if (current === submitted[id]) {
        draftFields.delete(id);
        node.dataset.dirty = 'false';
      }
    }
    const dirty = [enabledKey, textKey].some(id => draftFields.has(id));
    const message = dirty ? `${effect.label}设置已保存，刚才的新修改还没保存。`
      : `${effect.label}设置已保存，${submitted[enabledKey] === 'true' ? '已启用' : '已关闭'}。`;
    setStatus(effect, message, 'success');
    toast(message, { type: 'success' });
    renderGuardThanks({ ...currentSettings, ...submitted });
  } catch (_) {
    const message = `${effect.label}设置没保存成功，修改还在，请再试一次。`;
    setStatus(effect, message, 'error');
    toast(message, { type: 'error' });
  } finally {
    button.disabled = false;
  }
}

function setStatus(effect, message, state) {
  const node = field(effect, 'SaveState');
  node.textContent = message;
  node.dataset.state = state;
}
