'use strict';

const MAX_ANIMATION_QUEUE = 5;
const PLACEHOLDER = '/img/overtime-machine/gift-placeholder.svg';
const quality = new URLSearchParams(location.search).get('quality') || '';
const lowMotion = quality === 'low' || matchMedia('(prefers-reduced-motion: reduce)').matches;

let currentState = null;
let currentRevision = -1;
let anchorRemainingMs = 0;
let localAnchorMs = performance.now();
let reconnectAttempts = 0;
let reconnectTimer = null;
let animationActive = false;
const animationQueue = [];

document.addEventListener('DOMContentLoaded', () => {
  byId('overtimeMachine').classList.toggle('low-motion', lowMotion);
  loadSnapshot();
  connectSocket();
  requestAnimationFrame(renderClockFrame);
});

async function loadSnapshot() {
  try {
    const response = await fetch('/api/state');
    const payload = await response.json();
    if (payload.ok && payload.data?.overtime) applyState(payload.data.overtime, { force: true });
  } catch (error) {
    setConnectionStatus('连接中断');
    console.warn('[overtime-overlay] snapshot failed:', error.message || error);
  }
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  const url = `${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
  });
  socket.addEventListener('message', event => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'snapshot') {
      if (payload.state?.overtime) applyState(payload.state.overtime, { force: true });
      return;
    }
    if (payload.type === 'overtime:update') {
      const revision = Number(payload.state?.revision) || 0;
      if (revision <= currentRevision) return;
      applyState(payload.state, { force: false });
      if (payload.adjustment) enqueueAdjustment(payload.adjustment);
    }
  });
  socket.addEventListener('close', () => {
    setConnectionStatus('连接中断');
    const delay = Math.min(30000, 800 * (2 ** Math.min(reconnectAttempts, 6)));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      loadSnapshot();
      connectSocket();
    }, delay);
  });
}

function applyState(state, { force }) {
  if (!state) return;
  const revision = Number(state.revision) || 0;
  if (!force && revision <= currentRevision) return;
  currentRevision = revision;
  currentState = state;
  const transportElapsedMs = state.status === 'running'
    ? Math.max(0, Date.now() - (Number(state.serverNowMs) || Date.now()))
    : 0;
  anchorRemainingMs = Math.max(0, (Number(state.effectiveRemainingMs) || 0) - transportElapsedMs);
  localAnchorMs = performance.now();
  renderStatus();
  renderBackground();
  renderTickets();
}

function renderClockFrame(nowMs) {
  if (currentState) {
    const elapsed = currentState.status === 'running' ? Math.max(0, nowMs - localAnchorMs) : 0;
    byId('overtimeClock').textContent = formatClock(Math.max(0, anchorRemainingMs - elapsed));
  }
  requestAnimationFrame(renderClockFrame);
}

function renderStatus() {
  const labels = {
    disabled: '未启用',
    paused: '已暂停',
    running: '直播加班中',
    finished: '已结束'
  };
  setConnectionStatus(labels[currentState?.status] || '连接中');
}

function setConnectionStatus(label) {
  byId('overtimeStatus').textContent = label;
}

function renderBackground() {
  const machine = byId('overtimeMachine');
  const background = byId('overtimeBackground');
  const imagePath = String(currentState?.background?.path || '');
  const fit = ['cover', 'contain', 'fill'].includes(currentState?.background?.fit)
    ? currentState.background.fit
    : 'cover';
  background.style.backgroundImage = imagePath ? `url(${JSON.stringify(imagePath)})` : '';
  background.style.backgroundSize = fit;
  machine.classList.toggle('has-background', Boolean(imagePath));
}

function renderTickets() {
  const root = byId('overtimeTickets');
  const rules = Array.isArray(currentState?.rules) ? currentState.rules.filter(rule => rule.enabled) : [];
  root.style.setProperty('--ticket-count', String(Math.max(1, rules.length)));
  root.replaceChildren();
  for (const rule of rules) {
    const ticket = document.createElement('article');
    ticket.className = `overtime-ticket${rule.mode === 'random' ? ' is-random' : ''}${Number(rule.fixedSeconds) < 0 ? ' is-negative' : ''}`;
    ticket.dataset.giftId = String(rule.giftId);

    const image = document.createElement('img');
    image.className = 'overtime-ticket-image';
    image.src = rule.imagePath || PLACEHOLDER;
    image.alt = '';
    image.addEventListener('error', () => { image.src = PLACEHOLDER; }, { once: true });
    const name = document.createElement('span');
    name.className = 'overtime-ticket-name';
    name.textContent = rule.giftName || `礼物 ${rule.giftId}`;
    const time = document.createElement('strong');
    time.className = 'overtime-ticket-time';
    time.textContent = rule.mode === 'random' ? '随机' : formatSignedSeconds(rule.fixedSeconds);
    ticket.append(image, name, time);
    root.append(ticket);
  }
}

function enqueueAdjustment(adjustment) {
  if (animationQueue.length >= MAX_ANIMATION_QUEUE) {
    const lastIndex = animationQueue.length - 1;
    const previous = animationQueue[lastIndex];
    animationQueue[lastIndex] = {
      aggregate: true,
      quantity: Number(previous.quantity || 0) + Number(adjustment.quantity || 0),
      appliedDeltaSeconds: Number(previous.appliedDeltaSeconds || previous.netSeconds || 0)
        + Number(adjustment.appliedDeltaSeconds || 0),
      netSeconds: Number(previous.appliedDeltaSeconds || previous.netSeconds || 0)
        + Number(adjustment.appliedDeltaSeconds || 0)
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
  const delta = Number(adjustment.netSeconds ?? adjustment.appliedDeltaSeconds) || 0;

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
    : `整组 ${formatSignedSeconds(delta)}`;
  card.append(title, result);
  stage.replaceChildren(card);
  flashClock(delta);

  setTimeout(() => {
    stage.replaceChildren();
    animationActive = false;
    playNextAdjustment();
  }, lowMotion ? 220 : 920);
}

function highlightTicket(giftId) {
  const ticket = Array.from(byId('overtimeTickets').children).find(node => node.dataset.giftId === String(giftId));
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

function formatClock(milliseconds) {
  return formatClockSeconds(Math.ceil((Number(milliseconds) || 0) / 1000));
}

function formatSignedSeconds(seconds) {
  const value = Number(seconds) || 0;
  return `${value < 0 ? '−' : '+'}${formatClockSeconds(Math.abs(value))}`;
}

function formatClockSeconds(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatQuantity(value) {
  const quantity = Math.max(1, Math.floor(Number(value) || 1));
  return quantity > 99999 ? '99999+' : String(quantity);
}

function byId(id) {
  return document.getElementById(id);
}
