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
    <div class="lira-color-picker-footer"><span>透明 → 不透明</span><button type="button" data-undo disabled title="恢复上一次修改前的颜色和不透明度">撤回</button><button type="button" data-eyedropper hidden>取色</button><button type="button" data-done>完成</button></div>`;
  document.body.append(panel);
  const plane = panel.querySelector('.lira-color-plane');
  const marker = plane.firstElementChild;
  const hue = panel.querySelector('.lira-color-hue');
  const opacity = panel.querySelector('.lira-color-opacity');
  const hex = panel.querySelector('.lira-color-hex');
  const undo = panel.querySelector('[data-undo]');
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
    const previous = current.editStart || current.previous;
    undo.disabled = Boolean(sampling) || !previous || (previous.hex === current.hex && previous.alpha === current.alpha);
  }
  function edit(color, alpha, type, keepHue = false, remember = true) {
    if (!current || current.input.matches(':disabled')) return;
    const focused = document.activeElement;
    if (remember && (color !== current.hex || alpha !== current.alpha)) {
      current.editStart ??= { hex: current.hex, alpha: current.alpha };
    }
    current.hex = color; current.alpha = alpha;
    if (remember && type === 'change' && current.editStart) {
      if (color !== current.editStart.hex || alpha !== current.editStart.alpha) current.previous = current.editStart;
      current.editStart = null;
    }
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
  undo.addEventListener('click', () => {
    const previous = current?.editStart || current?.previous;
    if (!previous || sampling) return;
    current.editStart = null;
    current.previous = null;
    edit(previous.hex, previous.alpha, 'input', false, false);
    edit(previous.hex, previous.alpha, 'change', false, false);
  });
  const eyedropper = panel.querySelector('[data-eyedropper]');
  const samplingHint = panel.querySelector('.lira-color-picker-footer > span');
  const desktop = document.defaultView.songAssistantDesktop;
  let sampling;
  if (desktop?.pickScreenColor || document.defaultView.EyeDropper) {
    eyedropper.hidden = false;
    eyedropper.title = '从整个屏幕取色（Esc 取消）';
    eyedropper.addEventListener('click', async () => {
      if (sampling) return;
      const selection = current;
      const controller = new AbortController();
      sampling = controller;
      eyedropper.disabled = true;
      undo.disabled = true;
      samplingHint.textContent = '单击屏幕取色 · Esc 取消';
      let failed = false;
      try {
        if (desktop?.pickScreenColor) controller.signal.addEventListener('abort', () => {
          void desktop.cancelScreenColor().catch(error => console.warn('[ColorPicker] Cancel sampling failed.', error));
        }, { once: true });
        const result = desktop?.pickScreenColor
          ? await desktop.pickScreenColor()
          : await new document.defaultView.EyeDropper().open({ signal: controller.signal });
        if (result?.ok === false) throw new Error(result.error);
        if (result?.canceled || controller.signal.aborted) return;
        if (current === selection) { edit(result.sRGBHex, current.alpha, 'input'); edit(current.hex, current.alpha, 'change'); }
      } catch (error) {
        failed = error.name !== 'AbortError' && !controller.signal.aborted;
        if (failed) console.warn('[ColorPicker] Screen sampling failed.', error);
      } finally {
        if (sampling === controller) {
          sampling = null;
          eyedropper.disabled = false;
          samplingHint.textContent = failed ? '取色失败，请重试' : '透明 → 不透明';
          refresh();
        }
      }
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
  return { panel, refresh, cancelSampling: () => sampling?.abort() };
}

export function openColorPicker(input, hex, alpha, onEdit, alphaStep = 1) {
  picker ??= createPicker(input.ownerDocument);
  if (current) {
    picker.cancelSampling();
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
