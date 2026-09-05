'use strict';

import { createOverlaySocket } from './socket-client.js';

const MAX_ANIMATION_QUEUE = 5;
const PLACEHOLDER = '/img/overtime-machine/gift-placeholder.svg';
const quality = new URLSearchParams(location.search).get('quality') || '';
const lowMotion =
  quality === 'low' || matchMedia('(prefers-reduced-motion: reduce)').matches;

let currentState = null;
let currentRevision = -1;
let anchorRemainingMs = 0;
let localAnchorMs = performance.now();
let socketController = null;
let clockTimer = null;
let lastClockValue = '';
let animationActive = false;
const animationQueue = [];

document.addEventListener('DOMContentLoaded', () => {
  byId('overtimeMachine').classList.toggle('low-motion', lowMotion);
  document.addEventListener('visibilitychange', syncClock);
  loadSnapshot();
  connectSocket();
  window.addEventListener('beforeunload', disposeSocket, { once: true });
});

async function loadSnapshot() {
  try {
    const response = await fetch('/api/state');
    const payload = await response.json();
    if (payload.ok && payload.data?.overtime)
      applyState(payload.data.overtime, { force: true });
  } catch (error) {
    setConnectionStatus('连接中断');
    console.warn('[overtime-overlay] snapshot failed:', error.message || error);
  }
}

function connectSocket() {
  if (socketController) return;
  socketController = createOverlaySocket({
    onReconnect: () => {
      loadSnapshot();
    },
    onMessage: (payload) => {
      if (payload.type === 'snapshot') {
        if (payload.state?.overtime)
          applyState(payload.state.overtime, { force: true });
        return;
      }
      if (payload.type === 'overtime:update') {
        const revision = Number(payload.state?.revision) || 0;
        if (revision <= currentRevision) return;
        applyState(payload.state, { force: false });
        if (payload.adjustment) enqueueAdjustment(payload.adjustment);
      }
    },
    onClose: () => {
      setConnectionStatus('连接中断');
    },
  });
  socketController.start();
}

function disposeSocket() {
  socketController?.dispose();
  socketController = null;
}

function applyState(state, { force }) {
  if (!state) return;
  const revision = Number(state.revision) || 0;
  if (!force && revision <= currentRevision) return;
  currentRevision = revision;
  currentState = state;
  const transportElapsedMs =
    state.status === 'running'
      ? Math.max(0, Date.now() - (Number(state.serverNowMs) || Date.now()))
      : 0;
  anchorRemainingMs = Math.max(
    0,
    (Number(state.effectiveRemainingMs) || 0) - transportElapsedMs,
  );
  localAnchorMs = performance.now();
  renderStatus();
  renderBackground();
  renderTickets();
  syncClock();
}

function syncClock() {
  clearTimeout(clockTimer);
  clockTimer = null;
  renderClock();
}

function renderClock() {
  clockTimer = null;
  if (!currentState) return;

  const nowMs = performance.now();
  const elapsed =
    currentState.status === 'running' ? Math.max(0, nowMs - localAnchorMs) : 0;
  const remainingMs = Math.max(0, anchorRemainingMs - elapsed);
  const value = formatClockDisplay(remainingMs, currentState.status);
  if (value !== lastClockValue) {
    const clock = byId('overtimeClock');
    clock.textContent = value;
    clock.classList.toggle('is-calendar', /[天年]/.test(value));
    clock.classList.toggle('is-finished', value === '该下播了');
    lastClockValue = value;
  }

  if (currentState.status !== 'running' || remainingMs <= 0 || document.hidden)
    return;
  clockTimer = setTimeout(renderClock, nextClockDelay(remainingMs));
}

function renderStatus() {
  const labels = {
    disabled: '未启用',
    paused: '已暂停',
    running: '',
    finished: '已结束',
  };
  setConnectionStatus(labels[currentState?.status] ?? '连接中');
}

function setConnectionStatus(label) {
  const statusText = byId('overtimeStatusText');
  statusText.textContent = label;
  statusText.hidden = !label;
}

function renderBackground() {
  const machine = byId('overtimeMachine');
  const background = byId('overtimeBackground');
  const imagePath = String(currentState?.background?.path || '');
  const fit = ['cover', 'contain', 'fill'].includes(
    currentState?.background?.fit,
  )
    ? currentState.background.fit
    : 'cover';
  background.style.backgroundImage = imagePath
    ? `url(${JSON.stringify(imagePath)})`
    : '';
  background.style.backgroundSize = fit;
  machine.classList.toggle('has-background', Boolean(imagePath));
}

function renderTickets() {
  const guide = byId('overtimeGiftGuide');
  const root = byId('overtimeTickets');
  const rules = Array.isArray(currentState?.rules)
    ? currentState.rules.filter((rule) => rule.enabled)
    : [];
  const ticketCount = Math.max(1, rules.length);
  const wideColumns = Math.min(3, ticketCount);
  const narrowColumns = Math.min(2, ticketCount);
  guide.hidden = rules.length === 0;
  guide.style.setProperty('--ticket-count', String(ticketCount));
  guide.style.setProperty('--ticket-wide-columns', String(wideColumns));
  guide.style.setProperty('--ticket-narrow-columns', String(narrowColumns));
  root.style.setProperty('--ticket-count', String(ticketCount));
  root.style.setProperty('--ticket-wide-columns', String(wideColumns));
  root.style.setProperty('--ticket-narrow-columns', String(narrowColumns));
  root.replaceChildren();
  for (const rule of rules) {
    const presentation = describeRuleEffect(rule);
    const ticket = document.createElement('article');
    ticket.className = `overtime-ticket ${presentation.modifier}`;
    ticket.dataset.giftId = String(rule.giftId);

    const image = document.createElement('img');
    image.className = 'overtime-ticket-image';
    image.src = rule.imagePath || PLACEHOLDER;
    image.alt = '';
    image.addEventListener(
      'error',
      () => {
        image.src = PLACEHOLDER;
      },
      { once: true },
    );
    const name = document.createElement('span');
    name.className = 'overtime-ticket-name';
    name.textContent = rule.giftName || `礼物 ${rule.giftId}`;
    const effect = document.createElement('div');
    effect.className = 'overtime-ticket-effect';
    if (presentation.verb) {
      const verb = document.createElement('span');
      verb.textContent = presentation.verb;
      effect.append(verb);
    }
    const time = document.createElement('strong');
    time.className = 'overtime-ticket-time';
    time.textContent = presentation.value;
    effect.append(time);
    ticket.title = `${name.textContent}：${presentation.verb}${presentation.value}`;
    ticket.append(image, name, effect);
    root.append(ticket);
  }
}

function enqueueAdjustment(adjustment) {
  if (adjustment?.mode === 'display') return;
  if (animationQueue.length >= MAX_ANIMATION_QUEUE) {
    const lastIndex = animationQueue.length - 1;
    const previous = animationQueue[lastIndex];
    animationQueue[lastIndex] = {
      aggregate: true,
      quantity:
        Number(previous.quantity || 0) + Number(adjustment.quantity || 0),
      appliedDeltaSeconds:
        Number(previous.appliedDeltaSeconds || previous.netSeconds || 0) +
        Number(adjustment.appliedDeltaSeconds || 0),
      netSeconds:
        Number(previous.appliedDeltaSeconds || previous.netSeconds || 0) +
        Number(adjustment.appliedDeltaSeconds || 0),
    };
  } else {
    animationQueue.push(adjustment);
  }
  playNextAdjustment();
}

function playNextAdjustment() {
  if (animationActive || animationQueue.length === 0) return;
  animationActive = true;
  const adjustment = animationQueue.shift();
  const delta =
    Number(adjustment.netSeconds ?? adjustment.appliedDeltaSeconds) || 0;

  if (!adjustment.aggregate) highlightTicket(adjustment.giftId);
  const stage = byId('overtimeAdjustmentStage');
  const card = document.createElement('div');
  card.className = `overtime-adjustment-card${delta < 0 ? ' is-negative' : ''}${adjustment.mode === 'random' ? ' is-random' : ''}`;
  const title = document.createElement('strong');
  title.textContent = adjustment.aggregate
    ? '连续礼物 · 净变化'
    : `${adjustment.giftName || adjustment.giftId} ×${formatQuantity(adjustment.quantity)}`;
  const result = document.createElement('span');
  result.textContent = adjustment.aggregate
    ? formatSignedSeconds(delta)
    : Number(adjustment.applicationCount) > 1
      ? `按数量结算 ${adjustment.applicationCount} 次 · ${formatSignedSeconds(delta)}`
      : `结算 1 次 · ${formatAdjustmentEffect(adjustment.effect, delta)}`;
  card.append(title, result);
  stage.replaceChildren(card);
  flashClock(delta);

  setTimeout(
    () => {
      stage.replaceChildren();
      animationActive = false;
      playNextAdjustment();
    },
    lowMotion ? 220 : 920,
  );
}

function highlightTicket(giftId) {
  const ticket = Array.from(byId('overtimeTickets').children).find(
    (node) => node.dataset.giftId === String(giftId),
  );
  if (!ticket) return;
  ticket.classList.remove('is-hit');
  void ticket.offsetWidth;
  ticket.classList.add('is-hit');
  setTimeout(() => ticket.classList.remove('is-hit'), lowMotion ? 220 : 920);
}

function flashClock(delta) {
  const clock = byId('overtimeClock');
  const className = delta < 0 ? 'is-negative' : 'is-positive';
  clock.classList.remove('is-positive', 'is-negative');
  void clock.offsetWidth;
  clock.classList.add(className);
  setTimeout(() => clock.classList.remove(className), lowMotion ? 220 : 920);
}

function nextClockDelay(remainingMs) {
  const remaining = Math.max(0, Number(remainingMs) || 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const yearMs = 365 * dayMs;
  const resolutionMs =
    remaining >= yearMs
      ? 60 * 60 * 1000
      : remaining >= dayMs
        ? 60 * 1000
        : 1000;
  const boundaryDelay = remaining % resolutionMs || resolutionMs;
  const tierBoundaryDelay =
    remaining >= yearMs
      ? remaining - yearMs || 1000
      : remaining >= dayMs
        ? remaining - dayMs || 1000
        : boundaryDelay;
  return Math.max(25, Math.ceil(Math.min(boundaryDelay, tierBoundaryDelay)));
}

function formatClockDisplay(milliseconds, status) {
  const remainingMs = Math.max(0, Number(milliseconds) || 0);
  const finished =
    status === 'finished' || (status === 'running' && remainingMs === 0);
  return finished ? '该下播了' : formatClock(remainingMs);
}

function formatClock(milliseconds) {
  return formatClockSeconds(Math.ceil((Number(milliseconds) || 0) / 1000));
}

function formatClockSeconds(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(whole / 86400);
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `${years}年 ${days % 365}天 ${Math.floor((whole % 86400) / 3600)}小时`;
  }
  if (days > 0) {
    const hours = Math.floor((whole % 86400) / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    return `${days}天 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function describeRuleEffect(rule) {
  if (rule?.mode === 'display') {
    return {
      modifier: 'is-display',
      verb: '',
      value: String(rule.displayText || '展示'),
    };
  }
  if (rule?.mode === 'random') {
    return { modifier: 'is-random', verb: '', value: '盲盒' };
  }
  const effect = normalizeRuleEffect(rule?.fixedEffect, rule?.fixedSeconds);
  if (effect.operation === 'add') {
    return {
      modifier: 'is-positive',
      verb: '加时',
      value: formatDurationLabel(effect.value),
    };
  }
  if (effect.operation === 'subtract') {
    return {
      modifier: 'is-negative',
      verb: '减时',
      value: formatDurationLabel(effect.value),
    };
  }
  if (effect.operation === 'multiply') {
    return { modifier: 'is-multiply', verb: '时间', value: `×${effect.value}` };
  }
  if (effect.operation === 'divide') {
    return { modifier: 'is-divide', verb: '时间', value: `÷${effect.value}` };
  }
  return { modifier: 'is-clear', verb: '时间', value: '清零' };
}

function normalizeRuleEffect(effect, legacySeconds) {
  const operation = String(effect?.operation || '');
  if (['add', 'subtract', 'multiply', 'divide', 'clear'].includes(operation)) {
    return {
      operation,
      value: Math.max(0, Math.floor(Number(effect.value) || 0)),
    };
  }
  const seconds = Math.trunc(Number(legacySeconds) || 0);
  return seconds < 0
    ? { operation: 'subtract', value: Math.abs(seconds) }
    : { operation: 'add', value: seconds };
}

function formatDurationLabel(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const parts = [];
  if (hours) parts.push(`${hours}小时`);
  if (minutes) parts.push(`${minutes}分`);
  if (rest) parts.push(`${rest}秒`);
  return parts.join('') || '0秒';
}

function formatSignedSeconds(seconds) {
  const value = Number(seconds) || 0;
  return `${value < 0 ? '−' : '+'}${formatClockSeconds(Math.abs(value))}`;
}

function formatAdjustmentEffect(effect, deltaSeconds) {
  if (effect?.operation === 'multiply')
    return `×${effect.value}（${formatSignedSeconds(deltaSeconds)}）`;
  if (effect?.operation === 'divide')
    return `÷${effect.value}（${formatSignedSeconds(deltaSeconds)}）`;
  if (effect?.operation === 'clear') return '清零';
  return formatSignedSeconds(deltaSeconds);
}

function formatQuantity(value) {
  const quantity = Math.max(1, Math.floor(Number(value) || 1));
  return quantity > 99999 ? '99999+' : String(quantity);
}

function byId(id) {
  return document.getElementById(id);
}
