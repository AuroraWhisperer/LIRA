import { GIFT_SWING_TEXT_PARTS, GIFT_SWING_TEXT_MODES } from '../shared/gift-motion-settings.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from '../shared/parameter-range.js';
import { previewElement } from './component-preview-surface.js';

export function mountGiftMotionParameters(host, effect, { idPrefix = '', onEdit } = {}) {
  const inputs = new Map();
  const outputs = new Map();
  const events = new AbortController();
  function sync(key) {
    const input = inputs.get(key);
    if (input.type === 'range') {
      const text = `${input.value}${input.dataset.unit === '%' ? '' : ' '}${input.dataset.unit}`.trim();
      outputs.get(key).value = text;
      input.setAttribute('aria-valuetext', text);
      refreshParameterRange(input);
    } else {
      for (const checkbox of input.parentElement.querySelectorAll('[data-text-part]')) {
        checkbox.checked = GIFT_SWING_TEXT_MODES[input.value].includes(checkbox.dataset.textPart);
      }
    }
  }
  for (const [name, field] of Object.entries(effect.fields)) {
    const key = `${effect.prefix}${name}`;
    const label = previewElement('div', 'gift-effect-field');
    const title = previewElement(field.options ? 'span' : 'label', 'gift-effect-field-label', field.label);
    const control = previewElement('span', 'gift-effect-field-control');
    const input = previewElement('input');
    input.id = `${idPrefix}${key}`;
    input.dataset.componentParameter = key;
    input.value = field.default;
    title.id = `${input.id}Label`;
    input.required = true;
    if (field.options) {
      input.type = 'hidden';
      control.append(input);
      control.classList.add('gift-motion-text-options');
      control.setAttribute('role', 'group');
      control.setAttribute('aria-labelledby', title.id);
      for (const [part, text] of Object.entries(GIFT_SWING_TEXT_PARTS)) {
        const option = previewElement('label', 'gift-motion-text-option');
        const checkbox = previewElement('input');
        checkbox.type = 'checkbox'; checkbox.dataset.textPart = part;
        option.append(checkbox, document.createTextNode(text)); control.append(option);
        checkbox.addEventListener('change', () => {
          const selected = [...control.querySelectorAll('[data-text-part]')].filter(node => node.checked).map(node => node.dataset.textPart);
          input.value = Object.entries(GIFT_SWING_TEXT_MODES).find(([, parts]) =>
            parts.length === selected.length && selected.every(part => parts.includes(part)))[0];
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, { signal: events.signal });
      }
    } else {
      title.htmlFor = input.id;
      label.classList.add('gift-motion-parameter');
      input.type = 'range'; input.className = 'parameter-range';
      input.min = field.min; input.max = field.max; input.step = 1; input.dataset.unit = field.unit || '';
      input.setAttribute('aria-labelledby', title.id);
      const output = previewElement('output', 'gift-motion-value');
      output.id = `${input.id}Value`; output.htmlFor = input.id;
      control.append(output); outputs.set(key, output);
    }
    label.append(title, control);
    if (!field.options) {
      const row = previewElement('div', 'gift-motion-range');
      row.append(previewElement('span', '', String(field.min)), input, previewElement('span', '', String(field.max)));
      label.append(row);
    }
    inputs.set(key, input);
    const edit = () => { sync(key); onEdit?.({ [key]: input.value }); };
    input.addEventListener('input', edit, { signal: events.signal });
    input.addEventListener('change', edit, { signal: events.signal });
    host.append(label);
    sync(key);
  }
  initParameterRanges(host);
  return { inputs, sync, dispose() { events.abort(); disposeParameterRanges(host); } };
}
