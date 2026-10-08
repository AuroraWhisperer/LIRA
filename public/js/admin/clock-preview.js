import { mountStyleParameters } from './component-style-parameters.js';
import { CLOCK_STYLE_LABELS, FLIP_PALETTES, clockAppearanceChange } from '../shared/clock-settings.js';
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
  params.set('moonMode', config.moonMode ?? 'light');
  params.set('moonIntervalSeconds', String(config.moonIntervalSeconds ?? 30));
  return url.href;
}

function isTransparentClockStyle(style) {
  return ['timeline-horizontal', 'timeline-vertical', 'digital', 'orbit', 'flip', 'moonlit-fan'].includes(style);
}

export function usesDefaultClockLabel(style, label) {
  const current = String(label || '').trim();
  return !current || current === (CLOCK_STYLE_LABELS[style] || '');
}

export function clockStyleChange(draft, style) {
  if (draft.styleOptions?.[style] && !draft.mediaStyle && !draft.resourceStyle && !draft.cssStyle) {
    return { style, ...draft.styleOptions[style] };
  }
  return { style, ...(draft.mediaStyle ? { mediaStyle: null } : {}), ...(draft.resourceStyle ? { resourceStyle: null } : {}), ...(!isTransparentClockStyle(style) && usesDefaultClockLabel(draft.style, draft.label)
    ? { label: CLOCK_STYLE_LABELS[style] } : {}) };
}

export function bindClockParameters(root, controller) {
  const node = (id) => componentField(root, id);
  const fields = { showDate: 'clockShowDate', showSeconds: 'clockShowSeconds', hourFormat: 'clockHourFormat',
    label: 'clockCustomLabel', flipFrameColor: 'clockFlipFrameColor', flipFaceColor: 'clockFlipFaceColor', flipTextColor: 'clockFlipTextColor',
    moonMode: 'clockMoonMode', moonIntervalSeconds: 'clockMoonIntervalSeconds' };
  const styles = Array.from(root.querySelectorAll('[data-clock-style-option]'));
  const palettes = Array.from(root.querySelectorAll('[data-clock-palette]'));
  for (const [key, id] of Object.entries(fields)) {
    const control = node(id);
    control.addEventListener(['hourFormat', 'showDate', 'showSeconds', 'moonMode', 'moonIntervalSeconds'].includes(key) ? 'change' : 'input', () => {
      const draft = controller.getState().draft;
      const patch = { [key]: key.startsWith('show') ? control.checked
        : key === 'moonIntervalSeconds' ? Number(control.value) : control.value };
      controller.edit(draft.resourceStyle || draft.mediaStyle || draft.cssStyle ? patch : clockAppearanceChange(draft, patch));
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
    controller.edit(clockAppearanceChange(controller.getState().draft, { flipFrameColor, flipFaceColor, flipTextColor }));
  });
  const effects = mountStyleParameters(node('clockShowDate').closest('.clock-parameter-section'), controller, 'clock');
  const stop = controller.subscribe(({ draft, loaded }) => {
    const transparent = isTransparentClockStyle(draft.style);
    for (const [key, id] of Object.entries(fields)) {
      const control = node(id);
      if (key.startsWith('show')) control.checked = draft[key];
      else if (control.value !== String(draft[key])) control.value = draft[key];
      control.disabled = !loaded || (key === 'label' && transparent)
        || (key === 'moonIntervalSeconds' && draft.moonMode !== 'auto');
    }
    node('clockCustomLabelField').hidden = transparent;
    node('clockFlipColors').hidden = draft.style !== 'flip';
    node('clockMoonColors').hidden = draft.style !== 'moonlit-fan';
    node('clockMoonIntervalField').hidden = draft.moonMode !== 'auto';
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
  });
  return { dispose() { stop(); effects.dispose(); } };
}

export function createClockPreview({ controller, source = document, onOpen, onClose, panelPrefix = 'preview-clock' }) {
  return { id: 'clock', title: '萌时钟', controller,
    url: new URL('/clock?componentPreview=1', location.href).href, dataLabel: '设备当前时间',
    size: (draft) => draft.style === 'timeline-vertical' ? [48, 80]
      : draft.style === 'moonlit-fan' ? [580, 380] : [580, 210],
    createPanel: (host, targetController = controller) => {
      const panel = cloneComponentPanel(source.querySelector('.clock-parameter-section'), panelPrefix);
      panel.querySelector('[data-local-styles]')?.remove();
      host.append(panel);
      return bindClockParameters(panel, targetController);
    },
    onOpen, onClose,
  };
}
