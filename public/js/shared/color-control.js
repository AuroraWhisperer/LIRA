import { parseHexColor, colorWithAlpha } from './color-value.js';
import { openColorPicker, closeColorPicker } from './color-picker.js';

const COLOR_INPUT = 'input[type="color"]';
const enhancedColors = new WeakMap();
const opacitySources = new WeakMap();
let observerInstalled = false;

function opacitySource(input) {
  const key = input.dataset.colorOpacity;
  if (!key) return null;
  const selector = ['id', 'data-preview-field', 'data-component-parameter', 'data-effect-field']
    .map(attribute => `[${attribute}="${input.ownerDocument.defaultView.CSS.escape(key)}"]`).join(',');
  for (let root = input.parentElement; root; root = root.parentElement) {
    const source = root.querySelector(selector);
    if (source) return source;
  }
  return null;
}

function readAlpha(input, state) {
  const source = opacitySource(input);
  if (!source) return state.alpha;
  if (!opacitySources.has(source)) {
    const colors = new Set();
    opacitySources.set(source, colors);
    const nativeValue = Object.getOwnPropertyDescriptor(input.ownerDocument.defaultView.HTMLInputElement.prototype, 'value');
    Object.defineProperty(source, 'value', {
      configurable: true,
      get() { return nativeValue.get.call(this); },
      set(value) { nativeValue.set.call(this, value); colors.forEach(syncColorValue); },
    });
    for (const event of ['input', 'change']) source.addEventListener(event, () => colors.forEach(syncColorValue));
  }
  opacitySources.get(source).add(input);
  source.closest('label, .background-parameter, .player-appearance-range')?.classList.add('lira-color-opacity-source');
  const value = Number(source.value) / Number(source.max || 1);
  return Math.max(0, Math.min(1, value));
}

function syncColorValue(input) {
  const state = enhancedColors.get(input);
  if (!state) return;
  const alpha = readAlpha(input, state);
  state.hexLabel.textContent = state.hex.toUpperCase();
  state.alphaLabel.textContent = `${Math.round(alpha * 100)}%`;
  input.style.setProperty('--color-control-value', colorWithAlpha(state.hex, alpha));
  input.setAttribute('aria-description', `不透明度 ${Math.round(alpha * 100)}%`);
  if (input.matches(':disabled') || !input.isConnected) closeColorPicker(input);
}

function enhanceColor(input) {
  if (enhancedColors.has(input)) { syncColorValue(input); return; }
  const document = input.ownerDocument;
  let wrapper = input.parentElement;
  if (!wrapper.classList.contains('lira-color-control')) {
    wrapper = document.createElement('span');
    wrapper.className = 'lira-color-control';
    input.before(wrapper); wrapper.append(input);
  }
  let value = wrapper.querySelector('.lira-color-value');
  if (!value) {
    value = document.createElement('span');
    value.className = 'lira-color-value';
    value.setAttribute('aria-hidden', 'true');
    wrapper.append(value);
  }
  value.replaceChildren();
  const hexLabel = document.createElement('span'); hexLabel.className = 'lira-color-hex-value';
  const alphaLabel = document.createElement('span'); alphaLabel.className = 'lira-color-alpha-value';
  value.append(hexLabel, alphaLabel);
  const nativeValue = Object.getOwnPropertyDescriptor(document.defaultView.HTMLInputElement.prototype, 'value');
  const initial = input.getAttribute('value');
  const color = parseHexColor(input.dataset.colorValue || (initial?.length === 9 && input.value === initial.slice(0, 7).toLowerCase() ? initial : input.value)) || parseHexColor('#000000');
  const state = { ...color, hexLabel, alphaLabel };
  enhancedColors.set(input, state);
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return input.dataset.colorOpacity ? state.hex : colorWithAlpha(state.hex, state.alpha); },
    set(nextValue) {
      const color = parseHexColor(nextValue) || parseHexColor('#000000');
      state.hex = color.hex; state.alpha = color.alpha;
      nativeValue.set.call(this, color.hex);
      input.dataset.colorValue = colorWithAlpha(color.hex, color.alpha);
      syncColorValue(this);
    },
  });
  input.value = colorWithAlpha(color.hex, color.alpha);
  // Keep the original node and business listeners. Only it emits color changes.
  for (const type of ['input', 'change']) input.addEventListener(type, () => {
    state.hex = nativeValue.get.call(input);
    input.dataset.colorValue = colorWithAlpha(state.hex, state.alpha);
    syncColorValue(input);
  }, true);
  input.setAttribute('aria-haspopup', 'dialog');
  input.setAttribute('aria-expanded', 'false');
  delete input.dataset.colorEditing;
  function open() {
    if (input.matches(':disabled')) return;
    let changedTarget = input;
    const alphaSource = opacitySource(input);
    openColorPicker(input, state.hex, readAlpha(input, state), (hex, alpha, type) => {
      const source = opacitySource(input);
      const previous = input.value;
      const previousAlpha = readAlpha(input, state);
      input.value = source ? hex : colorWithAlpha(hex, alpha);
      if (source && alpha !== previousAlpha) {
        source.value = String(Number((alpha * Number(source.max || 1)).toFixed(6)));
        changedTarget = source;
        source.dispatchEvent(new Event(type, { bubbles: true }));
      } else if (input.value !== previous) {
        changedTarget = input;
        input.dispatchEvent(new Event(type, { bubbles: true }));
      } else if (type === 'change') changedTarget.dispatchEvent(new Event('change', { bubbles: true }));
      syncColorValue(input);
    }, alphaSource ? Number(alphaSource.step || 1) / Number(alphaSource.max || 1) * 100 : 1);
  }
  input.addEventListener('click', event => { event.preventDefault(); open(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
  });
}

function installColorObserver() {
  if (observerInstalled || !document.body || typeof MutationObserver === 'undefined') return;
  observerInstalled = true;
  document.addEventListener('reset', event => {
    const form = event.target;
    setTimeout(() => form.querySelectorAll(COLOR_INPUT).forEach(input => {
      closeColorPicker(input);
      input.value = input.getAttribute('value') || '#000000';
    }), 0);
  }, true);
  document.addEventListener('formdata', event => {
    for (const input of event.target.querySelectorAll(COLOR_INPUT)) {
      if (input.name && !input.matches(':disabled') && enhancedColors.has(input)) event.formData.set(input.name, input.value);
    }
  });
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.attributeName === 'value' && enhancedColors.has(record.target)) record.target.value = record.target.getAttribute('value');
        syncColorValue(record.target);
      } else {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node.isConnected) enhanceColorControls(node);
        }
        for (const node of record.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && !node.isConnected) {
            if (node.matches(COLOR_INPUT)) closeColorPicker(node);
            node.querySelectorAll(COLOR_INPUT).forEach(closeColorPicker);
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'disabled'] });
}

/** Enhance colors in place, including later additions and cloned panels. */
export function enhanceColorControls(root = document) {
  installColorObserver();
  const inputs = [];
  if (root.matches?.(COLOR_INPUT)) inputs.push(root);
  inputs.push(...root.querySelectorAll(COLOR_INPUT));
  inputs.forEach(enhanceColor);
  return inputs.length;
}
