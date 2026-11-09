import { toast } from '../shared/utils.js';
import { GIFT_MOTION_EFFECTS, GIFT_MOTION_DEFAULTS, giftMotionSettingKeys } from '../shared/gift-motion-settings.js';
import { createGiftMotionSamples } from '../shared/gift-motion-samples.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';
import { mountGiftMotionParameters } from './gift-motion-parameters.js';
import { prepareComponentPreviews } from './component-preview-registry.js';
import { getActiveComponentPreview } from './component-preview-session.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { createComponentConfigController } from './component-config-controller.js';
import { saveComponentSettings, confirmComponentSettings } from './component-settings-save.js';

let initialized = false;
const controllers = new Map();
const node = id => document.getElementById(id);
const keys = giftMotionSettingKeys;
const parameterViews = new Map();
const value = key => key.endsWith('Enabled') ? String(node(key).checked) : node(key).value;
const configFromSettings = (effect, settings) => Object.fromEntries(keys(effect).map(key => [key, settings[key] ?? GIFT_MOTION_DEFAULTS[key]]));

export function initGiftMotionSettings() {
  if (initialized || !node('giftDropSettings')) return;
  initialized = true;
  const subscriptions = [];
  for (const effect of GIFT_MOTION_EFFECTS) {
    const fromSettings = settings => configFromSettings(effect, settings);
    const controller = createComponentConfigController({
      initial: fromSettings({}),
      persist: async (_draft, patch) => fromSettings(await saveComponentSettings(patch)),
      confirm: async () => fromSettings(await confirmComponentSettings()),
    });
    controllers.set(effect.prefix, controller);
    const view = mountGiftMotionParameters(node(`${effect.prefix}Fields`), effect, { onEdit: patch => controller.edit(patch) });
    parameterViews.set(effect.prefix, view);
    for (const key of keys(effect)) {
      const input = node(key); input.dataset.preserveDirty = 'true';
      if (view.inputs.has(key)) continue;
      const edit = () => controller.edit({ [key]: value(key) });
      input.addEventListener('input', edit); input.addEventListener('change', edit);
    }
    node(`${effect.prefix}SaveBtn`).addEventListener('click', () => save(effect));
    node(`${effect.prefix}PreviewBtn`).addEventListener('click', () => preview(effect));
    subscriptions.push(controller.subscribe(state => renderEffect(effect, state)));
  }
  const receiveSettings = event => {
    const settings = event.detail || {};
    for (const effect of GIFT_MOTION_EFFECTS) controllers.get(effect.prefix).receive(configFromSettings(effect, settings));
  };
  window.addEventListener('app:settings-state', receiveSettings);
  window.addEventListener('pagehide', () => {
    window.removeEventListener('app:settings-state', receiveSettings);
    subscriptions.forEach(stop => stop()); parameterViews.forEach(view => view.dispose());
  }, { once: true });
}

function syncControl(key) {
  for (const view of parameterViews.values()) if (view.inputs.has(key)) view.sync(key);
}

function renderEffect(effect, state) {
  for (const key of keys(effect)) {
    const input = node(key);
    if (key.endsWith('Enabled')) input.checked = state.draft[key] === 'true';
    else if (input.value !== state.draft[key]) input.value = state.draft[key];
    input.dataset.dirty = String(state.draft[key] !== state.saved[key]);
    syncControl(key);
  }
  node(`${effect.prefix}SaveBtn`).disabled = state.saving;
  status(effect);
}

function status(effect, message = '', state = '') {
  const current = controllers.get(effect.prefix).getStatus();
  const target = node(`${effect.prefix}SaveState`);
  target.textContent = message || current.error || (current.saving ? '正在保存…'
    : current.dirty ? '有未保存修改，点击“保存设置”后生效。' : '');
  target.dataset.state = state || (current.error ? 'error' : current.dirty ? 'pending' : '');
}

function valid(effect) {
  for (const key of keys(effect)) if (!node(key).reportValidity()) return false;
  return true;
}

async function save(effect) {
  const button = node(`${effect.prefix}SaveBtn`);
  if (button.disabled || !valid(effect)) return;
  const controller = controllers.get(effect.prefix);
  if (!controller.getStatus().dirty) return;
  if (await controller.save()) {
    const unsaved = controller.getStatus().dirty;
    status(effect, unsaved ? '设置已保存，刚才的新修改还没保存。' : '设置已保存。', 'success');
  }
}

async function preview(effect) {
  const button = node(`${effect.prefix}PreviewBtn`);
  if (button.disabled || !valid(effect)) return;
  button.disabled = true;
  try {
    const entries = await prepareComponentPreviews();
    const canvas = entries.find(entry => entry.id === 'canvas');
    if (!canvas?.controller.getState().loaded) throw new Error('画布尚未准备完成，请稍后重试。');
    await getActiveComponentPreview('browser-preview')?.syncCanvas();
    const document = canvas.controller.getState().draft.document;
    let item = document.items.find(item => item.type === 'gift-frame' && item.appearance.config?.style === effect.style
      && !item.appearance.config.mediaStyle && !item.appearance.config.resourceStyle);
    if (!item) {
      if (document.items.filter(item => item.type !== 'text-box').length >= 32) throw new Error('当前场景已满，请在画布中新建场景。');
      const variant = SCENE_EXTRA_COMPONENTS['gift-frame'].variants.find(variant => variant.value === effect.style);
      const height = Math.min(document.canvas.height, variant.size?.[1] || document.canvas.height);
      item = { id: crypto.randomUUID(), type: 'gift-frame', name: effect.label, x: 0, y: document.canvas.height - height,
        width: document.canvas.width, height, visible: true, locked: false,
        appearance: { mode: 'independent', config: { style: effect.style } } };
      document.items.push(item); canvas.controller.edit({ document });
    }
    const settings = Object.fromEntries(keys(effect).map(key => [key, value(key)]));
    openComponentPreview({ id: 'gift-frame', selectedItemId: item.id,
      previewData: { preview: true, events: createGiftMotionSamples(effect.style, settings) } });
  } catch (error) {
    status(effect, error.message || '无法打开预览，请重试。', 'error'); toast(error.message, { type: 'error' });
  } finally { button.disabled = false; }
}
