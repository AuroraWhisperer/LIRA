'use strict';

let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let currentState = null;
let renderedSpinId = '';
let rotation = 0;
let animationToken = 0;
let spinRequestPending = false;

document.addEventListener('DOMContentLoaded', () => {
  const centerButton = byId('wheelCenterButton');
  centerButton.addEventListener('click', spinFromWheel);
  centerButton.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    spinFromWheel();
  });
  loadState();
  connectSocket();
});

async function loadState() {
  try {
    const token = window.__API_TOKEN__;
    const response = await fetch('/api/wheel', {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
    const payload = await response.json();
    if (payload.ok) renderState(payload.data);
  } catch (_) {
    setMessage('等待转盘连接');
  }
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  socket = new WebSocket(`${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  socket.addEventListener('open', () => { reconnectAttempts = 0; });
  socket.addEventListener('message', event => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'wheel:update') renderState(payload.state);
  });
  socket.addEventListener('close', () => {
    const delay = Math.min(30000, 800 * (2 ** Math.min(reconnectAttempts, 6)));
    reconnectAttempts += 1;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { loadState(); connectSocket(); }, delay);
  });
}

function renderState(state) {
  currentState = state || { entries: [], totalWeight: 0, spin: null, lastResult: null };
  drawSegments(currentState.entries || []);
  const spin = currentState.spin;
  setCenterBusy(Boolean(spin));
  if (spin && spin.id !== renderedSpinId) {
    renderedSpinId = spin.id;
    animateSpin(spin, currentState.entries || []);
    return;
  }
  if (!spin && currentState.lastResult) highlightResult(currentState.lastResult.index);
  if (!(currentState.entries || []).length) setMessage('等待主播配置转盘');
  else if (!spin && !currentState.lastResult) setMessage('点击中心 GO 开始');
}

function drawSegments(entries) {
  const root = byId('wheelSegments');
  root.replaceChildren();
  const total = entries.reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
  if (!total) return;
  let cursor = -Math.PI / 2;
  entries.forEach((entry, index) => {
    const angle = Math.PI * 2 * (Number(entry.weight) / total);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('wheel-segment');
    path.dataset.index = String(index);
    path.style.fill = palette[index % palette.length];
    path.setAttribute('d', segmentPath(cursor, cursor + angle));
    root.append(path);
    const middle = cursor + angle / 2;
    root.append(createRadialLabel(entry.label, index, middle));
    cursor += angle;
  });
}

function createRadialLabel(value, index, middle) {
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  const chars = Array.from(String(value || '')).slice(0, 12);
  const fontSize = Math.min(22, Math.max(12, 156 / Math.max(chars.length, 1)));
  const point = polar(300, 300, 205, middle);
  label.classList.add('wheel-label');
  label.dataset.index = String(index);
  label.setAttribute('x', String(point.x));
  label.setAttribute('y', String(point.y));
  label.style.fontSize = `${fontSize}px`;
  label.setAttribute('transform', `rotate(${middle * 180 / Math.PI + 90} ${point.x} ${point.y})`);
  chars.forEach((char, charIndex) => {
    const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan.setAttribute('x', String(point.x));
    tspan.setAttribute('dy', String(charIndex === 0
      ? -((chars.length - 1) * fontSize) / 2
      : fontSize));
    tspan.textContent = char === ' ' ? '·' : char;
    label.append(tspan);
  });
  return label;
}

function animateSpin(spin, entries) {
  if (!entries.length) return;
  const elapsed = Math.max(0, Date.now() - Number(spin.startedAt));
  const remaining = Math.max(0, Number(spin.durationMs) - elapsed);
  const total = entries.reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
  const before = entries.slice(0, spin.index).reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
  const selectedAngle = (before + Number(entries[spin.index].weight || 0) / 2) / total * 360 - 90;
  const targetAngle = -90 - selectedAngle;
  const target = rotation + Number(spin.turns || 5) * 360
    + ((targetAngle - rotation) % 360 + 360) % 360;
  const group = byId('wheelGroup');
  group.style.transition = remaining && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? `transform ${remaining}ms cubic-bezier(.12,.72,.12,1)` : 'none';
  group.style.transform = `rotate(${target}deg)`;
  rotation = target;
  setMessage('转盘转动中…');
  const token = ++animationToken;
  window.setTimeout(() => {
    if (token !== animationToken) return;
    highlightResult(spin.index);
  }, remaining || 40);
}

function highlightResult(index) {
  document.querySelectorAll('.wheel-segment, .wheel-label').forEach(element => {
    const selected = Number(element.dataset.index) === Number(index);
    element.classList.toggle('is-selected', selected);
    element.classList.toggle('is-dim', !selected);
  });
  const label = currentState?.entries?.[index]?.label || '已抽取';
  setMessage(`抽中：${label}`);
}

function segmentPath(start, end) {
  const startPoint = polar(300, 300, 270, start);
  const endPoint = polar(300, 300, 270, end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M 300 300 L ${startPoint.x} ${startPoint.y} A 270 270 0 ${largeArc} 1 ${endPoint.x} ${endPoint.y} Z`;
}

function polar(cx, cy, radius, angle) { return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }; }
function setMessage(message) { byId('wheelMessage').textContent = message; }
function byId(id) { return document.getElementById(id); }

async function spinFromWheel() {
  if (spinRequestPending || currentState?.spin) return;
  if ((currentState?.entries || []).length < 2) {
    setMessage('请先等待主播配置至少两个选项');
    return;
  }
  spinRequestPending = true;
  setCenterBusy(true);
  try {
    const token = window.__API_TOKEN__;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch('/api/wheel/spin', {
      method: 'POST',
      headers,
      body: '{}'
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '转盘暂时无法抽取');
    renderState(payload.data);
  } catch (error) {
    setCenterBusy(false);
    setMessage(error.message || '转盘暂时无法抽取');
  } finally {
    spinRequestPending = false;
  }
}

function setCenterBusy(busy) {
  const button = byId('wheelCenterButton');
  const hasEntries = (currentState?.entries || []).length >= 2;
  button.classList.toggle('is-busy', busy);
  button.setAttribute('aria-disabled', String(busy || !hasEntries));
  button.setAttribute('aria-busy', String(busy));
}

const palette = ['#e65f91', '#f1a04b', '#58b9c8', '#7568ca', '#c45aa8', '#56a878', '#efcf68', '#db6c63', '#6c9ee8', '#a875d0', '#4db3a4', '#dd7ab1'];
