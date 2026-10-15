import { parseHexColor } from './color-value.js';

let picker;
let current;

function hsvFromColor({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = !delta ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: max ? delta / max : 0, v: max / 255 };
}

function hsvToHex({ h, s, v }) {
  const channel = offset => {
    const k = (offset + h / 60) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

function createPicker(document) {
  const panel = document.createElement('div');
  panel.className = 'lira-color-picker';
  panel.setAttribute('popover', 'auto');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '颜色与不透明度');
  panel.innerHTML = `
    <div class="lira-color-plane" aria-hidden="true"><span></span></div>
    <label class="lira-color-hue-label">色相<input class="lira-color-hue" type="range" min="0" max="360" step="1" aria-label="色相"></label>
    <label class="lira-color-opacity-label">不透明度<input class="lira-color-opacity" type="range" min="0" max="100" step="1" aria-label="不透明度滑块"></label>
    <div class="lira-color-channels">
      <label>R<input type="number" min="0" max="255" step="1" data-channel="r" aria-label="红色 R" required></label>
      <label>G<input type="number" min="0" max="255" step="1" data-channel="g" aria-label="绿色 G" required></label>
      <label>B<input type="number" min="0" max="255" step="1" data-channel="b" aria-label="蓝色 B" required></label>
      <label>A %<input type="number" min="0" max="100" step="1" data-channel="alpha" aria-label="不透明度（%）" required></label>
    </div>
    <label class="lira-color-hex-label">HEX<input class="lira-color-hex" type="text" spellcheck="false" maxlength="7" pattern="#[0-9a-fA-F]{6}" aria-label="十六进制颜色" required></label>
    <div class="lira-color-picker-footer"><span>0% 全透明 · 100% 不透明</span><button type="button" data-eyedropper hidden>取色</button><button type="button" data-done>完成</button></div>`;
  document.body.append(panel);
  const plane = panel.querySelector('.lira-color-plane');
  const marker = plane.firstElementChild;
  const hue = panel.querySelector('.lira-color-hue');
  const opacity = panel.querySelector('.lira-color-opacity');
  const hex = panel.querySelector('.lira-color-hex');
  const channels = Object.fromEntries([...panel.querySelectorAll('[data-channel]')].map(input => [input.dataset.channel, input]));
  let hsv;
  function refresh(keepHue = false) {
    if (!current) return;
    const color = parseHexColor(current.hex);
    if (!keepHue) hsv = hsvFromColor(color);
    hue.value = String(Math.round(hsv.h));
    plane.style.setProperty('--picker-hue', `hsl(${hsv.h} 100% 50%)`);
    marker.style.left = `${hsv.s * 100}%`; marker.style.top = `${(1 - hsv.v) * 100}%`;
    panel.style.setProperty('--picker-color', current.hex);
    const percent = Math.round(current.alpha * 100);
    opacity.value = String(percent);
    for (const [key, input] of Object.entries(channels)) {
      if (document.activeElement !== input) input.value = String(key === 'alpha' ? percent : color[key]);
    }
    if (document.activeElement !== hex) hex.value = current.hex.toUpperCase();
  }
  function edit(color, alpha, type, keepHue = false) {
    if (!current || current.input.matches(':disabled')) return;
    const focused = document.activeElement;
    current.hex = color; current.alpha = alpha;
    current.onEdit(color, alpha, type);
    // Rich-text formatting restores its selection; keep keyboard editing in the picker.
    if (panel.contains(focused)) focused.focus({ preventScroll: true });
    refresh(keepHue);
  }
  for (const type of ['input', 'change']) {
    panel.addEventListener(type, event => event.stopPropagation());
    hue.addEventListener(type, () => {
      hsv.h = Number(hue.value);
      edit(hsvToHex(hsv), current.alpha, type, true);
    });
    opacity.addEventListener(type, () => edit(current.hex, Number(opacity.value) / 100, type, true));
    for (const [key, input] of Object.entries(channels)) input.addEventListener(type, () => {
      if (!input.checkValidity()) return;
      const color = key === 'alpha' ? current.hex : `#${['r', 'g', 'b'].map(channel => Number(channels[channel].value).toString(16).padStart(2, '0')).join('')}`;
      edit(color, key === 'alpha' ? Number(input.value) / 100 : current.alpha, type);
    });
    hex.addEventListener(type, () => {
      if (hex.checkValidity()) edit(hex.value.toLowerCase(), current.alpha, type);
    });
  }
  function move(event) {
    const rect = plane.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    hsv.v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    edit(hsvToHex(hsv), current.alpha, 'input', true);
  }
  plane.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    plane.setPointerCapture(event.pointerId); move(event);
  });
  plane.addEventListener('pointermove', event => { if (plane.hasPointerCapture(event.pointerId)) move(event); });
  plane.addEventListener('pointerup', event => {
    if (!plane.hasPointerCapture(event.pointerId)) return;
    plane.releasePointerCapture(event.pointerId);
    edit(current.hex, current.alpha, 'change', true);
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); panel.hidePopover(); }
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); event.target.blur(); }
  });
  panel.querySelector('[data-done]').addEventListener('click', () => panel.hidePopover());
  const eyedropper = panel.querySelector('[data-eyedropper]');
  let sampling;
  if (document.defaultView.EyeDropper) {
    eyedropper.hidden = false;
    eyedropper.addEventListener('click', async () => {
      const selection = current;
      sampling = new AbortController();
      try {
        const result = await new document.defaultView.EyeDropper().open({ signal: sampling.signal });
        if (current === selection) { edit(result.sRGBHex, current.alpha, 'input'); edit(current.hex, current.alpha, 'change'); }
      } catch (error) {
        if (error.name !== 'AbortError') console.warn('[ColorPicker] Screen sampling failed.', error);
      } finally { sampling = null; }
    });
  }
  panel.addEventListener('toggle', event => {
    if (event.newState !== 'closed' || !current) return;
    sampling?.abort();
    const input = current.input;
    delete input.dataset.colorEditing;
    input.setAttribute('aria-expanded', 'false');
    current = null;
    if (document.activeElement === document.body || panel.contains(document.activeElement)) input.focus({ preventScroll: true });
    input.dispatchEvent(new Event('lira-color-edit-end', { bubbles: true }));
  });
  return { panel, refresh };
}

export function openColorPicker(input, hex, alpha, onEdit, alphaStep = 1) {
  picker ??= createPicker(input.ownerDocument);
  if (current) {
    delete current.input.dataset.colorEditing;
    current.input.setAttribute('aria-expanded', 'false');
    current.input.dispatchEvent(new Event('lira-color-edit-end', { bubbles: true }));
  }
  current = { input, hex, alpha, onEdit };
  for (const control of picker.panel.querySelectorAll('.lira-color-opacity, [data-channel="alpha"]')) control.step = String(alphaStep);
  input.dataset.colorEditing = 'true';
  input.setAttribute('aria-expanded', 'true');
  picker.refresh();
  picker.panel.showPopover();
  const rect = input.getBoundingClientRect();
  const { innerWidth, innerHeight } = input.ownerDocument.defaultView;
  const { width, height } = picker.panel.getBoundingClientRect();
  picker.panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
  picker.panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - height - 8))}px`;
  picker.panel.querySelector('.lira-color-hue').focus({ preventScroll: true });
}

export function closeColorPicker(input) {
  if (current?.input === input) picker.panel.hidePopover();
}

/** A floating picker remains part of its input's logical editing surface. */
export function colorPickerContains(root, node) {
  return Boolean(current && root.contains(current.input) && picker.panel.contains(node));
}
