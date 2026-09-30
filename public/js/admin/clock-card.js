'use strict';

import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';
import { CLOCK_STYLE_LABELS, FLIP_PALETTES, clockSettingsPayload, clockConfigFromSettings } from '../shared/clock-settings.js';
import { createComponentConfigController, componentSaveMessage } from './component-config-controller.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { registerComponentPreview } from './component-preview-registry.js';
import { cloneComponentPanel, componentField } from './component-preview-panel.js';
import { registerComponentSettings } from './component-settings-sync.js';
import { saveComponentSettings } from './component-settings-save.js';

const CLOCK_STYLE_VALUES = new Set(Object.keys(CLOCK_STYLE_LABELS));
let initialized = false;

function buildClockUrl(baseUrl, config) {
  const url = new URL(baseUrl);
  const params = url.searchParams;
  params.set('style', CLOCK_STYLE_VALUES.has(config.style) ? config.style : 'peach');
  params.set('date', config.showDate ? '1' : '0');
  params.set('seconds', config.showSeconds ? '1' : '0');
  params.set('format', config.hourFormat === '12' ? '12' : '24');
  const label = Array.from(String(config.label || '').replace(/\s+/g, ' ').trim()).slice(0, 16).join('');
  if (label) params.set('label', label);
  else params.delete('label');
  for (const key of ['flipFrameColor', 'flipFaceColor', 'flipTextColor']) {
    if (config[key]) params.set(key, config[key]);
  }
  return url.href;
}

function isTransparentClockStyle(style) {
  return ['timeline-horizontal', 'timeline-vertical', 'digital', 'orbit', 'flip'].includes(style);
}

function usesDefaultClockLabel(style, label) {
  const current = String(label || '').trim();
  return !current || current === (CLOCK_STYLE_LABELS[style] || '');
}

export function clockStyleChange(draft, style) {
  return { style, ...(!isTransparentClockStyle(style) && usesDefaultClockLabel(draft.style, draft.label)
    ? { label: CLOCK_STYLE_LABELS[style] } : {}) };
}

function bindClockParameters(root, controller) {
  const node = (id) => componentField(root, id);
  const fields = { showDate: 'clockShowDate', showSeconds: 'clockShowSeconds', hourFormat: 'clockHourFormat',
    label: 'clockCustomLabel', flipFrameColor: 'clockFlipFrameColor', flipFaceColor: 'clockFlipFaceColor', flipTextColor: 'clockFlipTextColor' };
  const styles = Array.from(root.querySelectorAll('[data-clock-style-option]'));
  const palettes = Array.from(root.querySelectorAll('[data-clock-palette]'));
  for (const [key, id] of Object.entries(fields)) {
    const control = node(id);
    control.addEventListener(['hourFormat', 'showDate', 'showSeconds'].includes(key) ? 'change' : 'input', () => {
      controller.edit({ [key]: key.startsWith('show') ? control.checked : control.value });
    });
  }
  for (const button of styles) button.addEventListener('click', () => {
    const { draft } = controller.getState();
    const style = button.dataset.clockStyleOption;
    if (!CLOCK_STYLE_VALUES.has(style)) return;
    controller.edit(clockStyleChange(draft, style));
  });
  for (const button of palettes) button.addEventListener('click', () => {
    const [flipFrameColor, flipFaceColor, flipTextColor] = FLIP_PALETTES[button.dataset.clockPalette];
    controller.edit({ flipFrameColor, flipFaceColor, flipTextColor });
  });
  return { dispose: controller.subscribe(({ draft, loaded }) => {
    const transparent = isTransparentClockStyle(draft.style);
    for (const [key, id] of Object.entries(fields)) {
      const control = node(id);
      if (key.startsWith('show')) control.checked = draft[key];
      else if (control.value !== draft[key]) control.value = draft[key];
      control.disabled = !loaded || (key === 'label' && transparent);
    }
    node('clockCustomLabelHelp').textContent = transparent ? '此样式不显示' : '最多 16 个字';
    node('clockFlipColors').hidden = draft.style !== 'flip';
    for (const button of styles) {
      const active = button.dataset.clockStyleOption === draft.style;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = !loaded;
    }
    for (const button of palettes) {
      button.disabled = !loaded;
      button.setAttribute('aria-pressed', String(FLIP_PALETTES[button.dataset.clockPalette].every((color, index) =>
        color === draft[['flipFrameColor', 'flipFaceColor', 'flipTextColor'][index]])));
    }
  }) };
}

export function createClockPreview({ controller, source = document, onOpen, onClose }) {
  return { id: 'clock', title: '萌时钟', controller,
    url: new URL('/clock?componentPreview=1', location.href).href, dataLabel: '设备当前时间',
    size: (draft) => draft.style === 'timeline-vertical' ? [240, 400] : [580, 210],
    createPanel: (host, targetController = controller) => {
      const panel = cloneComponentPanel(source.querySelector('.clock-parameter-section'), 'preview-clock');
      host.append(panel);
      return bindClockParameters(panel, targetController);
    },
    onOpen, onClose,
  };
}

function initClockCard() {
  if (initialized) return;
  const preview = document.getElementById('clockPreview');
  if (!preview) return;
  initialized = true;
  let largePreviewOpen = false;
  const fixedUrl = `${localOverlayOrigin(location)}/clock`;
  const controller = createComponentConfigController({
    initial: clockConfigFromSettings({}),
    read: async () => {
      const response = await fetch('/api/clock/config', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.data) throw new Error('萌时钟配置读取失败，请重新读取。');
      return clockConfigFromSettings(clockSettingsPayload(payload.data));
    },
    persist: async (config) => {
      const settings = await saveComponentSettings(clockSettingsPayload(config));
      if (settings.clockStyle !== config.style) throw new Error('服务端未保存时钟样式，请更新服务后重试。');
      return clockConfigFromSettings(settings);
    },
  });
  bindClockParameters(document, controller);
  function updatePreview() {
    const state = controller.getState();
    if (largePreviewOpen || !state.loaded) return;
    if (!preview.getAttribute('src')) {
      const url = new URL(buildClockUrl(new URL('/clock', location.href).href, state.draft));
      url.searchParams.set('componentPreview', '1');
      preview.src = url.href;
    } else {
      preview.contentWindow?.postMessage({ type: 'component-preview:config', config: state.draft }, '*');
    }
  }
  controller.subscribe((state) => {
    preview.dataset.clockStyle = state.draft.style;
    document.getElementById('clockRecommendedSize').textContent = state.draft.style === 'timeline-vertical'
      ? '推荐浏览器源：240 × 400' : '推荐浏览器源：580 × 210';
    const save = document.getElementById('clockSave');
    save.disabled = !state.loaded || !state.dirty || state.saving;
    save.textContent = state.saving ? '正在保存…' : '保存时钟设置';
    document.getElementById('clockDiscard').disabled = !state.dirty || state.saving;
    document.getElementById('clockSaveState').textContent = componentSaveMessage(state);
    updatePreview();
  });
  registerComponentSettings('clock', controller, clockConfigFromSettings, clockSettingsPayload);
  preview.addEventListener('load', updatePreview);
  window.addEventListener('message', (event) => {
    if (event.source === preview.contentWindow && event.origin === 'null' && event.data?.type === 'component-preview:ready') updatePreview();
  });
  document.getElementById('clockFixedUrl').textContent = fixedUrl;
  document.getElementById('clockCopyFixed').addEventListener('click', async () => {
    try { await copyText(fixedUrl); toast('萌时钟固定网址已复制'); }
    catch (error) { toast(error.message || '复制失败，请手动复制网址。'); }
  });
  document.getElementById('clockSave').addEventListener('click', () => controller.save());
  document.getElementById('clockDiscard').addEventListener('click', () => controller.discard());
  document.getElementById('clockReload').addEventListener('click', () => controller.reload());
  const getClockPreview = () => createClockPreview({ controller,
    onOpen() { largePreviewOpen = true; preview.removeAttribute('src'); },
    onClose() { largePreviewOpen = false; updatePreview(); },
  });
  registerComponentPreview('clock', getClockPreview);
  document.getElementById('clockOpenPreview').addEventListener('click', () => openComponentPreview(getClockPreview()));
  void controller.reload();
  return controller;
}

export { buildClockUrl, clockSettingsPayload, initClockCard, usesDefaultClockLabel };
