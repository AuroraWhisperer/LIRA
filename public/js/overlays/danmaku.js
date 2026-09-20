import { createDanmakuFeed } from './danmaku-feed.js';
import { initDanmakuPreview } from './danmaku-preview.js';
import { applyStyleOptions, parseStyleOptions } from '../shared/danmaku-style-options.js';

('use strict');

const MAX_ITEMS = 50;
const DEFAULT_FULLSCREEN_DURATION_SECONDS = 6;
const OVERLAY_STYLES = new Set([
  'bubble',
  'signal',
  'minimal',
  'ranked',
  'transparent',
  'identity',
  'outline',
  'cream',
  'glow',
]);
const FIXED_STAGE_PADDING = 12;
const RANKED_CONTENT_WIDTH = 600;
const params = new URLSearchParams(location.search);
const previewMode = params.get('preview') === '1';
const previewOptions = previewMode ? (params.has('styleOptions')
  ? parseStyleOptions(params.get('styleOptions')) : window.history.state?.danmakuStyleOptions || {}) : {};

let items = [];
let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let feed = null;
let feedNeedsRender = true;
let localSocketConnected = false;
let lastLiveStatus = null;
let pendingItems = [];
let renderFrame = null;
let currentOverlayStyle = 'signal';
let currentFullscreenDurationSeconds = DEFAULT_FULLSCREEN_DURATION_SECONDS;
let currentGiftImage = 'theme';

document.addEventListener('DOMContentLoaded', () => {
  createOverlayFeed(currentOverlayStyle, currentFullscreenDurationSeconds);
  syncRankedOverlayScale();
  window.addEventListener('resize', syncRankedOverlayScale);
  if (previewMode) {
    document.body.classList.add('is-preview');
    initDanmakuPreview({
      initialStyle: params.get('style'),
      styleOptions: previewOptions,
      duration: params.get('fullscreenDurationSeconds') || window.history.state?.danmakuDuration,
      renderSamples(style) {
        applyConfiguration(style, params.get('fullscreenDurationSeconds') || window.history.state?.danmakuDuration, previewOptions);
        applyItems(previewItems());
      },
    });
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
  const seen = new Set();
  const normalizedItems = (Array.isArray(nextItems) ? nextItems : [])
    .filter((item) => {
      const key = itemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-MAX_ITEMS);
  // items already includes queued increments; leave their animation frame intact.
  if (!feedNeedsRender && JSON.stringify(normalizedItems) === JSON.stringify(items))
    return;
  if (renderFrame !== null) cancelAnimationFrame(renderFrame);
  pendingItems = [];
  renderFrame = null;
  items = normalizedItems;
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
  feedNeedsRender = false;
  renderMessageCount();
}

function renderMessageCount() {
  document.getElementById('danmakuMessageCount').textContent = String(
    items.length,
  ).padStart(2, '0');
}

function createOverlayFeed(style, durationSeconds) {
  feed?.destroy();
  feedNeedsRender = true;
  const options = {
    maxItems: MAX_ITEMS,
    offscreenViewports: previewMode ? Number.POSITIVE_INFINITY : 0,
    autoScroll: false,
    resolveAvatarUrl: bilibiliAvatarSource,
    resolveEmoteUrl: bilibiliImageSource,
    resolveGiftImageUrl: (value) => currentGiftImage === 'gift'
      ? (previewMode && value === '/img/gift-placeholder.png' ? value : bilibiliAvatarSource(value)) : '',
    getGuardLabel: guardLabel,
    showAvatar: !['outline', 'glow'].includes(style),
    showGiftTotal: ['transparent', 'cream'].includes(style),
  };
  if (['outline', 'cream', 'glow'].includes(style)) {
    if (!previewMode) options.layout = 'fullscreen-random';
    options.itemLifetimeMs = durationSeconds * 1000;
    options.expireItems = !previewMode;
  }
  feed = createDanmakuFeed(document.getElementById('danmakuFeed'), options);
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

function applyConfiguration(styleValue, durationValue, styleOptions = {}) {
  const style = OVERLAY_STYLES.has(styleValue) ? styleValue : 'signal';
  const duration = normalizeFullscreenDuration(durationValue);
  const appearance = applyStyleOptions(document, style, styleOptions);
  const changed =
    style !== currentOverlayStyle ||
    appearance.giftImage !== currentGiftImage ||
    (['outline', 'cream', 'glow'].includes(style) && duration !== currentFullscreenDurationSeconds);
  currentOverlayStyle = style;
  currentFullscreenDurationSeconds = duration;
  currentGiftImage = appearance.giftImage;
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
  const viewport = previewMode ? document.getElementById('danmakuPreviewViewport') : null;
  const scale = calculateRankedOverlayScale(viewport?.clientWidth || window.innerWidth);
  document.documentElement.style.setProperty('--ranked-scale', String(scale));
}

export function calculateRankedOverlayScale(viewportWidth) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  if (!width) return 1;
  return Math.min(1, Math.max(1, width - FIXED_STAGE_PADDING * 2) / RANKED_CONTENT_WIDTH);
}

function bilibiliAvatarSource(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.hdslb.com') || url.username || url.password)
      return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function bilibiliImageSource(value) {
  if (previewMode && value === '/img/overlays/danmaku-previews/dacall.png') return value;
  const source = bilibiliAvatarSource(value);
  if (!source) return '';
  const token = String(window.__API_TOKEN__ || '');
  return `/api/bilibili/avatar?url=${encodeURIComponent(source)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
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
    text: message || (connected ? '弹幕接收中' : '弹幕连接中'),
    connected,
  };
}

function previewItems() {
  const emotes = [{
    text: '[打call]',
    url: '/img/overlays/danmaku-previews/dacall.png',
    kind: 'inline',
    width: 96,
    height: 96,
  }];
  return [
    {
      id: 'preview-1091',
      name: '金色航线',
      message: '总督来啦，今晚也一起守到最后！[打call]',
      emotes,
      guardLevel: 1,
      medalName: '粉丝团灯牌',
      medalLevel: 28,
    },
    {
      id: 'preview-1822',
      name: '云端来信',
      message: '提督报到，这一段太好听了[打call]',
      emotes,
      guardLevel: 2,
      medalName: '粉丝团灯牌',
      medalLevel: 23,
    },
    {
      id: 'preview-4714',
      name: '阿沐',
      message: '舰长来了，前奏一响就爱上了[打call]',
      emotes,
      guardLevel: 3,
      medalName: '粉丝团灯牌',
      medalLevel: 18,
    },
    {
      id: 'preview-565',
      name: '晚风信号',
      message: '普通观众也来打 call！[打call]',
      emotes,
      medalName: '粉丝团灯牌',
      medalLevel: 9,
    },
    {
      id: 'preview-emote',
      name: '主播示例',
      isStreamer: true,
      message: '[打call]',
      emotes: [{ ...emotes[0], kind: 'sticker' }],
    },
    {
      id: 'preview-gift',
      kind: 'gift',
      name: '星河来客',
      message: '送出 小花花 × 10',
      giftName: '小花花',
      giftCount: 10,
      giftTotalPrice: 1,
      giftImageUrl: '/img/gift-placeholder.png',
    },
  ];
}
