// 编写人：Aurora
'use strict';

import { applyTheme, renderCherryRibbonQueue, renderClassicQueue, renderGoldenLilyQueue, renderIdentityQueue, renderNeonVinylQueue, renderStorybookQueue } from './queue-render.js';
import { captureScrollAnimation, configureClassicVerticalScroll, configureIdentityVerticalScroll, originalQueueRowsHtml, scheduleIdentityContentScroll, scheduleIdentityRuleScroll, scheduleIdentitySuperChatScroll, scheduleScrollAnimationRestore } from './queue-scroll.js';
import { syncQueuePanelViewport } from './queue-viewport.js';

const ILLUSTRATED_QUEUE_RENDERERS = {
  storybook: renderStorybookQueue,
  'neon-vinyl': renderNeonVinylQueue,
  'cherry-ribbon': renderCherryRibbonQueue,
  'golden-lily': renderGoldenLilyQueue
};
const ILLUSTRATED_QUEUE_STYLES = new Set(Object.keys(ILLUSTRATED_QUEUE_RENDERERS));
const ILLUSTRATED_QUEUE_ROW_GAPS = {
  storybook: 7,
  'neon-vinyl': 8,
  'cherry-ribbon': 8,
  'golden-lily': 4
};

let state = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let stateRefreshTimer = null;
let overlayResizeTimer = null;
let lastRenderKey = null;
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  connectSocket();
  window.addEventListener('resize', handleQueueViewportResize);
});

function handleQueueViewportResize() {
  if (state) {
    syncQueueViewport();
  }
  clearTimeout(overlayResizeTimer);
  overlayResizeTimer = setTimeout(relayoutQueue, 100);
}

async function loadState() {
  try {
    const response = await fetch('/api/state');
    const payload = await response.json();
    if (payload.ok) {
      lastRenderKey = null;
      state = payload.data;
      render();
    }
  } catch (error) {
    console.warn('[overlay-queue] loadState failed:', error.message || error);
  }
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  const wsUrl = `${protocol}//${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;
  const socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    lastRenderKey = null;
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'snapshot') {
      if (payload.reason === 'live:status' && state) {
        state.liveStatus = payload.state.liveStatus;
        return;
      }
      if (payload.reason && payload.reason.startsWith('songs:')) {
        return;
      }
      if (queueStyleChanged(state, payload.state)) {
        scheduleStateRefresh();
        return;
      }
      if (isSongRequestSnapshotReason(payload.reason)) {
        scheduleStateRefresh();
        return;
      }
      var newKey = computeStateKey(payload.state);
      if (newKey === lastRenderKey) {
        state = payload.state;
        return;
      }
      lastRenderKey = newKey;
      state = payload.state;
      render();
    }
  });

  socket.addEventListener('close', () => {
    const delay = Math.min(30000, 800 * Math.pow(2, Math.min(reconnectAttempts, 6)));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      loadState();
      connectSocket();
    }, delay);
  });
}

function isSongRequestSnapshotReason(reason) {
  return [
    'queue:add',
    'bilibili:danmaku',
    'bilibili:superchat'
  ].includes(reason);
}

function scheduleStateRefresh() {
  clearTimeout(stateRefreshTimer);
  stateRefreshTimer = setTimeout(function () {
    lastRenderKey = null;
    loadState();
  }, 80);
}

function computeStateKey(nextState) {
  var queue = nextState.queue || {};
  var settings = nextState.settings || {};
  var current = queue.current;
  var waiting = queue.waiting || [];
  var superChats = nextState.superChats || [];
  return JSON.stringify([
    current ? current.song_name + '|' + (current.requester_name || '') + '|' + (current.is_pinned ? '1' : '0') : '',
    waiting.map(function (item) { return item.song_name + '|' + (item.requester_name || '') + '|' + (item.is_pinned ? '1' : '0'); }),
    superChats.map(function (item) { return (item.price || 0) + '|' + (item.message || ''); }),
    settings.overlayQueueStyle,
    settings.themePrimary, settings.themeAccent, settings.themeText, settings.themeBackground,
    settings.themeOpacity, settings.themeRadius, settings.backdropBlur, settings.glowIntensity,
    settings.enableGradient, settings.gradientEnd,
    settings.overlayFontFamily, settings.overlayFontWeight,
    settings.overlaySongColor, settings.overlayRequesterColor, settings.overlayIndexColor,
    settings.illustratedQueueFontFamily, settings.illustratedQueueFontWeight,
    settings.illustratedQueueUseCustomTextColor, settings.illustratedQueueTextColor,
    settings.queueSongFontSize, settings.queueTitleFontSize, settings.identityQueueFontSize,
    settings.queueScrollMode, settings.queueScrollSpeed, settings.identityQueueScrollSpeed,
    settings.overlayShowIndex, settings.overlayIndexThreshold,
    settings.overlayTitle, settings.overlayLowPowerMode, settings.themeFontScale,
    settings.overlayPin1, settings.overlayPin2, settings.overlayPin3,
    settings.overlayRule1, settings.overlayRule2, settings.overlayRule3,
    settings.overlayRule4, settings.overlayRule5, settings.overlayRule6,
    settings.overlayRuleColor1, settings.overlayRuleColor2, settings.overlayRuleColor3,
    settings.overlayRuleColor4, settings.overlayRuleColor5, settings.overlayRuleColor6,
    settings.overlayRuleFontSize
  ]);
}

function render() {
  if (!state) return;
  const scrollState = captureScrollAnimation();
  const settings = state.settings || {};
  const style = normalizeQueueStyle(settings.overlayQueueStyle);
  applyTheme(settings, style);

  const queue = state.queue || {};
  const current = queue.current;
  const waiting = queue.waiting || [];
  const content = document.getElementById('queueContent');

  const illustratedRenderer = ILLUSTRATED_QUEUE_RENDERERS[style];
  if (illustratedRenderer) {
    illustratedRenderer(settings, current, waiting, content);
  } else if (style === 'identity') {
    renderIdentityQueue(settings, current, waiting, content, state.superChats || []);
  } else {
    renderClassicQueue(settings, current, waiting, content);
  }

  syncQueueViewport();
  scheduleScrollAnimationRestore(scrollState);
}

function syncQueueViewport() {
  const panel = document.querySelector('.overlay-panel');
  return syncQueuePanelViewport(panel);
}

function relayoutQueue() {
  if (!state) return;
  const settings = state.settings || {};
  const style = normalizeQueueStyle(settings.overlayQueueStyle);
  const content = document.getElementById('queueContent');
  const scrollState = captureScrollAnimation();

  if (ILLUSTRATED_QUEUE_STYLES.has(style)) {
    const viewport = content.querySelector(`.${style}-list-window`);
    const list = viewport && viewport.querySelector(`.${style}-list`);
    const rowGap = ILLUSTRATED_QUEUE_ROW_GAPS[style] ?? 8;
    if (viewport && list) configureIdentityVerticalScroll(viewport, list, settings, originalQueueRowsHtml(list), rowGap);
  } else if (style === 'identity') {
    const viewport = content.querySelector('.identity-list-window');
    const list = viewport && viewport.querySelector('.identity-list');
    if (viewport && list) configureIdentityVerticalScroll(viewport, list, settings, originalQueueRowsHtml(list), 4);
  } else {
    const viewport = content.querySelector('.classic-list-window');
    const list = viewport && viewport.querySelector('.classic-list');
    if (viewport && list) configureClassicVerticalScroll(viewport, list, settings, originalQueueRowsHtml(list), 5);
  }

  scheduleIdentityContentScroll(content);
  scheduleIdentitySuperChatScroll(content);
  scheduleIdentityRuleScroll(content);
  scheduleScrollAnimationRestore(scrollState);
  syncQueueViewport();
}

export function normalizeQueueStyle(style) {
  if (ILLUSTRATED_QUEUE_STYLES.has(style)) return style;
  if (style === 'identity' || style === 'festival') return 'identity';
  return 'classic';
}

export function queueStyleChanged(currentState, nextState) {
  if (!currentState || !nextState) return false;
  return normalizeQueueStyle(currentState.settings?.overlayQueueStyle)
    !== normalizeQueueStyle(nextState.settings?.overlayQueueStyle);
}
