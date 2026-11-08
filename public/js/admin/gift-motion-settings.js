import { api, toast } from '../shared/utils.js';
import { GIFT_MOTION_EFFECTS, GIFT_MOTION_DEFAULTS, GIFT_SWING_TEXT_PARTS, GIFT_SWING_TEXT_MODES } from '../shared/gift-motion-settings.js';
import { createGiftMotionSamples } from '../shared/gift-motion-samples.js';
import { initParameterRanges, refreshParameterRange } from '../shared/parameter-range.js';
import { prepareComponentPreviews } from './component-preview-registry.js';
import { getActiveComponentPreview } from './component-preview-session.js';
import { openComponentPreview } from './component-preview-dialog.js';

let initialized = false;
let currentSettings = {};
const dirty = new Set(); const saving = new Set();
const node = id => document.getElementById(id);
const keys = effect => [`${effect.prefix}Enabled`, `${effect.prefix}ThresholdRmb`,
  ...Object.keys(effect.fields).map(name => `${effect.prefix}${name}`)];
const value = key => key.endsWith('Enabled') ? String(node(key).checked) : node(key).value;

export function initGiftMotionSettings() {
  if (initialized || !node('giftDropSettings')) return;
  initialized = true;
  for (const effect of GIFT_MOTION_EFFECTS) {
    const host = node(`${effect.prefix}Fields`);
    for (const [name, field] of Object.entries(effect.fields)) {
      const label = document.createElement('div'); label.className = 'gift-effect-field';
      const title = document.createElement(field.options ? 'span' : 'label'); title.className = 'gift-effect-field-label'; title.textContent = field.label;
      const control = document.createElement('span'); control.className = 'gift-effect-field-control';
      const input = document.createElement('input'); input.id = `${effect.prefix}${name}`;
      if (!field.options) title.htmlFor = input.id;
      title.id = `${input.id}Label`;
      input.required = true;
      if (field.options) {
        input.type = 'hidden'; control.append(input);
        control.classList.add('gift-motion-text-options');
        control.setAttribute('role', 'group'); control.setAttribute('aria-labelledby', title.id);
        for (const [part, text] of Object.entries(GIFT_SWING_TEXT_PARTS)) {
          const option = document.createElement('label'); option.className = 'gift-motion-text-option';
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.textPart = part;
          option.append(checkbox, document.createTextNode(text)); control.append(option);
          checkbox.addEventListener('change', () => {
            const selected = [...control.querySelectorAll('[data-text-part]')].filter(node => node.checked).map(node => node.dataset.textPart);
            input.value = Object.entries(GIFT_SWING_TEXT_MODES).find(([, parts]) =>
              parts.length === selected.length && selected.every(part => parts.includes(part)))[0];
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
      } else {
        label.classList.add('gift-motion-parameter');
        input.type = 'range'; input.className = 'parameter-range';
        input.min = field.min; input.max = field.max; input.step = 1; input.dataset.unit = field.unit || '';
        input.setAttribute('aria-labelledby', title.id);
        const output = document.createElement('output'); output.className = 'gift-motion-value';
        output.id = `${input.id}Value`; output.htmlFor = input.id; control.append(output);
      }
      label.append(title, control);
      if (!field.options) {
        const row = document.createElement('div'); row.className = 'gift-motion-range';
        const minimum = document.createElement('span'); minimum.textContent = field.min;
        const maximum = document.createElement('span'); maximum.textContent = field.max;
        row.append(minimum, input, maximum); label.append(row);
      }
      host.append(label);
    }
    initParameterRanges(host);
    for (const key of keys(effect)) {
      const input = node(key); input.dataset.preserveDirty = 'true';
      const edit = () => { syncControl(key); syncDirty(key); status(effect); };
      input.addEventListener('input', edit); input.addEventListener('change', edit);
    }
    node(`${effect.prefix}SaveBtn`).addEventListener('click', () => save(effect));
    node(`${effect.prefix}PreviewBtn`).addEventListener('click', () => preview(effect));
  }
  window.addEventListener('app:settings-state', event => render(event.detail || {}));
  render(currentSettings);
}

function syncControl(key) {
  const input = node(key);
  if (input.type === 'range') {
    const text = `${input.value}${input.dataset.unit === '%' ? '' : ' '}${input.dataset.unit}`.trim();
    node(`${key}Value`).value = text;
    input.setAttribute('aria-valuetext', text); refreshParameterRange(input);
  } else if (input.type === 'hidden') {
    for (const checkbox of input.parentElement.querySelectorAll('[data-text-part]')) {
      checkbox.checked = GIFT_SWING_TEXT_MODES[input.value].includes(checkbox.dataset.textPart);
    }
  }
}

function syncDirty(key) {
  const saved = currentSettings[key] ?? GIFT_MOTION_DEFAULTS[key];
  const same = key.endsWith('Enabled') || node(key).type === 'hidden' ? value(key) === saved
    : value(key).trim() !== '' && Number(value(key)) === Number(saved);
  if (saving.has(key) || !same) dirty.add(key); else dirty.delete(key);
  node(key).dataset.dirty = String(dirty.has(key));
}

function render(settings) {
  currentSettings = settings;
  for (const effect of GIFT_MOTION_EFFECTS) {
    for (const key of keys(effect)) {
      if (!dirty.has(key)) {
        const saved = settings[key] ?? GIFT_MOTION_DEFAULTS[key];
        if (key.endsWith('Enabled')) node(key).checked = saved === 'true'; else node(key).value = saved;
      }
      syncControl(key);
      syncDirty(key);
    }
    status(effect);
  }
}

function status(effect, message = '', state = '') {
  const unsaved = keys(effect).some(key => dirty.has(key));
  const target = node(`${effect.prefix}SaveState`);
  target.textContent = message || (unsaved ? '有未保存修改，点击“保存设置”后生效。' : '');
  target.dataset.state = state || (unsaved ? 'pending' : '');
}

function valid(effect) {
  for (const key of keys(effect)) if (!node(key).reportValidity()) return false;
  return true;
}

async function save(effect) {
  const button = node(`${effect.prefix}SaveBtn`);
  if (button.disabled || !valid(effect)) return;
  const submitted = Object.fromEntries(keys(effect).map(key => [key, value(key)]));
  for (const key of keys(effect)) saving.add(key);
  button.disabled = true; status(effect, '正在保存…');
  try {
    await api('/api/settings', submitted, { notifyError: false });
    currentSettings = { ...currentSettings, ...submitted };
    for (const key of keys(effect)) { saving.delete(key); syncDirty(key); }
    const unsaved = keys(effect).some(key => dirty.has(key));
    status(effect, unsaved ? '设置已保存，刚才的新修改还没保存。' : '设置已保存。', 'success');
  } catch (error) {
    status(effect, error.message || '设置未保存，修改已保留，请重试。', 'error');
  } finally {
    for (const key of keys(effect)) { saving.delete(key); syncDirty(key); }
    button.disabled = false;
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
      item = { id: crypto.randomUUID(), type: 'gift-frame', name: effect.label, x: 0, y: 0,
        width: document.canvas.width, height: document.canvas.height, visible: true, locked: false,
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
