import { previewElement } from './component-preview-surface.js';

const RECENT_COLORS_KEY = 'admin.textBoxRecentColors';
const COMMON_COLORS = [
  ['白色', '#ffffff'], ['墨黑', '#111827'], ['红色', '#ff4d6a'], ['橙色', '#ff922b'],
  ['黄色', '#ffd43b'], ['绿色', '#51cf66'], ['青色', '#20c997'], ['蓝色', '#4dabf7'],
  ['靛蓝', '#748ffc'], ['紫色', '#b197fc'], ['粉色', '#f783ac'], ['灰色', '#94a3b8'],
];

function readRecentColors() {
  try {
    const colors = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || '[]');
    return Array.isArray(colors)
      ? [...new Set(colors.filter(color => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)).map(color => color.toLowerCase()))].slice(0, 6)
      : [];
  } catch { return []; }
}

export function mountTextBoxFormatControls(toolbar, { listen, format, clearFormat }) {
  let openPanel = null;
  let recentColors = readRecentColors();
  let defaultColor = '#ffffff';
  let uniformColor = true;
  let selectionBottom = 0;
  const effects = new Map();
  const panels = new Map();

  function button(parent, label, className, action) {
    const node = previewElement('button', className, label);
    node.type = 'button';
    listen(node, 'mousedown', event => event.preventDefault());
    if (action) listen(node, 'click', action);
    parent.append(node);
    return node;
  }
  function close() {
    for (const [panel, trigger] of panels) {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
    openPanel = null;
  }
  function position(selectionBounds) {
    if (selectionBounds) selectionBottom = selectionBounds.bottom;
    if (!openPanel) return;
    const anchor = panels.get(openPanel).getBoundingClientRect();
    const bounds = toolbar.getBoundingClientRect();
    openPanel.style.left = `${Math.max(8, Math.min(anchor.right - openPanel.offsetWidth, window.innerWidth - openPanel.offsetWidth - 8))}px`;
    const above = bounds.top - openPanel.offsetHeight - 8;
    const below = Math.max(bounds.bottom, selectionBottom) + 8;
    openPanel.style.top = `${Math.max(8, above >= 8 ? above : Math.min(below, window.innerHeight - openPanel.offsetHeight - 8))}px`;
  }
  function createPanel(trigger, label) {
    const panel = previewElement('div', 'text-box-format-popover');
    panel.id = `text-box-format-${crypto.randomUUID()}`;
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', label);
    trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-expanded', 'false');
    panels.set(panel, trigger);
    toolbar.append(panel);
    listen(trigger, 'click', () => {
      const wasOpen = openPanel === panel;
      close();
      if (wasOpen) return;
      panel.hidden = false;
      openPanel = panel;
      trigger.setAttribute('aria-expanded', 'true');
      if (panel === palette) renderRecentColors();
      position();
      panel.querySelector('button, input')?.focus({ preventScroll: true });
    });
    return panel;
  }
  function rememberColor(value) {
    recentColors = [value, ...recentColors.filter(color => color !== value)].slice(0, 6);
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recentColors)); }
    catch (error) { console.warn('[TextBox] Recent colors could not be saved; they remain available for this session.', error); }
  }
  function applyColor(value) {
    format('color', value);
    rememberColor(value);
    close();
  }
  function swatch(parent, label, value) {
    const node = button(parent, '', 'text-box-color-swatch', () => applyColor(value));
    node.title = `${label} ${value}`;
    node.setAttribute('aria-label', node.title);
    node.dataset.color = value;
    node.style.setProperty('--text-box-swatch', value);
    return node;
  }

  const colorButton = button(toolbar, 'A', 'text-box-format text-box-color');
  colorButton.title = '文字颜色';
  colorButton.setAttribute('aria-label', '文字颜色');
  const palette = createPanel(colorButton, '文字颜色选项');
  button(palette, '默认颜色', 'text-box-format-action', () => applyColor(defaultColor));
  const common = previewElement('div', 'text-box-color-grid');
  common.setAttribute('role', 'group');
  common.setAttribute('aria-label', '常用颜色');
  for (const [label, value] of COMMON_COLORS) swatch(common, label, value);
  const recent = previewElement('div', 'text-box-recent-colors');
  const custom = previewElement('label', 'text-box-custom-color', '自定义');
  const color = previewElement('input');
  color.type = 'color';
  color.setAttribute('aria-label', '自定义文字颜色');
  listen(color, 'input', () => format('color', color.value));
  listen(color, 'change', () => { rememberColor(color.value); renderRecentColors(); position(); });
  custom.append(color);
  palette.append(common, recent, custom);

  function renderRecentColors() {
    recent.hidden = recentColors.length === 0;
    const grid = previewElement('div', 'text-box-color-grid');
    for (const value of recentColors) swatch(grid, '最近颜色', value);
    recent.replaceChildren(previewElement('div', 'text-box-palette-label', '最近使用'), grid);
    for (const swatch of palette.querySelectorAll('[data-color]')) {
      swatch.setAttribute('aria-pressed', String(uniformColor && swatch.dataset.color === color.value));
    }
  }

  const more = button(toolbar, '', 'text-box-format text-box-more');
  more.title = '更多文字格式';
  more.setAttribute('aria-label', more.title);
  more.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
  const options = createPanel(more, '文字效果');
  for (const [key, label] of [['stroke', '文字描边'], ['shadow', '轻阴影']]) {
    const toggle = button(options, label, 'text-box-format-action text-box-effect-toggle', () => {
      format(key, toggle.getAttribute('aria-pressed') !== 'true');
    });
    toggle.setAttribute('aria-pressed', 'false');
    effects.set(key, toggle);
  }
  button(options, '清除格式', 'text-box-format-action text-box-clear-format', () => { clearFormat(); close(); });

  listen(document, 'pointerdown', event => { if (!toolbar.contains(event.target)) close(); });
  listen(document, 'keydown', event => {
    if (event.key !== 'Escape' || !openPanel) return;
    event.preventDefault();
    event.stopPropagation();
    const trigger = panels.get(openPanel);
    close();
    trigger.focus({ preventScroll: true });
  });
  return {
    close,
    position,
    update(nodes, config) {
      defaultColor = config.color;
      const text = nodes.filter(node => node.type === 'text');
      const colors = new Set(text.map(node => node.color || config.color));
      uniformColor = colors.size === 1;
      if (document.activeElement !== color) color.value = text[0]?.color || config.color;
      colorButton.style.setProperty('--text-box-current-color', color.value);
      for (const swatch of palette.querySelectorAll('[data-color]')) {
        swatch.setAttribute('aria-pressed', String(colors.size === 1 && colors.has(swatch.dataset.color)));
      }
      for (const [key, toggle] of effects) {
        const count = text.filter(node => node[key]).length;
        toggle.setAttribute('aria-pressed', count === text.length ? 'true' : count ? 'mixed' : 'false');
      }
    },
  };
}
