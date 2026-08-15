// 编写人：Aurora
// 监听 gift:effect 事件，播放 B站 MP4 并逐帧抠黑合成到透明画布。
'use strict';

(function () {
  const params = new URLSearchParams(location.search);
  const SOUND_ON = params.get('sound') === '1';
  const DEBUG = params.get('debug') === '1';
  const MAX_PLAYING = clampInteger(params.get('max'), 1, 6, 3);
  const MAX_PENDING = 8;
  const stage = document.getElementById('giftEffectStage');
  const status = document.getElementById('giftEffectStatus');
  const playing = new Map();
  const pending = [];
  const seenEventIds = new Set();
  let nextLayerId = 1;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  if (DEBUG) document.body.classList.add('is-debug');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    connectSocket();
    loadManualPreview();
  }

  async function loadManualPreview() {
    const rawGiftId = String(params.get('giftId') || '').trim();
    if (!rawGiftId) return;
    if (!/^\d{1,12}$/.test(rawGiftId) || Number(rawGiftId) <= 0) {
      showStatus('礼物 ID 无效，请返回百宝箱重新输入。');
      return;
    }

    showStatus(`正在从 B站查询礼物 ${rawGiftId} 的全屏特效…`);
    try {
      const response = await fetch(`/api/gifts/effects/resolve?giftId=${encodeURIComponent(rawGiftId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok || !payload.data?.effect) {
        throw new Error(payload.error || `查询失败（HTTP ${response.status}）`);
      }
      showStatus(`礼物 ${rawGiftId} 已匹配特效 ${payload.data.effect.effectId}，正在播放。`);
      handleEffectEvent({
        eventId: 0,
        giftId: Number(rawGiftId),
        effect: payload.data.effect
      });
    } catch (error) {
      showStatus(error.message || '礼物特效查询失败。');
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
    socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (payload.type === 'gift:effect') handleEffectEvent(payload);
    });
    socket.addEventListener('close', () => {
      const delay = Math.min(30000, 1000 * (2 ** Math.min(reconnectAttempts, 5)));
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(connectSocket, delay);
    });
  }

  function handleEffectEvent(payload) {
    const eventId = Number(payload.eventId) || 0;
    if (eventId > 0) {
      if (seenEventIds.has(eventId)) return;
      seenEventIds.add(eventId);
      if (seenEventIds.size > 100) seenEventIds.delete(seenEventIds.values().next().value);
    }

    const effect = payload.effect;
    if (!effect || !isTrustedEffectUrl(effect.mp4Url)) return;
    if (playing.size >= MAX_PLAYING) {
      if (pending.length >= MAX_PENDING) pending.shift();
      pending.push(payload);
      return;
    }
    spawnEffect(payload);
  }

  function spawnEffect(payload) {
    const layerId = nextLayerId;
    nextLayerId += 1;
    const video = document.createElement('video');
    video.referrerPolicy = 'no-referrer';
    video.crossOrigin = 'anonymous';
    video.muted = !SOUND_ON;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = payload.effect.mp4Url;

    const canvas = document.createElement('canvas');
    canvas.className = 'gift-effect-layer';
    resizeCanvas(canvas);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    playing.set(layerId, { video, canvas, context });
    stage.appendChild(canvas);
    video.addEventListener('playing', () => {
      requestAnimationFrame(drawLoop(layerId));
    }, { once: true });
    video.addEventListener('error', () => removeEffect(layerId), { once: true });
    video.addEventListener('ended', () => removeEffect(layerId), { once: true });
    video.play().catch(() => removeEffect(layerId));
  }

  function drawLoop(layerId) {
    return function draw() {
      const layer = playing.get(layerId);
      if (!layer) return;
      const { video, canvas, context } = layer;
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        resizeCanvas(canvas);
      }
      if (video.readyState >= 2 && !video.paused && !video.ended) {
        try {
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          keyOutBlack(context, canvas.width, canvas.height);
        } catch (error) {
          showStatus(`特效画面合成失败：${error.message || error}`);
          removeEffect(layerId);
          return;
        }
      }
      requestAnimationFrame(draw);
    };
  }

  function keyOutBlack(context, width, height) {
    const frame = context.getImageData(0, 0, width, height);
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = Math.max(data[i], data[i + 1], data[i + 2]);
    }
    context.putImageData(frame, 0, 0);
  }

  function removeEffect(layerId) {
    const layer = playing.get(layerId);
    if (!layer) return;
    playing.delete(layerId);
    layer.video.pause();
    layer.video.removeAttribute('src');
    layer.video.load();
    layer.canvas.remove();
    if (pending.length > 0) spawnEffect(pending.shift());
  }

  function resizeCanvas(canvas) {
    canvas.width = Math.max(1, window.innerWidth);
    canvas.height = Math.max(1, window.innerHeight);
  }

  function isTrustedEffectUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return false;
      const hostname = url.hostname.toLowerCase();
      return ['hdslb.com', 'bilibili.com', 'bilivideo.com']
        .some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch (_) {
      return false;
    }
  }

  function showStatus(message) {
    if (!DEBUG || !status) return;
    status.textContent = String(message || '');
    status.hidden = false;
  }

  function clampInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }
})();

