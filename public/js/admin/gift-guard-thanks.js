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
import { createComponentConfigController } from './component-config-controller.js';
import { saveComponentSettings, confirmComponentSettings } from './component-settings-save.js';

const settingIds = GUARD_THANKS_EFFECTS.flatMap(({ prefix }) => [`${prefix}Enabled`, `${prefix}TextMode`]);
const controllers = new Map();
let initialized = false;
let currentSettings = {};
const field = (effect, name) => document.getElementById(`${effect.prefix}${name}`);

function configFromSettings(effect, settings) {
  const values = readGuardThanksEffect(settings, effect);
  return { [`${effect.prefix}Enabled`]: String(values.enabled), [`${effect.prefix}TextMode`]: values.textMode };
}

export function initGuardThanks() {
  if (initialized) return;
  const panel = document.getElementById('guardThanksPanel');
  if (!panel) return;
  initialized = true;
  const markDraft = (event) => {
    if (!settingIds.includes(event.target.id)) return;
    const effect = GUARD_THANKS_EFFECTS.find(effect => event.target.id.startsWith(effect.prefix));
    controllers.get(effect.prefix).edit({
      [event.target.id]: event.target.id.endsWith('Enabled') ? String(event.target.checked) : event.target.value,
    });
  };
  for (const id of settingIds) document.getElementById(id).dataset.preserveDirty = 'true';
  panel.addEventListener('input', markDraft);
  panel.addEventListener('change', markDraft);
  const subscriptions = [];
  for (const effect of GUARD_THANKS_EFFECTS) {
    const fromSettings = settings => configFromSettings(effect, settings);
    const controller = createComponentConfigController({
      initial: fromSettings(currentSettings),
      persist: async draft => fromSettings(await saveComponentSettings(draft)),
      confirm: async () => fromSettings(await confirmComponentSettings()),
    });
    controllers.set(effect.prefix, controller);
    field(effect, 'SaveBtn').addEventListener('click', () => saveSettings(effect));
    field(effect, 'PlayBtn').addEventListener('click', () => playPreview(effect));
    subscriptions.push(controller.subscribe(state => renderEffect(effect, state)));
  }
  const receiveSettings = event => renderGuardThanks(event.detail || {});
  window.addEventListener('app:settings-state', receiveSettings);
  window.addEventListener('pagehide', () => {
    window.removeEventListener('app:settings-state', receiveSettings);
    subscriptions.forEach(stop => stop());
  }, { once: true });
}

export function renderGuardThanks(settings = {}) {
  currentSettings = settings;
  for (const effect of GUARD_THANKS_EFFECTS) {
    controllers.get(effect.prefix)?.receive(configFromSettings(effect, settings));
  }
}

function renderEffect(effect, state) {
  for (const name of ['Enabled', 'TextMode']) {
    const node = field(effect, name);
    if (name === 'Enabled') node.checked = state.draft[node.id] === 'true';
    else node.value = state.draft[node.id];
    node.dataset.dirty = String(state.draft[node.id] !== state.saved[node.id]);
  }
  field(effect, 'SaveBtn').disabled = state.saving;
  setStatus(effect);
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
  const controller = controllers.get(effect.prefix);
  if (!controller.getStatus().dirty) return;
  const saved = await controller.save();
  const state = controller.getState();
  currentSettings = { ...currentSettings, ...state.saved };
  if (saved) {
    const message = state.dirty ? `${effect.label}设置已保存，刚才的新修改还没保存。`
      : `${effect.label}设置已保存，${state.saved[`${effect.prefix}Enabled`] === 'true' ? '已启用' : '已关闭'}。`;
    setStatus(effect, message, 'success');
    if (state.dirty) toast(message, { type: 'success' });
  } else {
    const message = state.error || `${effect.label}设置没保存成功，修改还在，请再试一次。`;
    setStatus(effect, message, 'error');
    toast(message, { type: 'error' });
  }
}

function setStatus(effect, message = '', state = '') {
  const node = field(effect, 'SaveState');
  const current = controllers.get(effect.prefix).getStatus();
  node.textContent = message || current.error || (current.saving ? '正在保存…'
    : current.dirty ? '有未保存修改，点击“保存设置”后生效。' : '');
  node.dataset.state = state || (current.error ? 'error' : current.dirty ? 'pending' : '');
}

export function mountNauticalGuardToggle(host) {
  const label = previewElement('label', 'guard-thanks-switch switch-control');
  const input = previewElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', '启用航海旗帜');
  input.checked = readNauticalGuardEnabled(currentSettings);
  label.append(input, previewElement('span', 'switch-track'), previewElement('span', '', '启用'));
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
