import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';
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
    let saveTimer;
    let pendingSave;
    const autoSave = () => {
      clearTimeout(saveTimer);
      if (pendingSave) return pendingSave;
      pendingSave = (async () => {
        while (controller.getStatus().dirty) {
          if (!keys(effect).every(key => node(key).checkValidity())) return false;
          if (!await controller.save()) {
            toast(`${effect.label}设置未保存：${controller.getStatus().error || '请调整后重试。'}`, { type: 'error' });
            return false;
          }
        }
        return true;
      })().finally(() => { pendingSave = null; });
      return pendingSave;
    };
    const edit = patch => {
      controller.edit(patch);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { void autoSave(); }, 180);
    };
    const fields = node(`${effect.prefix}Fields`);
    const view = mountGiftMotionParameters(fields, effect, { onEdit: edit });
    fields.addEventListener('change', () => { void autoSave(); });
    parameterViews.set(effect.prefix, view);
    for (const key of keys(effect)) {
      const input = node(key); input.dataset.preserveDirty = 'true';
      if (view.inputs.has(key)) continue;
      input.addEventListener('input', () => edit({ [key]: value(key) }));
      input.addEventListener('change', () => { edit({ [key]: value(key) }); void autoSave(); });
    }
    node(`${effect.prefix}PreviewBtn`).addEventListener('click', () => preview(effect));
    const source = node(`${effect.prefix}CopyBtn`);
    source.textContent = `${localOverlayOrigin()}/gift-effects?giftStyle=${effect.style}`;
    source.addEventListener('click', () => copySource(effect));
    subscriptions.push(() => clearTimeout(saveTimer));
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
}

function valid(effect) {
  for (const key of keys(effect)) if (!node(key).reportValidity()) return false;
  return true;
}

async function copySource(effect) {
  const button = node(`${effect.prefix}CopyBtn`);
  if (button.disabled) return;
  button.disabled = true;
  try {
    await copyText(button.textContent);
    const component = SCENE_EXTRA_COMPONENTS['gift-frame'];
    const variant = component.variants.find(variant => variant.value === effect.style);
    const [width, height] = variant.size || component.size;
    toast(`${effect.label}浏览器源地址已复制；来源尺寸设为 ${width} × ${height}。`);
  } catch (error) {
    toast(error.message || '地址复制失败，请重试。', { type: 'error' });
  } finally { button.disabled = false; }
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
    toast(error.message || '无法打开预览，请重试。', { type: 'error' });
  } finally { button.disabled = false; }
}
