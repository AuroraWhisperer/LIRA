'use strict';

const CLOCK_STYLE_VALUES = new Set(['peach', 'starlight']);
const DEFAULT_LABELS = Object.freeze({
  peach: '今天也要闪闪发光',
  starlight: '今晚与星星一起值班'
});
const MAX_LABEL_LENGTH = 16;

function booleanParameter(params, key, fallback) {
  const value = params.get(key);
  if (value === null || value === '') return fallback;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

function cleanLabel(value, fallback) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return Array.from(normalized || fallback).slice(0, MAX_LABEL_LENGTH).join('');
}

function readClockConfig(params) {
  const requestedStyle = params.get('style');
  const style = CLOCK_STYLE_VALUES.has(requestedStyle) ? requestedStyle : 'peach';
  return {
    style,
    showDate: booleanParameter(params, 'date', true),
    showSeconds: booleanParameter(params, 'seconds', true),
    hour12: params.get('format') === '12',
    label: cleanLabel(params.get('label'), DEFAULT_LABELS[style])
  };
}

function partValue(parts, type, fallback = '') {
  return parts.find(part => part.type === type)?.value || fallback;
}

function createClockFormatters(config) {
  return {
    time: new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: config.hour12,
      hourCycle: config.hour12 ? 'h12' : 'h23'
    }),
    date: new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }),
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'long' })
  };
}

function initClock() {
  const config = readClockConfig(new URLSearchParams(location.search));
  const formatters = createClockFormatters(config);
  const card = document.getElementById('clockCard');
  const timeNode = document.getElementById('clockTime');
  const hoursNode = document.getElementById('clockHours');
  const minutesNode = document.getElementById('clockMinutes');
  const secondsNode = document.getElementById('clockSeconds');
  const periodNode = document.getElementById('clockPeriod');
  const labelNode = document.getElementById('clockLabel');
  const dateRow = document.getElementById('clockDateRow');
  const dateNode = document.getElementById('clockDate');
  const weekdayNode = document.getElementById('clockWeekday');
  let timer = 0;

  document.documentElement.dataset.clockStyle = config.style;
  card.dataset.clockStyle = config.style;
  labelNode.textContent = config.label;
  secondsNode.hidden = !config.showSeconds;
  periodNode.hidden = !config.hour12;
  dateRow.hidden = !config.showDate;

  function render() {
    const now = new Date();
    const parts = formatters.time.formatToParts(now);
    const hours = partValue(parts, 'hour', '00').padStart(2, '0');
    const minutes = partValue(parts, 'minute', '00').padStart(2, '0');
    const seconds = partValue(parts, 'second', '00').padStart(2, '0');
    const period = partValue(parts, 'dayPeriod');

    hoursNode.textContent = hours;
    minutesNode.textContent = minutes;
    secondsNode.textContent = seconds;
    periodNode.textContent = period;
    const dateParts = formatters.date.formatToParts(now);
    const month = partValue(dateParts, 'month', '01').padStart(2, '0');
    const day = partValue(dateParts, 'day', '01').padStart(2, '0');
    dateNode.textContent = `${month}月${day}日`;
    weekdayNode.textContent = formatters.weekday.format(now);
    timeNode.dateTime = now.toISOString();
    timeNode.setAttribute('aria-label', `${hours}点${minutes}分${config.showSeconds ? `${seconds}秒` : ''}`);
  }

  function schedule() {
    window.clearTimeout(timer);
    render();
    if (document.hidden) return;
    const delay = Math.max(120, 1020 - (Date.now() % 1000));
    timer = window.setTimeout(schedule, delay);
  }

  document.addEventListener('visibilitychange', schedule);
  schedule();
}

initClock();

export { CLOCK_STYLE_VALUES, cleanLabel, readClockConfig };
