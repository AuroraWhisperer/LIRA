import { GIFT_PALETTE } from '../../shared/gift-banner.js';
import { GIFT_BANNER_TAILS, GIFT_BANNER_TEXTURES, validGiftThresholds } from '../../shared/gift-banner-styles.js';

const tierNames = ['浅蓝', '紫蓝', '粉红', '橙金'];

function makeSwatch([start, end]) {
  const swatch = document.createElement('span');
  swatch.className = 'gift-tier-swatch';
  swatch.style.setProperty('--gift-start', start);
  swatch.style.setProperty('--gift-end', end);
  return swatch;
}

export function createGiftExportStyleEditor({ configure, preview, updateControls }) {
  const get = id => document.getElementById(id);
  const tail = get('giftExportTail');
  const texture = get('giftExportTexture');
  const tiers = get('giftExportTiers');
  const error = get('giftExportTierError');
  const editor = get('giftExportStyleEditor');
  const summary = get('giftExportStyleSummary');
  let taskId;
  let source;
  let accepted;
  for (const [select, options] of [[tail, GIFT_BANNER_TAILS], [texture, GIFT_BANNER_TEXTURES]]) {
    for (const [value, label] of Object.entries(options)) select.add(new Option(label, value));
  }
  for (const palette of [summary, tiers].map(node => node.querySelector('.gift-export-palette'))) {
    palette.append(...GIFT_PALETTE.map(makeSwatch));
  }
  const inputs = GIFT_PALETTE.map((colors, index) => {
    const row = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = '0.01';
    input.required = true;
    input.setAttribute('aria-label', `${tierNames[index]}起始金额（元）`);
    input.setAttribute('aria-describedby', error.id);
    if (!index) {
      input.readOnly = true;
      input.value = '0';
    }
    row.append(makeSwatch(colors), tierNames[index], input);
    tiers.querySelector('.gift-export-tier-inputs').append(row);
    return input;
  }).slice(1);

  function draft() {
    return {
      tailStyle: tail.value, textureStyle: texture.value,
      thresholds: inputs.map(input => Math.round(input.valueAsNumber * 100)),
    };
  }

  function edit(event) {
    const style = draft();
    const valid = inputs.every(input => input.validity.valid) && validGiftThresholds(style.thresholds);
    error.hidden = valid;
    inputs.forEach((input, i) => {
      const invalid = !input.validity.valid || style.thresholds[i] <= (style.thresholds[i - 1] ?? 0);
      input.setAttribute('aria-invalid', String(invalid));
    });
    updateControls();
    if (!valid) return;
    preview(style);
    if (event.type === 'change') configure({ customStyle: style }, event.target.type === 'number');
  }
  editor.addEventListener('input', event => { if (event.target.type === 'number') edit(event); });
  editor.addEventListener('change', event => { if (event.target.matches('select, input')) edit(event); });
  get('giftExportStyleSource').addEventListener('change', event => {
    if (event.target.matches('input[type="radio"]')) configure({ styleSource: event.target.value });
  });

  return {
    get invalid() { return !error.hidden; },
    reflect(task, reset = false) {
      const custom = task.styleSource === 'custom';
      const config = task.snapshot.config;
      const changed = taskId !== task.id || source !== task.styleSource;
      taskId = task.id;
      source = task.styleSource;
      editor.hidden = !custom;
      summary.hidden = custom;
      get('giftExportStyleScope').hidden = !custom;
      const textureLabel = config.textureStyle === 'solid' ? '纯色' : GIFT_BANNER_TEXTURES[config.textureStyle];
      get('giftExportStyleName').textContent = `${GIFT_BANNER_TAILS[config.tailStyle]} · ${textureLabel}`;
      summary.title = [0, ...config.thresholds].map((amount, i) => `${tierNames[i]} ${amount / 100} 元起`).join(' · ');
      if (changed) tiers.open = false;
      if (changed || reset) {
        const radios = get('giftExportStyleSource').querySelectorAll('input');
        radios.forEach(radio => { radio.checked = radio.value === (custom ? 'custom' : 'follow'); });
        tail.value = config.tailStyle;
        texture.value = config.textureStyle;
        inputs.forEach((input, i) => {
          input.value = config.thresholds[i] / 100;
          input.removeAttribute('aria-invalid');
        });
        error.hidden = true;
      }
      accepted = config;
    },
    previewConfig() {
      return !editor.hidden && error.hidden ? draft() : accepted;
    },
  };
}
