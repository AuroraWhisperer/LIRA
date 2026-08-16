// 编写人：Aurora
// 监听 gift:effect 事件，按 B站官方帧坐标合成透明 MP4；普通黑底素材继续逐帧抠黑。
'use strict';

(function () {
  const params = new URLSearchParams(location.search);
  const SOUND_ON = params.get('sound') === '1';
  const DEBUG = params.get('debug') === '1';
  const PREVIEW_MODE = params.get('preview') === '1';
  const MAX_PLAYING = 1;
  const MAX_PENDING = 10;
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
    if (PREVIEW_MODE) document.addEventListener('visibilitychange', playNextEffect);
    connectSocket();
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
      if (payload.type === 'gift:effect') {
        if (payload.preview) showStatus(`礼物 ${payload.giftId} 已匹配特效 ${payload.effect?.effectId}，正在播放。`);
        handleEffectEvent(payload);
      }
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
    if (pending.length >= MAX_PENDING) return;
    pending.push(payload);
    playNextEffect();
  }

  function playNextEffect() {
    if (playing.size >= MAX_PLAYING) return;
    if (PREVIEW_MODE && document.visibilityState === 'hidden') return;
    const payload = pending.shift();
    if (payload) spawnEffect(payload);
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
    const maskCanvas = document.createElement('canvas');
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskContext) return;

    playing.set(layerId, {
      video,
      canvas,
      context,
      maskCanvas,
      maskContext,
      layout: payload.effect.layout || null
    });
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
          drawEffectFrame(layer);
        } catch (error) {
          showStatus(`特效画面合成失败：${error.message || error}`);
          removeEffect(layerId);
          return;
        }
      }
      requestAnimationFrame(draw);
    };
  }

  function drawEffectFrame(layer) {
    const { video, canvas, context, maskCanvas, maskContext, layout } = layer;
    const source = getSourceLayout(layout, video.videoWidth, video.videoHeight);
    if (!source) return;
    const target = containRect(source.colorWidth, source.colorHeight, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      video,
      source.colorX, source.colorY, source.colorWidth, source.colorHeight,
      target.x, target.y, target.width, target.height
    );

    if (!source.packedAlpha) {
      keyOutBlack(context, target.x, target.y, target.width, target.height);
      return;
    }

    resizeCanvasTo(maskCanvas, target.width, target.height);
    maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskContext.drawImage(
      video,
      source.maskX, source.maskY, source.maskWidth, source.maskHeight,
      0, 0, maskCanvas.width, maskCanvas.height
    );
    applyAlphaMask(context, maskContext, target.x, target.y, target.width, target.height);
  }

  function getSourceLayout(layout, width, height) {
    if (width <= 0 || height <= 0) return null;
    if (!layout) {
      return {
        packedAlpha: false,
        colorX: 0,
        colorY: 0,
        colorWidth: width,
        colorHeight: height,
        maskX: 0,
        maskY: 0,
        maskWidth: 0,
        maskHeight: 0
      };
    }
    if (layout.videoWidth !== width || layout.videoHeight !== height) {
      throw new Error('视频尺寸与官方特效坐标不一致');
    }
    const [colorX, colorY, colorWidth, colorHeight] = validateSourceFrame(
      layout.rgbFrame,
      width,
      height
    );
    const [maskX, maskY, maskWidth, maskHeight] = validateSourceFrame(
      layout.alphaFrame,
      width,
      height
    );
    return {
      packedAlpha: true,
      colorX,
      colorY,
      colorWidth,
      colorHeight,
      maskX,
      maskY,
      maskWidth,
      maskHeight
    };
  }

  function validateSourceFrame(value, videoWidth, videoHeight) {
    if (!Array.isArray(value) || value.length !== 4) throw new Error('官方特效坐标无效');
    const frame = value.map(Number);
    if (!frame.every(Number.isInteger)) throw new Error('官方特效坐标无效');
    const [x, y, width, height] = frame;
    if (x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > videoWidth || y + height > videoHeight) {
      throw new Error('官方特效坐标无效');
    }
    return frame;
  }

  function containRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    return {
      x: Math.floor((targetWidth - width) / 2),
      y: Math.floor((targetHeight - height) / 2),
      width,
      height
    };
  }

  function keyOutBlack(context, x, y, width, height) {
    const frame = context.getImageData(x, y, width, height);
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = Math.max(data[i], data[i + 1], data[i + 2]);
    }
    context.putImageData(frame, x, y);
  }

  function applyAlphaMask(context, maskContext, x, y, width, height) {
    const frame = context.getImageData(x, y, width, height);
    const mask = maskContext.getImageData(0, 0, width, height).data;
    for (let i = 0; i < frame.data.length; i += 4) {
      // B站官方遮罩以白色表示不透明、黑色表示透明。
      frame.data[i + 3] = mask[i];
    }
    context.putImageData(frame, x, y);
  }

  function removeEffect(layerId) {
    const layer = playing.get(layerId);
    if (!layer) return;
    playing.delete(layerId);
    layer.video.pause();
    layer.video.removeAttribute('src');
    layer.video.load();
    layer.canvas.remove();
    playNextEffect();
  }

  function resizeCanvas(canvas) {
    resizeCanvasTo(canvas, window.innerWidth, window.innerHeight);
  }

  function resizeCanvasTo(canvas, width, height) {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
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

})();
