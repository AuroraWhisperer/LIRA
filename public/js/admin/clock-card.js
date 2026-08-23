'use strict';

import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';

const CLOCK_STYLE_VALUES = new Set(['peach', 'starlight']);
const CLOCK_STYLE_LABELS = Object.freeze({
  peach: '今天也要闪闪发光',
  starlight: '今晚与星星一起值班'
});
let initialized = false;
let selectedStyle = 'peach';

function buildClockUrl(baseUrl, config) {
  const url = new URL(baseUrl);
  const params = url.searchParams;
  const style = CLOCK_STYLE_VALUES.has(config.style) ? config.style : 'peach';
  params.set('style', style);
  params.set('date', config.showDate ? '1' : '0');
  params.set('seconds', config.showSeconds ? '1' : '0');
  params.set('format', config.hourFormat === '12' ? '12' : '24');
  const label = Array.from(String(config.label || '').replace(/\s+/g, ' ').trim()).slice(0, 16).join('');
  if (label) params.set('label', label);
  else params.delete('label');
  return url.href;
}

function initClockCard() {
  if (initialized) return;
  const preview = document.getElementById('clockPreview');
  const fixedUrlNode = document.getElementById('clockFixedUrl');
  const customUrlNode = document.getElementById('clockCustomUrl');
  const showDate = document.getElementById('clockShowDate');
  const showSeconds = document.getElementById('clockShowSeconds');
  const hourFormat = document.getElementById('clockHourFormat');
  const customLabel = document.getElementById('clockCustomLabel');
  const styleOptions = Array.from(document.querySelectorAll('[data-clock-style-option]'));
  if (!preview || !fixedUrlNode || !customUrlNode || !showDate || !showSeconds || !hourFormat || !customLabel || styleOptions.length !== 2) return;
  initialized = true;

  const fixedUrl = `${localOverlayOrigin(location)}/clock`;
  let currentUrl = '';
  fixedUrlNode.textContent = fixedUrl;

  function currentConfig() {
    return {
      style: selectedStyle,
      showDate: showDate.checked,
      showSeconds: showSeconds.checked,
      hourFormat: hourFormat.value,
      label: customLabel.value
    };
  }

  function render() {
    currentUrl = buildClockUrl(fixedUrl, currentConfig());
    customUrlNode.textContent = currentUrl;
    if (preview.src !== currentUrl) preview.src = currentUrl;
    styleOptions.forEach((button) => {
      const active = button.dataset.clockStyleOption === selectedStyle;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  styleOptions.forEach((button) => {
    button.addEventListener('click', () => {
      const style = button.dataset.clockStyleOption;
      if (!CLOCK_STYLE_VALUES.has(style) || style === selectedStyle) return;
      const oldDefault = CLOCK_STYLE_LABELS[selectedStyle];
      selectedStyle = style;
      if (!customLabel.value.trim() || customLabel.value.trim() === oldDefault) {
        customLabel.value = CLOCK_STYLE_LABELS[selectedStyle];
      }
      render();
    });
  });

  showDate.addEventListener('change', render);
  showSeconds.addEventListener('change', render);
  hourFormat.addEventListener('change', render);
  customLabel.addEventListener('input', render);

  document.getElementById('clockCopyFixed')?.addEventListener('click', async () => {
    try {
      await copyText(fixedUrl);
      toast('萌时钟固定网址已复制');
    } catch (error) {
      toast(error.message || '复制失败，请手动复制网址。');
    }
  });

  document.getElementById('clockCopyCustom')?.addEventListener('click', async () => {
    try {
      await copyText(currentUrl);
      toast('萌时钟带参数网址已复制');
    } catch (error) {
      toast(error.message || '复制失败，请手动复制网址。');
    }
  });

  document.getElementById('clockOpenPreview')?.addEventListener('click', () => {
    window.open(currentUrl, '_blank', 'noopener');
  });

  render();
}

export { buildClockUrl, initClockCard };

