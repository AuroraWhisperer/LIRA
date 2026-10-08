'use strict';

import { createComponentStyleEffects } from './component-style-effects.js';
import { componentEffectBounds } from './component-effect-filters.js';
import { createFlipCell } from './clock-flip.js';
import { createOverlaySocket } from './socket-client.js';
import { clockConfigFromSettings, readClockMoonConfig } from '../shared/clock-settings.js';
import { createComponentPreviewClient, isComponentPreview, isSceneComponent } from './component-preview-client.js';
import { componentOutputViewport, watchComponentOutputSize } from './component-output-size.js';

const CLOCK_STYLE_VALUES = new Set([
  'peach',
  'starlight',
  'soda',
  'timeline-horizontal',
  'timeline-vertical',
  'digital',
  'orbit',
  'flip',
  'moonlit-fan',
]);
const DEFAULT_LABELS = Object.freeze({
  peach: '今天也要闪闪发光',
  starlight: '今晚与星星一起值班',
  soda: '今天也要元气满满',
  'timeline-horizontal': '',
  'timeline-vertical': '',
  digital: '',
  orbit: '',
  flip: '',
  'moonlit-fan': '',
});
const FLIP_COLORS = Object.freeze({ flipFrameColor: '#e4e4e4', flipFaceColor: '#ffffff', flipTextColor: '#303030' });
const MAX_LABEL_LENGTH = 16;
const CLOCK_FRAME_GUTTER = 8;
const CLOCK_LAYOUTS = Object.freeze({
  peach: Object.freeze({ width: 560, height: 190 }),
  starlight: Object.freeze({ width: 560, height: 190 }),
  soda: Object.freeze({ width: 560, height: 190 }),
  'timeline-horizontal': Object.freeze({ width: 560, height: 190 }),
  'timeline-vertical': Object.freeze({ width: 220, height: 380 }),
  digital: Object.freeze({ width: 560, height: 190 }),
  orbit: Object.freeze({ width: 560, height: 190 }),
  flip: Object.freeze({ width: 560, height: 190 }),
  'moonlit-fan': Object.freeze({ width: 560, height: 360 }),
});

function readFlipColors(source) {
  return Object.fromEntries(
    Object.entries(FLIP_COLORS).map(([key, fallback]) => {
      const value = String(source[key] || '').trim();
      return [key, /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback];
    }),
  );
}

function clockLayoutForStyle(style = 'peach') {
  return CLOCK_LAYOUTS[CLOCK_STYLE_VALUES.has(style) ? style : 'peach'];
}

function clockScaleForViewport(width, height, style = 'peach', layout = clockLayoutForStyle(style)) {
  const widthScale = Math.max(0, width - CLOCK_FRAME_GUTTER) / layout.width;
  const heightScale = Math.max(0, height - CLOCK_FRAME_GUTTER) / layout.height;
  return Math.min(widthScale, heightScale);
}

function clockContentBounds(card) {
  const style = card.dataset.clockStyle;
  const layout = clockLayoutForStyle(style);
  if (['peach', 'starlight', 'soda', 'moonlit-fan'].includes(style)) return { x: 0, y: 0, ...layout };
  const selectors = style === 'flip'
    ? '.clock-content, .clock-period'
    : '.clock-year, .clock-time > *, .clock-date-row > *, .clock-period, .clock-orbit-art use';
  const effect = card.style.getPropertyValue('--component-transform');
  card.style.setProperty('--component-transform', 'translate(0px, 0px)');
  const origin = card.getBoundingClientRect();
  const scale = Number(card.style.getPropertyValue('--clock-scale')) || 1;
  const rects = [...card.querySelectorAll(selectors)].map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (effect) card.style.setProperty('--component-transform', effect);
  else card.style.removeProperty('--component-transform');
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const unscale = (value) => Math.round(value / scale * 1000) / 1000;
  return {
    x: unscale(left - origin.left),
    y: unscale(top - origin.top),
    width: unscale(Math.max(...rects.map((rect) => rect.right)) - left),
    height: unscale(Math.max(...rects.map((rect) => rect.bottom)) - top),
  };
}

function booleanParameter(params, key, fallback) {
  const value = params.get(key);
  if (value === null || value === '') return fallback;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

function cleanLabel(value, fallback) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(normalized || fallback)
    .slice(0, MAX_LABEL_LENGTH)
    .join('');
}

function readClockConfig(params) {
  const requestedStyle = params.get('style');
  const style = CLOCK_STYLE_VALUES.has(requestedStyle) ? requestedStyle : 'peach';
  const source = Object.fromEntries(params);
  return {
    style,
    showDate: booleanParameter(params, 'date', true),
    showSeconds: booleanParameter(params, 'seconds', true),
    hour12: params.get('format') === '12',
    label: cleanLabel(params.get('label'), DEFAULT_LABELS[style]),
    ...readFlipColors(source),
    ...readClockMoonConfig(source),
  };
}

function normalizeSavedClockConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const style = CLOCK_STYLE_VALUES.has(source.style) ? source.style : 'peach';
  return {
    style,
    ...(source.styleParameters ? { styleParameters: source.styleParameters } : {}),
    showDate: source.showDate !== false,
    showSeconds: source.showSeconds !== false,
    hour12: source.hourFormat === '12',
    label: cleanLabel(source.label, DEFAULT_LABELS[style]),
    ...readFlipColors(source),
    ...readClockMoonConfig(source),
  };
}

function mergeClockConfig(savedConfig, queryConfig, params) {
  const profile = params.has('style') ? savedConfig?.styleOptions?.[queryConfig.style] : null;
  const saved = normalizeSavedClockConfig({ ...savedConfig, ...profile, ...(profile ? { style: queryConfig.style } : {}) });
  const style = params.has('style') ? queryConfig.style : saved.style;
  return {
    style,
    ...(saved.styleParameters ? { styleParameters: saved.styleParameters } : {}),
    showDate: params.has('date') ? queryConfig.showDate : saved.showDate,
    showSeconds: params.has('seconds') ? queryConfig.showSeconds : saved.showSeconds,
    hour12: params.has('format') ? queryConfig.hour12 : saved.hour12,
    moonMode: params.has('moonMode') ? queryConfig.moonMode : saved.moonMode,
    moonIntervalSeconds: params.has('moonIntervalSeconds') ? queryConfig.moonIntervalSeconds : saved.moonIntervalSeconds,
    ...Object.fromEntries(Object.keys(FLIP_COLORS).map((key) => [key, params.has(key) ? queryConfig[key] : saved[key]])),
    label: params.has('label')
      ? cleanLabel(params.get('label'), DEFAULT_LABELS[style])
      : params.has('style') && !profile
        ? DEFAULT_LABELS[style]
        : saved.label,
  };
}

async function loadSavedClockConfig() {
  try {
    const response = await fetch('/api/clock/config', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.ok && payload.data ? payload.data : null;
  } catch (_) {
    return null;
  }
}

function partValue(parts, type, fallback = '') {
  return parts.find((part) => part.type === type)?.value || fallback;
}

function createClockFormatters(config) {
  const timelineStyle = config.style.startsWith('timeline-');
  return {
    time: new Intl.DateTimeFormat(timelineStyle ? 'en-US' : 'zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: config.hour12,
      hourCycle: config.hour12 ? 'h12' : 'h23',
    }),
    date: new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    }),
    weekday:
      timelineStyle || config.style === 'digital' || config.style === 'flip'
        ? new Intl.DateTimeFormat('en-US', { weekday: 'short' })
        : new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }),
  };
}

async function initClock() {
  const params = new URLSearchParams(location.search);
  const queryConfig = readClockConfig(params);
  const completeQuery = ['style', 'date', 'seconds', 'format'].every((key) => params.has(key));
  const componentPreview = isComponentPreview();
  const effects = componentPreview ? null : createComponentStyleEffects(document);
  const editingPreview = componentPreview && !isSceneComponent();
  const legacyPreview = window.parent !== window && completeQuery;
  let config = mergeClockConfig(null, queryConfig, params);
  let stateRevision = 0;
  let disposed = false;
  let clockStarted = false;
  let socketController = null;
  let stopOutputSize = null;
  let previewClient = null;
  let previousSize = '';
  let previousBounds = null;
  let previousViewportWidth = 0;
  let contentWidth = 0;
  let formatters = createClockFormatters(config);
  const card = document.getElementById('clockCard');
  const timeNode = document.getElementById('clockTime');
  const hoursNode = document.getElementById('clockHours');
  const minutesNode = document.getElementById('clockMinutes');
  const secondsNode = document.getElementById('clockSeconds');
  const periodNode = document.getElementById('clockPeriod');
  const labelNode = document.getElementById('clockLabel');
  const yearNode = document.getElementById('clockYear');
  const timeSeparatorNode = document.getElementById('clockTimeSeparator');
  const dateRow = document.getElementById('clockDateRow');
  const dateNode = document.getElementById('clockDate');
  const weekdayNode = document.getElementById('clockWeekday');
  let timer = 0;
  let styleTransition = null;
  let flipCells = null;

  function syncFlipCells() {
    if (config.style === 'flip' && !flipCells) {
      flipCells = [hoursNode, minutesNode, secondsNode, dateNode, weekdayNode].map(createFlipCell);
    } else if (config.style !== 'flip' && flipCells) {
      flipCells.forEach((cell) => cell.dispose());
      flipCells = null;
    }
  }

  function syncCardScale() {
    if (card.hidden) return;
    const decorated = document.documentElement.dataset.mediaStyle === 'clock';
    if (decorated) return;
    const viewport = componentOutputViewport();
    const naturalBounds = clockContentBounds(card);
    const bounds = componentEffectBounds(card, card.offsetWidth, card.offsetHeight, naturalBounds);
    if (!previousBounds || viewport.width !== previousViewportWidth) contentWidth = viewport.width;
    if (editingPreview && previousBounds && Math.abs(naturalBounds.width - previousBounds.width) > 0.1) {
      contentWidth = (contentWidth - CLOCK_FRAME_GUTTER) * naturalBounds.width / previousBounds.width + CLOCK_FRAME_GUTTER;
    }
    if (editingPreview) contentWidth = Math.round(contentWidth);
    previousBounds = naturalBounds;
    previousViewportWidth = viewport.width;
    const scale = clockScaleForViewport(contentWidth, editingPreview ? Infinity : viewport.height, config.style, bounds);
    card.style.setProperty('--clock-offset-x', `${-bounds.x}px`);
    card.style.setProperty('--clock-offset-y', `${-bounds.y}px`);
    card.style.setProperty('--clock-scale', String(scale));
    const size = { width: Math.round(viewport.width), contentWidth: Math.round(contentWidth),
      height: Math.ceil(bounds.height * scale + CLOCK_FRAME_GUTTER) };
    const key = JSON.stringify(size);
    if (editingPreview && key !== previousSize) {
      previousSize = key;
      previewClient.resize(size);
    }
  }

  function applyConfig(nextConfig) {
    const styleChanged = nextConfig.style !== config.style;
    if (styleChanged || nextConfig.hour12 !== config.hour12) {
      formatters = createClockFormatters(nextConfig);
    }
    config = nextConfig;
    document.documentElement.dataset.clockStyle = config.style;
    card.dataset.clockStyle = config.style;
    card.style.setProperty('--flip-frame', config.flipFrameColor);
    card.style.setProperty('--flip-face', config.flipFaceColor);
    card.style.setProperty('--flip-ink', config.flipTextColor);
    syncFlipCells();
    labelNode.textContent = config.label;
    secondsNode.hidden = !config.showSeconds;
    periodNode.hidden = !config.hour12;
    yearNode.hidden = !config.showDate;
    dateRow.hidden = !config.showDate;
    card.hidden = false;
    render();
    effects?.update('clock', config);
    if (styleChanged) {
      styleTransition?.cancel();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        styleTransition = card.animate([{ opacity: 0.6 }, { opacity: 1 }], {
          duration: 160,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        });
      }
    }
  }

  window.addEventListener('resize', syncCardScale);
  window.addEventListener('lira:effects-updated', syncCardScale);
  const receiveLegacyPreview = (event) => {
    if (
      !legacyPreview || window.parent === window ||
      event.source !== window.parent ||
      event.origin !== new URL(location.href).origin ||
      event.data?.type !== 'lira:clock-preview-config'
    )
      return;
    applyConfig(normalizeSavedClockConfig(event.data.config));
  };
  window.addEventListener('message', receiveLegacyPreview);

  function render() {
    const now = new Date();
    if (config.style === 'moonlit-fan') {
      const tone = config.moonMode === 'auto'
        ? (Math.floor(now.getTime() / (config.moonIntervalSeconds * 1000)) % 2 === 0 ? 'light' : 'dark')
        : config.moonMode;
      if (card.dataset.moonTone !== tone) {
        card.dataset.moonTone = tone;
        window.dispatchEvent(new Event('lira:effect-theme-change'));
      }
    }
    const parts = formatters.time.formatToParts(now);
    const hours = partValue(parts, 'hour', '00').padStart(2, '0');
    const minutes = partValue(parts, 'minute', '00').padStart(2, '0');
    const seconds = partValue(parts, 'second', '00').padStart(2, '0');
    const period = partValue(parts, 'dayPeriod');

    periodNode.textContent = ['digital', 'flip', 'orbit', 'moonlit-fan'].includes(config.style)
      ? (now.getHours() < 12 ? 'AM' : 'PM')
      : period;
    const dateParts = formatters.date.formatToParts(now);
    const month = partValue(dateParts, 'month', '01').padStart(2, '0');
    const day = partValue(dateParts, 'day', '01').padStart(2, '0');
    const timelineStyle = config.style.startsWith('timeline-');
    const digitalStyle = config.style === 'digital';
    const orbitStyle = config.style === 'orbit';
    yearNode.textContent = String(now.getFullYear());
    timeSeparatorNode.textContent = timelineStyle ? '—' : ':';
    const date = digitalStyle
      ? `${now.getFullYear()}-${month}-${day}`
      : orbitStyle
        ? `${now.getFullYear()}.${month}.${day}`
        : timelineStyle
          ? `${month}/${day}`
          : `${month}月${day}日`;
    const weekday =
      timelineStyle || digitalStyle ? formatters.weekday.format(now).toUpperCase() : formatters.weekday.format(now);
    if (flipCells) {
      const values = [hours, minutes, seconds, `${now.getMonth() + 1}/${now.getDate()}`, weekday.toUpperCase()];
      const animate = !card.hidden && !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      flipCells.forEach((cell, index) => {
        const visible = index < 2 || (index === 2 ? config.showSeconds : config.showDate);
        cell.update(values[index], animate && visible);
      });
    } else {
      hoursNode.textContent = hours;
      minutesNode.textContent = minutes;
      secondsNode.textContent = seconds;
      dateNode.textContent = date;
      weekdayNode.textContent = weekday;
    }
    timeNode.dateTime = now.toISOString();
    timeNode.setAttribute('aria-label', `${hours}点${minutes}分${config.showSeconds ? `${seconds}秒` : ''}`);
    syncCardScale();
  }

  function schedule() {
    if (disposed || !clockStarted) return;
    window.clearTimeout(timer);
    render();
    if (document.hidden) return;
    const delay = Math.max(120, 1020 - (Date.now() % 1000));
    timer = window.setTimeout(schedule, delay);
  }

  document.addEventListener('visibilitychange', schedule);
  function showConfig(nextConfig) {
    if (disposed) return;
    applyConfig(nextConfig);
    if (!clockStarted) { clockStarted = true; schedule(); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stateRevision += 1;
    window.clearTimeout(timer);
    socketController?.dispose();
    effects?.dispose();
    stopOutputSize?.();
    styleTransition?.cancel();
    flipCells?.forEach((cell) => cell.dispose());
    window.removeEventListener('resize', syncCardScale);
    window.removeEventListener('lira:effects-updated', syncCardScale);
    window.removeEventListener('message', receiveLegacyPreview);
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('pagehide', dispose);
  }
  window.addEventListener('pagehide', dispose, { once: true });
  if (componentPreview) {
    previewClient = createComponentPreviewClient({ onConfig: (value) => showConfig(normalizeSavedClockConfig(value)), onDispose: dispose });
    return;
  }
  if (legacyPreview) { showConfig(config); return; }
  stopOutputSize = watchComponentOutputSize('clock', syncCardScale);
  async function loadCurrent() {
    const requestedRevision = ++stateRevision;
    const savedConfig = await loadSavedClockConfig();
    if (!disposed && requestedRevision === stateRevision) showConfig(mergeClockConfig(savedConfig, queryConfig, params));
  }
  socketController = createOverlaySocket({
    onReconnect: loadCurrent,
    onClose: () => { stateRevision += 1; },
    onMessage: (payload) => {
      if (payload.type !== 'snapshot' || !payload.state?.settings) return;
      stateRevision += 1;
      showConfig(mergeClockConfig(clockConfigFromSettings(payload.state.settings), queryConfig, params));
    },
  });
  socketController.start();
  if (completeQuery) showConfig(config);
  else await loadCurrent();
}

if (typeof document !== 'undefined') initClock();

export {
  CLOCK_STYLE_VALUES,
  cleanLabel,
  clockLayoutForStyle,
  clockScaleForViewport,
  mergeClockConfig,
  normalizeSavedClockConfig,
  readClockConfig,
};
