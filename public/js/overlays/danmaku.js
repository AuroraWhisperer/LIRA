import { createDanmakuFeed } from './danmaku-feed.js';
import { initDanmakuPreview } from './danmaku-preview.js';
import { createComponentStyleEffects } from './component-style-effects.js';
import { styleParametersFor } from '../shared/component-style-parameters.js';
import { isSceneComponent, isComponentPreview } from './component-preview-client.js';
import { createSceneDanmakuDisplay } from './scene-danmaku-display.js';
import { initDanmakuComponentSource } from './danmaku-component-source.js';
import { createOverlaySocket } from './socket-client.js';
import { DANMAKU_STYLE_OPTIONS, isRandomDanmakuStyle, isFloatingDanmakuStyle, applyStyleOptions, parseStyleOptions } from '../shared/danmaku-style-options.js';

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
let socketController = null;
let feed = null;
let feedNeedsRender = true;
let localSocketConnected = false;
let lastLiveStatus = null;
let pendingItems = [];
let renderFrame = null;
let currentOverlayStyle = 'signal';
let currentFullscreenDurationSeconds = DEFAULT_FULLSCREEN_DURATION_SECONDS;
let currentGiftImage = 'theme';
let currentSpeedPixelsPerSecond = 120;
let currentRandomPlacement = {};
let effectConfig = {};
let effects;
function configureEffects(config) {
  effectConfig = config;
  effects?.update('danmaku', config);
}

document.addEventListener('DOMContentLoaded', () => {
  effects = isComponentPreview() ? null : createComponentStyleEffects(document);
  syncRankedOverlayScale();
  window.addEventListener('resize', syncRankedOverlayScale);
  if (!previewMode && params.get('source') === 'component') {
    createOverlayFeed(currentOverlayStyle, currentFullscreenDurationSeconds);
    initDanmakuComponentSource({
      configure: (config) => {
        applyConfiguration(config.style, config.fullscreenDurationSeconds, config.styleOptions, true);
        configureEffects(config);
      },
      showEntryMessages: () => styleParametersFor(effectConfig).showEntryMessages === true,
      clear: () => applyItems([]), append: appendItem, status: setConnectionState, getStyle: () => currentOverlayStyle,
      dispose() {
        window.removeEventListener('resize', syncRankedOverlayScale);
        if (renderFrame !== null) cancelAnimationFrame(renderFrame);
        feed?.destroy();
        effects?.dispose();
      },
    });
    return;
  }
  if (previewMode) {
    document.body.classList.add('is-preview');
    let previewTimer = null;
    let previewSequence = 0;
    let playNext;
    const sceneDisplay = createSceneDanmakuDisplay({ clear: () => applyItems([]), append: appendItem,
      status: setConnectionState, getStyle: () => currentOverlayStyle, showEntryMessages: () => styleParametersFor(effectConfig).showEntryMessages === true });
    initDanmakuPreview({
      initialStyle: params.get('style'),
      styleOptions: previewOptions,
      duration: params.get('fullscreenDurationSeconds') || previewHistory.danmakuDuration,
      renderConfiguration(config) {
        effectConfig = config;
        applyConfiguration(config.style, config.fullscreenDurationSeconds, config.styleOptions, true);
        applyItems([]);
      },
      renderData: sceneDisplay.update,
      renderSamples(style, options, duration, layout, config = { style }) {
        effectConfig = config;
        const samples = previewItems(style).filter((item) =>
          (!isRandomDanmakuStyle(style) && !isFloatingDanmakuStyle(style)) || item.kind !== 'superchat');
        if (styleParametersFor(config).showEntryMessages) samples.push({ id: 'preview-entry', kind: 'entry', name: '新来的观众', message: '进入了直播间' });
        clearTimeout(previewTimer);
        applyConfiguration(style, duration, options, true);
        configureEffects(config);
        applyItems([]);
        let remainingSamples = [];
        // Introduce each theme's distinctive message forms before the shuffled loop.
        const openingSamples = style === 'prismatic'
          ? [samples.find((item) => Number(item.roomGuardLevel) === 3),
            samples.find((item) => item.id === 'preview-emote'), samples.find((item) => item.kind === 'gift')]
          : style === 'moonlit'
          ? [samples.find((item) => item.kind === 'gift' && !item.giftGuardLevel),
            samples.find((item) => item.giftGuardLevel === 3)] : [];
        playNext = () => {
          if (document.hidden) return;
          // Draw without replacement so every SC tier appears before the next round.
          if (!remainingSamples.length) remainingSamples = [...samples];
          const opening = openingSamples.shift();
          const index = opening ? remainingSamples.indexOf(opening) : Math.floor(Math.random() * remainingSamples.length);
          const [sample] = remainingSamples.splice(index, 1);
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
      if (!document.hidden) playNext?.();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const disposePreview = () => {
      clearTimeout(previewTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (renderFrame !== null) cancelAnimationFrame(renderFrame);
      feed?.destroy();
      feed = null;
      effects?.dispose();
      window.removeEventListener('pagehide', disposePreview);
      window.removeEventListener('lira:preview-dispose', disposePreview);
    };
    window.addEventListener('pagehide', disposePreview, { once: true });
    window.addEventListener('lira:preview-dispose', disposePreview, { once: true });
    setConnectionState(isSceneComponent() ? '正在连接直播数据' : '模拟直播 · 随机消息', !isSceneComponent());
    return;
  }
  createOverlayFeed(currentOverlayStyle, currentFullscreenDurationSeconds);
  connectSocket();
});

function connectSocket() {
  if (socketController) return;
  socketController = createOverlaySocket({
    topic: 'danmaku',
    onOpen: () => {
      localSocketConnected = true;
      lastLiveStatus = null;
      applyLiveStatus();
    },
    onClose: () => {
      localSocketConnected = false;
      applyLiveStatus();
    },
    onMessage: (payload) => {
      if (payload.type === 'snapshot' && payload.state) {
        const style = payload.state.settings ? payload.state.settings.danmakuOverlayStyle : '';
        const duration = payload.state.settings ? payload.state.settings.danmakuFullscreenDurationSeconds : '';
        applyConfiguration(style, duration);
        if (Array.isArray(payload.state.danmakuFeed)) applyItems(payload.state.danmakuFeed);
        applyLiveStatus(payload.state.liveStatus);
        return;
      }
      if (payload.type === 'danmaku:message' && payload.item) appendItem(payload.item);
    },
  });
  window.addEventListener('pagehide', disposeSocket, { once: true });
  socketController.start();
}

function disposeSocket() {
  socketController?.dispose();
  socketController = null;
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
    showAvatar: !['outline', 'whiteframe', 'starveil', 'glow', 'starlight', 'sketch'].includes(style) && !isFloatingDanmakuStyle(style),
    showGiftTotal: ['transparent', 'whiteframe', 'cream', 'moonlit', 'starlight', 'sketch', 'prismatic'].includes(style),
  };
  if (isFloatingDanmakuStyle(style)) {
    options.layout = 'floating';
    options.speedPixelsPerSecond = currentSpeedPixelsPerSecond;
  }
  if (isRandomDanmakuStyle(style)) {
    options.layout = 'fullscreen-random';
    Object.assign(options, currentRandomPlacement);
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
  currentRandomPlacement = { centerBias: appearance.centerBias, dispersion: appearance.dispersion };
  feed?.setRandomPlacement?.(currentRandomPlacement);
  currentSpeedPixelsPerSecond = appearance.speedPixelsPerSecond || 120;
  if (isFloatingDanmakuStyle(style)) feed?.setSpeedPixelsPerSecond?.(currentSpeedPixelsPerSecond);
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
  if (isSceneComponent()) return source;
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

function previewItems(style) {
  const emotes = [
    {
      text: '[打call]',
      url: '/img/overlays/danmaku-previews/dacall.png',
      kind: 'inline',
      width: 96,
      height: 96,
    },
  ];
  const samples = [
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
    ...(['moonlit', 'prismatic'].includes(style) ? [3, 2, 1].map((giftGuardLevel) => ({
      id: `preview-guard-${giftGuardLevel}`, kind: 'gift', name: ['金色航线', '云端来信', '阿沐'][giftGuardLevel - 1],
      giftName: guardLabel(giftGuardLevel), giftCount: 1, giftGuardLevel,
      ...(style === 'prismatic' ? {
        guardAction: giftGuardLevel === 3 ? 'renew' : 'open',
        guardAccompanyDays: giftGuardLevel === 3 ? 360 : 1,
        giftTotalPrice: { 3: 138, 2: 1998, 1: 19998 }[giftGuardLevel],
      } : {}),
      avatarUrl: '/img/overlays/danmaku-ranked/viewer.webp',
    })) : []),
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
  if (style !== 'prismatic') return samples;
  const palettes = {
    1: [50, '#A773F199', '#D47AFF'], 2: [38, '#4C7DFF99', '#58A1F8'],
    3: [28, '#3FB4F699', '#5FC7F4'], 0: [9, '#5762A799', '#5762A7'],
  };
  return samples.map((item, index) => {
    const roomGuardLevel = item.guardLevel || 0;
    const [level, color, border] = palettes[roomGuardLevel];
    return {
      ...item, avatarUrl: item.avatarUrl || '/img/overlays/danmaku-ranked/viewer.webp',
      honorLevel: [70, 45, 32, 19, 28][index % 5], roomGuardLevel,
      ...(item.medalLevel ? { roomMedal: { name: item.medalName || '粉丝团灯牌', level, guardLevel: roomGuardLevel, isLight: true,
        colorStart: color, colorEnd: color, colorBorder: border, colorText: '#FFFFFF' } } : {}),
    };
  });
}
