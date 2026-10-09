// 组件 → 礼物姬 → 大航海感谢：各风格独立的设置与画布预览入口。
'use strict';

import { api, toast } from '../shared/utils.js';
import { GUARD_THANKS_EFFECTS, readGuardThanksEffect, readNauticalGuardEnabled } from '../shared/guard-thanks-settings.js';
import { previewElement } from './component-preview-surface.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';
import { prepareComponentPreviews } from './component-preview-registry.js';
import { getActiveComponentPreview } from './component-preview-session.js';
import { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } from '../shared/scene-extra-components.js';

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

async function playPreview(effect) {
  const button = field(effect, 'PlayBtn');
  if (button.disabled) return;
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
  button.disabled = true;
  try {
    const entries = await prepareComponentPreviews();
    const canvas = entries.find(entry => entry.id === 'canvas');
    if (!canvas?.controller.getState().loaded) throw new Error('画布尚未准备完成，请稍后重试。');
    await getActiveComponentPreview('browser-preview')?.syncCanvas();
    const document = canvas.controller.getState().draft.document;
    let item = document.items.find(item => item.type === 'guard-thanks'
      && item.appearance.config?.style === effect.style
      && !item.appearance.config.mediaStyle && !item.appearance.config.resourceStyle);
    if (!item) {
      if (document.items.filter(item => item.type !== 'text-box').length >= 32) throw new Error('当前场景已满，请在画布中新建场景。');
      const [defaultWidth, defaultHeight] = SCENE_EXTRA_COMPONENTS['guard-thanks'].size;
      const width = Math.min(defaultWidth, document.canvas.width);
      const height = Math.min(defaultHeight, document.canvas.height);
      item = { id: crypto.randomUUID(), type: 'guard-thanks', name: `大航海感谢 · ${effect.label}`,
        x: Math.round((document.canvas.width - width) / 2), y: Math.round((document.canvas.height - height) / 2),
        width, height, visible: true, locked: false,
        appearance: { mode: 'independent', config: { ...createSceneExtraDefaults('guard-thanks'), style: effect.style } } };
      document.items.push(item);
      canvas.controller.edit({ document });
    }
    openComponentPreview({ id: 'guard-thanks', previewData, selectedItemId: item.id });
  } catch (error) {
    setStatus(effect, error.message || '无法打开画布，请稍后重试。', 'error');
  } finally {
    button.disabled = false;
  }
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

export function mountNauticalGuardToggle(host) {
  const label = previewElement('label', 'guard-thanks-switch switch-control');
  const input = previewElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', '启用航海旗帜');
  input.checked = readNauticalGuardEnabled(currentSettings);
  label.append(input, previewElement('span', 'switch-track'), document.createTextNode('启用'));
  const status = previewElement('span', 'hint'); status.setAttribute('role', 'status');
  host.append(label, status);
  const receive = event => { if (!input.disabled) input.checked = readNauticalGuardEnabled(event.detail || {}); };
  window.addEventListener('app:settings-state', receive);
  input.addEventListener('change', async () => {
    const enabled = input.checked;
    input.disabled = true; status.textContent = '正在保存…';
    try {
      await api('/api/settings', { guardThanksNauticalEnabled: String(enabled) }, { notifyError: false });
      currentSettings = { ...currentSettings, guardThanksNauticalEnabled: String(enabled) };
      status.textContent = enabled ? '已启用' : '已关闭';
    } catch {
      input.checked = !enabled; status.textContent = '启用设置未保存，请重试。';
    } finally { input.disabled = false; }
  });
  return { dispose() { window.removeEventListener('app:settings-state', receive); label.remove(); status.remove(); } };
}
