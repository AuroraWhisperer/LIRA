import { createDanmakuFeed } from './danmaku-feed.js';

('use strict');

const MAX_ITEMS = 50;
const DEFAULT_FULLSCREEN_DURATION_SECONDS = 6;
const OVERLAY_STYLES = new Set([
  'bubble',
  'signal',
  'minimal',
  'ranked',
  'transparent',
  'outline',
]);
const RANKED_STAGE_WIDTH = 624;
const RANKED_STAGE_HEIGHT = 640;
const params = new URLSearchParams(location.search);
const previewMode = params.get('preview') === '1';

let items = [];
let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let feed = null;
let localSocketConnected = false;
let lastLiveStatus = null;
let pendingItems = [];
let renderFrame = null;
let currentOverlayStyle = 'signal';
let currentFullscreenDurationSeconds = DEFAULT_FULLSCREEN_DURATION_SECONDS;

document.addEventListener('DOMContentLoaded', () => {
  createOverlayFeed(currentOverlayStyle, currentFullscreenDurationSeconds);
  syncRankedOverlayScale();
  window.addEventListener('resize', syncRankedOverlayScale);
  if (previewMode) {
    document.body.classList.add('is-preview');
    applyConfiguration(params.get('style'), currentFullscreenDurationSeconds);
    applyItems(previewItems());
    setConnectionState('样式预览', true);
    return;
  }
  connectSocket();
});

function connectSocket() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  const query = token
    ? `?token=${encodeURIComponent(token)}&topic=danmaku`
    : '?topic=danmaku';
  const url = `${protocol}//${location.host}/ws${query}`;
  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    localSocketConnected = true;
    lastLiveStatus = null;
    applyLiveStatus();
  });
  socket.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (_) {
      return;
    }
    if (payload.type === 'snapshot' && payload.state) {
      const style = payload.state.settings
        ? payload.state.settings.danmakuOverlayStyle
        : '';
      const duration = payload.state.settings
        ? payload.state.settings.danmakuFullscreenDurationSeconds
        : '';
      applyConfiguration(style, duration);
      if (Array.isArray(payload.state.danmakuFeed))
        applyItems(payload.state.danmakuFeed);
      applyLiveStatus(payload.state.liveStatus);
      return;
    }
    if (payload.type === 'danmaku:message' && payload.item)
      appendItem(payload.item);
  });
  socket.addEventListener('close', () => {
    localSocketConnected = false;
    applyLiveStatus();
    const delay = Math.min(30000, 800 * 2 ** Math.min(reconnectAttempts, 6));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(connectSocket, delay);
  });
}

function applyItems(nextItems) {
  if (renderFrame !== null) cancelAnimationFrame(renderFrame);
  pendingItems = [];
  renderFrame = null;
  const seen = new Set();
  items = (Array.isArray(nextItems) ? nextItems : [])
    .filter((item) => {
      const key = itemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-MAX_ITEMS);
  render();
}

function appendItem(item) {
  const key = itemKey(item);
  if (items.some((current) => itemKey(current) === key)) return;
  items = [...items, item].slice(-MAX_ITEMS);
  pendingItems = [...pendingItems, item].slice(-MAX_ITEMS);
  if (renderFrame === null)
    renderFrame = requestAnimationFrame(flushPendingItems);
}

function flushPendingItems() {
  const nextItems = pendingItems;
  pendingItems = [];
  renderFrame = null;
  nextItems.forEach((item) => feed.append(item));
  renderMessageCount();
}

function render() {
  feed.render(items);
  renderMessageCount();
}

function renderMessageCount() {
  document.getElementById('danmakuMessageCount').textContent = String(
    items.length,
  ).padStart(2, '0');
}

function createOverlayFeed(style, durationSeconds) {
  feed?.destroy();
  const options = {
    maxItems: MAX_ITEMS,
    offscreenViewports: 0,
    autoScroll: false,
    resolveAvatarUrl: bilibiliImageSource,
    resolveEmoteUrl: bilibiliImageSource,
    getGuardLabel: guardLabel,
  };
  if (style === 'outline') {
    options.layout = 'fullscreen-random';
    options.itemLifetimeMs = durationSeconds * 1000;
    options.expireItems = !previewMode;
  }
  feed = createDanmakuFeed(
    document.getElementById('danmakuFeed'),
    options,
  );
}

function normalizeFullscreenDuration(value) {
  let duration;
  if (typeof value === 'number') duration = value;
  else if (typeof value === 'string' && /^\d+$/.test(value.trim()))
    duration = Number(value.trim());
  else return DEFAULT_FULLSCREEN_DURATION_SECONDS;
  return Number.isSafeInteger(duration) && duration >= 2 && duration <= 30
    ? duration
    : DEFAULT_FULLSCREEN_DURATION_SECONDS;
}

function applyConfiguration(styleValue, durationValue) {
  const style = OVERLAY_STYLES.has(styleValue) ? styleValue : 'signal';
  const duration = normalizeFullscreenDuration(durationValue);
  const changed =
    style !== currentOverlayStyle ||
    (style === 'outline' &&
      duration !== currentFullscreenDurationSeconds);
  currentOverlayStyle = style;
  currentFullscreenDurationSeconds = duration;
  document.body.dataset.style = style;
  if (changed) createOverlayFeed(style, duration);
  syncRankedOverlayScale();
}

function itemKey(item = {}) {
  return String(
    item.id ||
      `${item.uid || ''}:${item.timestamp || ''}:${item.message || ''}`,
  );
}

function syncRankedOverlayScale() {
  const scale = calculateRankedOverlayScale(
    window.innerWidth,
    window.innerHeight,
  );
  document.documentElement.style.setProperty('--ranked-scale', String(scale));
}

export function calculateRankedOverlayScale(viewportWidth, viewportHeight) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  const height = Math.max(0, Number(viewportHeight) || 0);
  if (!width || !height) return 1;
  return Math.min(width / RANKED_STAGE_WIDTH, height / RANKED_STAGE_HEIGHT);
}

function bilibiliImageSource(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.hdslb.com'))
      return '';
    const token = String(window.__API_TOKEN__ || '');
    return `/api/bilibili/avatar?url=${encodeURIComponent(url.toString())}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  } catch (_) {
    return '';
  }
}

function guardLabel(level) {
  if (Number(level) === 3) return '舰长';
  if (Number(level) === 2) return '提督';
  if (Number(level) === 1) return '总督';
  return '';
}

function setConnectionState(text, connected) {
  const element = document.getElementById('danmakuConnectionState');
  element.textContent = text;
  document.body.classList.toggle('is-connected', connected);
}

function applyLiveStatus(nextStatus) {
  if (nextStatus !== undefined) lastLiveStatus = nextStatus;
  const state = describeDanmakuConnection(lastLiveStatus, localSocketConnected);
  setConnectionState(state.text, state.connected);
}

export function describeDanmakuConnection(liveStatus, localConnected) {
  if (!localConnected) return { text: '连接中断 · 重试中', connected: false };
  if (!liveStatus || typeof liveStatus !== 'object') {
    return { text: '本地服务已连接 · 等待直播状态', connected: false };
  }

  const message = String(liveStatus.message || '').trim();
  if (!liveStatus.enabled) {
    return { text: message || '弹幕监听未启用', connected: false };
  }
  if (!String(liveStatus.roomId || '').trim()) {
    return { text: message || '等待设置直播间', connected: false };
  }
  const connected = Boolean(liveStatus.connected);
  return {
    text: message || (connected ? '弹幕接收中' : 'B站弹幕连接中'),
    connected,
  };
}

function previewItems() {
  return [
    {
      id: 'preview-1091',
      name: '金色航线',
      message: '今晚也一起守到最后！这段副歌听完还想再循环一遍～',
      guardLevel: 1,
      medalName: '夜航',
      medalLevel: 28,
    },
    {
      id: 'preview-1822',
      name: '云端来信',
      message: '这一段的情绪太稳了',
      guardLevel: 2,
      medalName: '星频',
      medalLevel: 23,
    },
    {
      id: 'preview-4714',
      name: '阿沐',
      message: '前奏一响就知道是今晚的歌',
      guardLevel: 3,
      medalName: '夜航',
      medalLevel: 18,
    },
    {
      id: 'preview-565',
      name: '晚风信号',
      message: '这个转音好稳 ✦',
      medalName: '星频',
      medalLevel: 9,
    },
  ];
}
