import { createDanmakuFeed } from './danmaku-feed.js';
import { initDanmakuPreview } from './danmaku-preview.js';
import { DANMAKU_STYLE_OPTIONS, isRandomDanmakuStyle, applyStyleOptions, parseStyleOptions } from '../shared/danmaku-style-options.js';

('use strict');

const MAX_ITEMS = 50;
const PREVIEW_MESSAGE_MIN_DELAY_MS = 800;
const PREVIEW_MESSAGE_MAX_DELAY_MS = 2200;
const DEFAULT_FULLSCREEN_DURATION_SECONDS = 6;
const OVERLAY_STYLES = new Set(Object.keys(DANMAKU_STYLE_OPTIONS));
const FIXED_STAGE_PADDING = 12;
const RANKED_CONTENT_WIDTH = 600;
const GIFT_CARD_WIDTH = 460;
const MAX_GIFT_SCALE = 1.5;
const params = new URLSearchParams(location.search);
const previewMode = params.get('preview') === '1';
let previewHistory = null;
if (previewMode) {
  try { previewHistory = window.history.state || {}; } catch { previewHistory = {}; }
}
const previewOptions = previewMode
  ? params.has('styleOptions')
    ? parseStyleOptions(params.get('styleOptions'))
    : previewHistory.danmakuStyleOptions || {}
  : {};

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
  syncRankedOverlayScale();
  window.addEventListener('resize', syncRankedOverlayScale);
  if (previewMode) {
    document.body.classList.add('is-preview');
    let previewTimer = null;
    let previewSequence = 0;
    let playNext;
    initDanmakuPreview({
      initialStyle: params.get('style'),
      styleOptions: previewOptions,
      duration: params.get('fullscreenDurationSeconds') || previewHistory.danmakuDuration,
      renderSamples(style, options, duration) {
        const samples = previewItems().filter((item) =>
          !isRandomDanmakuStyle(style) || item.kind !== 'superchat');
        clearTimeout(previewTimer);
        applyConfiguration(style, duration, options, true);
        applyItems([]);
        let remainingSamples = [];
        playNext = () => {
          if (document.hidden) return;
          // Draw without replacement so every SC tier appears before the next round.
          if (!remainingSamples.length) remainingSamples = [...samples];
          const [sample] = remainingSamples.splice(Math.floor(Math.random() * remainingSamples.length), 1);
          previewSequence += 1;
          appendItem({ ...sample, id: `${sample.id}-${previewSequence}`, timestamp: Date.now() });
          const delay = PREVIEW_MESSAGE_MIN_DELAY_MS
            + Math.floor(Math.random() * (PREVIEW_MESSAGE_MAX_DELAY_MS - PREVIEW_MESSAGE_MIN_DELAY_MS + 1));
          previewTimer = setTimeout(playNext, delay);
        };
        playNext();
      },
    });
    const onVisibilityChange = () => {
      clearTimeout(previewTimer);
      if (!document.hidden) playNext();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', () => {
      clearTimeout(previewTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (renderFrame !== null) cancelAnimationFrame(renderFrame);
      feed?.destroy();
    }, { once: true });
    setConnectionState('模拟直播 · 随机消息', true);
    return;
  }
  createOverlayFeed(currentOverlayStyle, currentFullscreenDurationSeconds);
  connectSocket();
});

function connectSocket() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  const query = token ? `?token=${encodeURIComponent(token)}&topic=danmaku` : '?topic=danmaku';
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
      const style = payload.state.settings ? payload.state.settings.danmakuOverlayStyle : '';
      const duration = payload.state.settings ? payload.state.settings.danmakuFullscreenDurationSeconds : '';
      applyConfiguration(style, duration);
      if (Array.isArray(payload.state.danmakuFeed)) applyItems(payload.state.danmakuFeed);
      applyLiveStatus(payload.state.liveStatus);
      return;
    }
    if (payload.type === 'danmaku:message' && payload.item) appendItem(payload.item);
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
  if (!feedNeedsRender && JSON.stringify(normalizedItems) === JSON.stringify(items)) return;
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
  if (renderFrame === null) renderFrame = requestAnimationFrame(flushPendingItems);
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
  document.getElementById('danmakuMessageCount').textContent = String(items.length).padStart(2, '0');
}

function createOverlayFeed(style, durationSeconds) {
  feed?.destroy();
  feedNeedsRender = true;
  const options = {
    style,
    maxItems: MAX_ITEMS,
    offscreenViewports: 0,
    autoScroll: false,
    resolveAvatarUrl: bilibiliAvatarSource,
    resolveEmoteUrl: bilibiliImageSource,
    resolveGiftImageUrl: (value) =>
      currentGiftImage === 'gift'
        ? previewMode && value === '/img/gift-placeholder.png'
          ? value
          : bilibiliAvatarSource(value)
        : '',
    getGuardLabel: guardLabel,
    showAvatar: !['outline', 'glow'].includes(style),
    showGiftTotal: ['transparent', 'cream'].includes(style),
  };
  if (isRandomDanmakuStyle(style)) {
    options.layout = 'fullscreen-random';
    options.itemLifetimeMs = durationSeconds * 1000;
  }
  feed = createDanmakuFeed(document.getElementById('danmakuFeed'), options);
}

function normalizeFullscreenDuration(value) {
  let duration;
  if (typeof value === 'number') duration = value;
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) duration = Number(value.trim());
  else return DEFAULT_FULLSCREEN_DURATION_SECONDS;
  return Number.isSafeInteger(duration) && duration >= 2 && duration <= 30
    ? duration
    : DEFAULT_FULLSCREEN_DURATION_SECONDS;
}

function applyConfiguration(styleValue, durationValue, styleOptions = {}, refreshPreview = false) {
  const style = OVERLAY_STYLES.has(styleValue) ? styleValue : 'signal';
  const duration = normalizeFullscreenDuration(durationValue);
  const appearance = applyStyleOptions(document, style, styleOptions);
  const changed =
    style !== currentOverlayStyle ||
    appearance.giftImage !== currentGiftImage ||
    (isRandomDanmakuStyle(style) && duration !== currentFullscreenDurationSeconds);
  currentOverlayStyle = style;
  currentFullscreenDurationSeconds = duration;
  currentGiftImage = appearance.giftImage;
  document.body.dataset.style = style;
  if (changed || refreshPreview) createOverlayFeed(style, duration);
  syncRankedOverlayScale();
}

function itemKey(item = {}) {
  return String(item.id || `${item.uid || ''}:${item.timestamp || ''}:${item.message || ''}`);
}

function syncRankedOverlayScale() {
  const viewport = previewMode ? document.getElementById('danmakuRegion') : null;
  const width = viewport?.clientWidth || window.innerWidth;
  const scale = calculateRankedOverlayScale(width);
  const giftScale = Math.min(MAX_GIFT_SCALE, Math.max(1, width - FIXED_STAGE_PADDING * 2) / GIFT_CARD_WIDTH);
  document.documentElement.style.setProperty('--ranked-scale', String(scale));
  document.documentElement.style.setProperty('--danmaku-gift-scale', String(giftScale));
  document.documentElement.style.setProperty('--danmaku-superchat-scale', String(giftScale));
}

export function calculateRankedOverlayScale(viewportWidth) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  if (!width) return 1;
  return Math.min(1, Math.max(1, width - FIXED_STAGE_PADDING * 2) / RANKED_CONTENT_WIDTH);
}

function bilibiliAvatarSource(value) {
  if (previewMode && value === '/img/overlays/danmaku-ranked/viewer.webp') return value;
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.hdslb.com') || url.username || url.password) return '';
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
  const emotes = [
    {
      text: '[打call]',
      url: '/img/overlays/danmaku-previews/dacall.png',
      kind: 'inline',
      width: 96,
      height: 96,
    },
  ];
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
    ...[
      ['柠檬汽水', '晚上好～'],
      ['路过听一首', '刚进来，这首歌叫什么名字呀？'],
      ['橘子海', '哈哈哈哈哈哈'],
      ['山间晚风', '戴上耳机听这一段真的好舒服。今天也辛苦啦，大家早点休息！'],
    ].map(([name, message], index) => ({ id: `preview-chat-${index}`, name, message })),
    ...[
      ['星河来客', 10],
      ['云端来信', 1],
      ['金色航线', 66],
    ].map(([name, giftCount]) => ({
      id: `preview-gift-${giftCount}`,
      kind: 'gift',
      name,
      message: `送出 小花花 × ${giftCount}`,
      giftName: '小花花',
      giftCount,
      giftTotalPrice: giftCount / 10,
      giftImageUrl: '/img/gift-placeholder.png',
    })),
    ...[
      [2, '橘子汽水', '这首好听！'],
      [30, '晚风来信', '今天的歌单太喜欢了，这首可以再唱一次吗？'],
      [50, '星河来客', '刚下班就赶上喜欢的歌，今天的快乐有了～'],
      [100, '云端来信', '陪伴是最长情的告白，今晚也一起听歌。'],
      [500, '阿沐', '恭喜解锁新歌！\n以后也要一起唱下去呀。'],
      [1000, '金色航线', '谢谢每一次认真准备的直播，希望你一直做自己喜欢的事。'],
      [2000, '山间晚风', '今天的歌单太喜欢了，这首可以再唱一次吗？\n从第一场直播听到现在，每次下班打开直播间，都会觉得一天的疲惫慢慢散去。希望你也照顾好自己，按时吃饭、早点休息。我们下次直播见！'],
    ].map(([price, name, message]) => ({
      id: `preview-superchat-${price}`,
      kind: 'superchat',
      name,
      avatarUrl: '/img/overlays/danmaku-ranked/viewer.webp',
      message,
      price,
    })),
  ];
}
