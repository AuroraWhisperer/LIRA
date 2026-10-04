// 礼物 Overlay：边框与官方全屏特效各由独立播放器负责。
'use strict';

import { createFrameController } from './gift-effects-frame.js';
import { createGiftFramePlayer } from './gift-frame-player.js';
import { createGiftFrameQueue } from './gift-frame-queue.js';
import { createGiftEffectPlayer } from './gift-effect-player.js';
import { createGuardThanksQueue } from './gift-effects-guard.js';
import { mountGiftEffectComponent } from './gift-effects-component.js';

(function () {
  if (mountGiftEffectComponent()) return;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get('debug') === '1';
  const PREVIEW_MODE = params.get('preview') === '1';
  const GUARD_PREVIEW_TIER = params.get('guardPreview');
  const frameRoot = document.getElementById('giftFrame');
  const ribbonRoot = document.getElementById('giftRibbon');
  const status = document.getElementById('giftEffectStatus');
  const frameQueue = createGiftFrameQueue({
    player: createGiftFramePlayer({ frameRoot, ribbonRoot }),
    canPlay: () => !PREVIEW_MODE || document.visibilityState !== 'hidden',
    onError: (error) => showStatus(`礼物边框播放失败：${error.message || error}`),
  });
  const effectPlayer = createGiftEffectPlayer({
    stage: document.getElementById('giftEffectStage'),
    onError: (error) => showStatus(error.message),
  });
  const guardThanks = createGuardThanksQueue({
    root: document.getElementById('guardThanksRoot'),
    resolveMotion: resolveGuardMotion,
    onError: (error) => showStatus(`大航海感谢播放失败：${error.message || error}`),
  });
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let socket = null;
  let disposed = false;

  if (DEBUG) document.body.classList.add('is-debug');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  function init() {
    window.addEventListener(
      'pagehide',
      () => {
        disposed = true;
        clearTimeout(reconnectTimer);
        socket?.close();
        frameQueue.dispose();
        effectPlayer.dispose();
        guardThanks.dispose();
      },
      { once: true },
    );
    if (PREVIEW_MODE && GUARD_PREVIEW_TIER) {
      window.setTimeout(() => guardThanks.enqueue(createGuardPreviewPayload(GUARD_PREVIEW_TIER)), 80);
    } else if (PREVIEW_MODE) {
      window.setTimeout(() => frameQueue.enqueue(createPreviewPayload()), 80);
    }
    document.addEventListener('visibilitychange', () => frameQueue.resume());
    connectSocket();
  }

  function connectSocket() {
    if (disposed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = window.__API_TOKEN__;
    const url = `${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      clearTimeout(reconnectTimer);
      reconnectAttempts = 0;
    });
    socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (payload.type === 'snapshot') {
        effectPlayer.setEnabled(payload.state?.settings?.giftEffectDanmakuEnabled === 'true');
        return;
      }
      if (payload.type === 'gift:frame') frameQueue.enqueue(payload);
      if (payload.type === 'gift:effect') effectPlayer.enqueue(payload);
      if (payload.type === 'gift:guard-thanks') guardThanks.enqueue(payload);
    });
    socket.addEventListener('close', () => {
      if (disposed) return;
      effectPlayer.setEnabled(false);
      const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempts, 5));
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(connectSocket, delay);
    });
  }

  function resolveGuardMotion() {
    const explicit = params.get('motion');
    if (explicit === 'full' || explicit === 'reduced') return explicit;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
  }

  function createPreviewPayload() {
    const themeId = params.get('frameTheme') === 'satin-ribbon' ? 'satin-ribbon' : 'woodland-bloom';
    return {
      type: 'gift:frame',
      eventId: `gift-frame:local-preview-${Date.now()}`,
      giftName: themeId === 'satin-ribbon' ? '缎带礼笺' : '林间花信',
      userName: '观众A',
      num: 2,
      totalPriceCents: 52000,
      themeId,
      preview: true,
    };
  }
  function createGuardPreviewPayload(tier) {
    const textMode = params.get('guardText');
    const months = Number(params.get('guardMonths'));
    const style = params.get('guardStyle');
    return {
      type: 'gift:guard-thanks',
      eventId: `guard-thanks:local-preview-${Date.now()}`,
      tier,
      userName: String(params.get('guardName') || '观众A').slice(0, 100),
      months: Number.isSafeInteger(months) && months > 0 ? months : 1,
      textMode: ['bilingual', 'zh', 'en'].includes(textMode) ? textMode : 'bilingual',
      style: ['aurora', 'classic'].includes(style) ? style : 'aurora',
      preview: true,
    };
  }
  function showStatus(message) {
    if (!DEBUG || !status) return;
    status.textContent = String(message || '');
    status.hidden = false;
  }
})();
