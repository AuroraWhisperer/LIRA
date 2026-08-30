'use strict';

import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';

const CLOCK_STYLE_VALUES = new Set([
  'peach',
  'starlight',
  'soda',
  'timeline-horizontal',
  'timeline-vertical',
]);
const CLOCK_STYLE_LABELS = Object.freeze({
  peach: '今天也要闪闪发光',
  starlight: '今晚与星星一起值班',
  soda: '今天也要元气满满',
  'timeline-horizontal': '',
  'timeline-vertical': '',
});
const SETTINGS_ENDPOINT = '/api/' + 'settings';
const CLOCK_CONFIG_ENDPOINT = '/api/clock/config';
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
  const label = Array.from(
    String(config.label || '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, 16)
    .join('');
  if (label) params.set('label', label);
  else params.delete('label');
  return url.href;
}

function clockSettingsPayload(config) {
  return {
    clockStyle: config.style,
    clockShowDate: config.showDate ? 'true' : 'false',
    clockShowSeconds: config.showSeconds ? 'true' : 'false',
    clockHourFormat: config.hourFormat,
    clockLabel: config.label,
  };
}

function isTimelineStyle(style) {
  return style === 'timeline-horizontal' || style === 'timeline-vertical';
}

function usesDefaultClockLabel(style, label) {
  const current = String(label || '').trim();
  return !current || current === (CLOCK_STYLE_LABELS[style] || '');
}

function initClockCard() {
  if (initialized) return;
  const preview = document.getElementById('clockPreview');
  const fixedUrlNode = document.getElementById('clockFixedUrl');
  const showDate = document.getElementById('clockShowDate');
  const showSeconds = document.getElementById('clockShowSeconds');
  const hourFormat = document.getElementById('clockHourFormat');
  const customLabel = document.getElementById('clockCustomLabel');
  const customLabelHelp = document.getElementById('clockCustomLabelHelp');
  const recommendedSize = document.getElementById('clockRecommendedSize');
  const styleOptions = Array.from(
    document.querySelectorAll('[data-clock-style-option]'),
  );
  if (
    !preview ||
    !fixedUrlNode ||
    !showDate ||
    !showSeconds ||
    !hourFormat ||
    !customLabel ||
    styleOptions.length !== CLOCK_STYLE_VALUES.size
  )
    return;
  initialized = true;

  const fixedUrl = `${localOverlayOrigin(location)}/clock`;
  let persistTimer = 0;
  let hydrated = false;
  let hydrating = true;
  fixedUrlNode.textContent = fixedUrl;

  function currentConfig() {
    return {
      style: selectedStyle,
      showDate: showDate.checked,
      showSeconds: showSeconds.checked,
      hourFormat: hourFormat.value,
      label: customLabel.value,
    };
  }

  function render() {
    const previewUrl = buildClockUrl(fixedUrl, currentConfig());
    if (preview.src !== previewUrl) preview.src = previewUrl;
    const timeline = isTimelineStyle(selectedStyle);
    const vertical = selectedStyle === 'timeline-vertical';
    preview.dataset.clockStyle = selectedStyle;
    showDate.disabled = hydrating;
    showSeconds.disabled = hydrating;
    hourFormat.disabled = hydrating;
    customLabel.disabled = hydrating || timeline;
    if (customLabelHelp)
      customLabelHelp.textContent = timeline
        ? '透明时间轴不显示'
        : '最多 16 个字';
    if (recommendedSize)
      recommendedSize.textContent = vertical
        ? '推荐浏览器源：240 × 400'
        : '推荐浏览器源：580 × 210';
    styleOptions.forEach((button) => {
      const active = button.dataset.clockStyleOption === selectedStyle;
      button.disabled = hydrating;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  async function persist() {
    if (!hydrated) return;
    try {
      const response = await fetch(SETTINGS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clockSettingsPayload(currentConfig())),
      });
      if (!response.ok) throw new Error('萌时钟配置保存失败');
    } catch (error) {
      toast(error.message || '萌时钟配置保存失败，请重试。');
    }
  }

  function schedulePersist() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persist, 220);
  }

  function handleConfigChange() {
    render();
    schedulePersist();
  }

  async function loadSavedConfig() {
    try {
      const response = await fetch(CLOCK_CONFIG_ENDPOINT, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('萌时钟配置读取失败');
      const payload = await response.json();
      const config = payload?.ok ? payload.data : null;
      if (!config) throw new Error('萌时钟配置读取失败');
      selectedStyle = CLOCK_STYLE_VALUES.has(config.style)
        ? config.style
        : 'peach';
      showDate.checked = config.showDate !== false;
      showSeconds.checked = config.showSeconds !== false;
      hourFormat.value = config.hourFormat === '12' ? '12' : '24';
      customLabel.value = String(
        config.label || CLOCK_STYLE_LABELS[selectedStyle],
      );
    } catch (error) {
      // Keep the defaults when the optional saved-config read fails.
      void error;
    } finally {
      hydrated = true;
      hydrating = false;
      render();
    }
  }

  styleOptions.forEach((button) => {
    button.addEventListener('click', () => {
      const style = button.dataset.clockStyleOption;
      if (!CLOCK_STYLE_VALUES.has(style) || style === selectedStyle) return;
      const currentLabel = customLabel.value.trim();
      // Only replace the label when it is the default for the style that is
      // currently selected. A user may intentionally choose text that happens
      // to be another style's built-in label.
      const usesDefaultLabel = usesDefaultClockLabel(
        selectedStyle,
        currentLabel,
      );
      selectedStyle = style;
      if (!isTimelineStyle(selectedStyle) && usesDefaultLabel) {
        customLabel.value = CLOCK_STYLE_LABELS[selectedStyle];
      }
      handleConfigChange();
    });
  });

  showDate.addEventListener('change', handleConfigChange);
  showSeconds.addEventListener('change', handleConfigChange);
  hourFormat.addEventListener('change', handleConfigChange);
  customLabel.addEventListener('input', handleConfigChange);

  document
    .getElementById('clockCopyFixed')
    ?.addEventListener('click', async () => {
      try {
        await copyText(fixedUrl);
        toast('萌时钟固定网址已复制');
      } catch (error) {
        toast(error.message || '复制失败，请手动复制网址。');
      }
    });

  document.getElementById('clockOpenPreview')?.addEventListener('click', () => {
    window.open(fixedUrl, '_blank', 'noopener');
  });

  render();
  loadSavedConfig();
}

export {
  buildClockUrl,
  clockSettingsPayload,
  initClockCard,
  usesDefaultClockLabel,
};
