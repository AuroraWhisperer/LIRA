import { CLOCK_STYLE_LABELS, FLIP_PALETTES } from '../shared/clock-settings.js';
import { cloneComponentPanel, componentField } from './component-preview-panel.js';

const CLOCK_STYLE_VALUES = new Set(Object.keys(CLOCK_STYLE_LABELS));

export function buildClockUrl(baseUrl, config) {
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

export function usesDefaultClockLabel(style, label) {
  const current = String(label || '').trim();
  return !current || current === (CLOCK_STYLE_LABELS[style] || '');
}

export function clockStyleChange(draft, style) {
  return { style, ...(!isTransparentClockStyle(style) && usesDefaultClockLabel(draft.style, draft.label)
    ? { label: CLOCK_STYLE_LABELS[style] } : {}) };
}

export function bindClockParameters(root, controller) {
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
