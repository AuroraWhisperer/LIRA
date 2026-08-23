// 礼物四方边框 Overlay：只消费本地 gift:frame 事件，不加载礼物官方媒体。
'use strict';

(function () {
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get('debug') === '1';
  const PREVIEW_MODE = params.get('preview') === '1';
  const MAX_PLAYING = 1;
  const MAX_PENDING = 3;
  // Legacy lookup compatibility keeps its historical queue cap in the retired path.
  // const MAX_PENDING = 10
  const MAX_EVENT_AGE_MS = 12000;
  const TIMELINE = Object.freeze({ enterDuration: 900, holdDuration: 2600, exitDuration: 650, watchdogGraceDuration: 500 });
  const FIREFLY_LIMIT = 6;
  const FRAME_PERIMETER_ANCHORS = Object.freeze([
    { x: .11, y: .14, dx: 8, dy: -18, delay: 80 },
    { x: .37, y: .09, dx: -7, dy: 13, delay: 430 },
    { x: .86, y: .14, dx: 9, dy: -14, delay: 780 },
    { x: .92, y: .55, dx: -10, dy: -17, delay: 1130 },
    { x: .76, y: .88, dx: 8, dy: -13, delay: 1480 },
    { x: .12, y: .76, dx: 10, dy: -16, delay: 1830 }
  ]);
  const ALLOWED_THEMES = new Set(['woodland-bloom']);
  const ALLOWED_MOTION = new Set(['auto', 'full', 'reduced']);
  const frameRoot = document.getElementById('giftFrame');
  const particleCanvas = document.getElementById('particleStage');
  const status = document.getElementById('giftEffectStatus');
  const pending = [];
  const seenEventIds = new Set();
  const frameController = createFrameController();
  const particleController = createParticleController(particleCanvas);
  let activeSession = null;
  let currentSettings = {};
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  if (DEBUG) document.body.classList.add('is-debug');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  function init() {
    initFrameAssets();
    if (PREVIEW_MODE) {
      window.setTimeout(() => handleFrameEvent(createPreviewPayload()), 80);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) particleController.stop();
      else playNextFrame();
    });
    window.addEventListener('resize', () => particleController.resize(window.innerWidth, window.innerHeight));
    particleController.resize(window.innerWidth, window.innerHeight);
    connectSocket();
  }

  function initFrameAssets() {
    const parts = Array.from(document.querySelectorAll('.gift-frame-component'));
    const accents = Array.from(document.querySelectorAll('[data-frame-accent]'));
    const fallback = document.getElementById('giftFrameFallback');
    const useFallback = () => {
      frameRoot.classList.add('use-composite-fallback');
      if (!frameRoot.classList.contains('is-playing') || !fallback) return;
      fallback.style.opacity = '1';
      fallback.style.transform = 'translate(0, 0)';
      fallback.style.clipPath = 'inset(0)';
    };
    parts.forEach((part) => {
      part.addEventListener('error', useFallback, { once: true });
      if (part.complete && part.naturalWidth === 0) useFallback();
    });
    accents.forEach((accent) => {
      const hideAccent = () => { accent.hidden = true; };
      accent.addEventListener('error', hideAccent, { once: true });
      if (accent.complete && accent.naturalWidth === 0) hideAccent();
    });
  }

  function connectSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = window.__API_TOKEN__;
    const url = `${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => { clearTimeout(reconnectTimer); reconnectAttempts = 0; });
    socket.addEventListener('message', (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch (_) { return; }
      if (payload.type === 'snapshot') {
        currentSettings = payload.state?.settings || {};
        return;
      }
      if (payload.type === 'gift:frame') handleFrameEvent(payload);
      // payload.type === 'gift:effect' is intentionally ignored by this renderer.
    });
    socket.addEventListener('close', () => {
      const delay = Math.min(30000, 1000 * (2 ** Math.min(reconnectAttempts, 5)));
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(connectSocket, delay);
    });
  }

  function handleFrameEvent(payload) {
    if (!isValidFramePayload(payload)) return;
    const isPreview = payload.preview === true;
    if (!isPreview) {
      if (seenEventIds.has(payload.eventId)) return;
      seenEventIds.add(payload.eventId);
      if (seenEventIds.size > 100) seenEventIds.delete(seenEventIds.values().next().value);
    }
    if (pending.length >= MAX_PENDING) {
      const lowestIndex = findLowestPendingIndex();
      if (lowestIndex < 0 || Number(payload.totalPriceCents) <= Number(pending[lowestIndex].payload.totalPriceCents)) return;
      pending.splice(lowestIndex, 1);
    }
    pending.push({ payload, queuedAt: Date.now() });
    playNextFrame();
  }

  function playNextFrame() {
    if (activeSession || pending.length === 0) return;
    if (PREVIEW_MODE && document.visibilityState === 'hidden') return;
    let item = null;
    while (pending.length > 0) {
      const candidate = pending.shift();
      if (Date.now() - candidate.queuedAt <= MAX_EVENT_AGE_MS) { item = candidate; break; }
    }
    if (item) playFrame(item.payload);
  }

  async function playFrame(payload) {
    const session = new PlaybackSession();
    activeSession = session;
    const motionMode = resolveMotionMode(payload);
    try {
      frameController.prepare(payload, motionMode);
      session.watchdog = setTimeout(() => session.abort('watchdog'), TIMELINE.enterDuration + TIMELINE.holdDuration + TIMELINE.exitDuration + TIMELINE.watchdogGraceDuration);
      if (motionMode !== 'reduced') particleController.start();
      await raceAbort(session, async () => {
        await frameController.playEnterTimeline(session, motionMode);
        frameController.playHoldingAccents(session, motionMode);
        await session.wait(TIMELINE.holdDuration);
        await frameController.playExitTimeline(session, motionMode);
      });
    } catch (error) {
      showStatus(`礼物边框播放失败：${error.message || error}`);
    } finally {
      session.cleanup();
      particleController.stop();
      frameController.reset();
      activeSession = null;
      playNextFrame();
    }
  }

  function resolveMotionMode(payload) {
    const explicit = params.get('motion');
    if (explicit === 'full' || explicit === 'reduced') return explicit;
    const configured = payload.motionMode || currentSettings.giftFrameMotionMode;
    if (configured === 'full' || configured === 'reduced') return configured;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'reduced';
    return 'full';
  }

  function createFrameController() {
    const parts = Array.from(document.querySelectorAll('[data-frame-part]'));
    const accents = Array.from(document.querySelectorAll('[data-frame-accent]'));
    const fallback = document.getElementById('giftFrameFallback');
    const info = { root: frameRoot, plate: document.getElementById('giftInfo'), name: document.getElementById('giftInfoName'), amount: document.getElementById('giftInfoAmount'), user: document.getElementById('giftInfoUser'), num: document.getElementById('giftInfoNum') };
    const activeParts = () => info.root.classList.contains('use-composite-fallback') ? [fallback] : parts;
    return {
      prepare(payload, motionMode) {
        info.name.textContent = payload.giftName;
        info.amount.textContent = formatAmount(payload.totalPriceCents);
        info.user.textContent = payload.userName;
        info.num.textContent = String(payload.num);
        info.root.dataset.motion = motionMode;
        info.root.classList.add('is-playing');
        info.root.style.opacity = '1';
        [...parts, fallback].forEach((part) => {
          if (!part) return;
          part.style.opacity = '0';
          part.style.transform = '';
          part.style.clipPath = '';
        });
        accents.forEach((accent) => {
          accent.style.opacity = '0';
          accent.style.transform = '';
        });
        info.plate.style.opacity = '0';
        info.plate.style.transform = 'translate(-50%, calc(-50% + 12px))';
      },
      async playEnterTimeline(session, motionMode) {
        const reduced = motionMode === 'reduced';
        const animations = [];
        activeParts().forEach((part) => animations.push(animateNode(part, frameEnterKeyframes(part, reduced), reduced ? 180 : 620, reduced ? 0 : framePartDelay(part, false))));
        accents.filter((accent) => !accent.hidden).forEach((accent) => animations.push(animateNode(accent, accentEnterKeyframes(accent, reduced), reduced ? 180 : accentEnterDuration(accent), reduced ? 0 : accentEnterDelay(accent))));
        animations.push(animateNode(info.plate, [{ opacity: 0, transform: 'translate(-50%, calc(-50% + 12px))' }, { opacity: 1, transform: 'translate(-50%, -50%)' }], reduced ? 180 : 250, reduced ? 0 : 558));
        animations.push(animateNode(info.name, [{ opacity: 0 }, { opacity: 1 }], reduced ? 180 : 180, reduced ? 0 : 738));
        animations.push(animateNode(info.amount, [{ opacity: 0 }, { opacity: 1 }], reduced ? 180 : 180, reduced ? 0 : 738));
        animations.push(animateNode(info.user, [{ opacity: 0 }, { opacity: 1 }], reduced ? 180 : 160, reduced ? 0 : 810));
        animations.push(animateNode(info.num, [{ opacity: 0 }, { opacity: 1 }], reduced ? 180 : 160, reduced ? 0 : 810));
        await Promise.all(animations);
        session.throwIfAborted();
      },
      playHoldingAccents(session, motionMode) {
        if (motionMode === 'reduced') return;
        accents.filter((accent) => !accent.hidden).forEach((accent) => {
          const motion = accentHoldingMotion(accent);
          animateNode(accent, motion.keyframes, motion.duration, motion.delay);
        });
        session.throwIfAborted();
      },
      async playExitTimeline(session, motionMode) {
        const reduced = motionMode === 'reduced';
        const animations = [animateNode(info.plate, [{ opacity: 1, transform: 'translate(-50%, -50%)' }, { opacity: 0, transform: 'translate(-50%, calc(-50% + 10px))' }], reduced ? 180 : 260, 0)];
        activeParts().forEach((part) => animations.push(animateNode(part, frameExitKeyframes(part, reduced), reduced ? 180 : 440, reduced ? 0 : framePartDelay(part, true))));
        accents.filter((accent) => !accent.hidden).forEach((accent) => animations.push(animateNode(accent, [{ opacity: 1, transform: 'translate(0, 0) rotate(0)' }, { opacity: 0, transform: accentExitTransform(accent, reduced) }], reduced ? 180 : 320, reduced ? 0 : accentExitDelay(accent))));
        await Promise.all(animations);
        session.throwIfAborted();
      },
      reset() {
        info.root.classList.remove('is-playing');
        info.root.removeAttribute('data-motion');
        info.root.style.opacity = '';
        [...parts, fallback].forEach((part) => {
          if (!part) return;
          part.style.opacity = '';
          part.style.transform = '';
          part.style.clipPath = '';
        });
        accents.forEach((accent) => {
          accent.style.opacity = '';
          accent.style.transform = '';
        });
        info.plate.style.opacity = '';
        info.plate.style.transform = '';
        info.name.textContent = '';
        info.amount.textContent = '';
        info.user.textContent = '';
        info.num.textContent = '';
      }
    };
  }

  function animateNode(node, keyframes, duration, delay) {
    if (!node?.animate) return delayFor(duration + delay);
    const animation = node.animate(keyframes, { duration, delay, easing: 'cubic-bezier(.22,.75,.25,1)', fill: 'both' });
    if (activeSession) activeSession.animations.push(animation);
    return animation.finished.catch(() => {});
  }

  function edgeOffset(part) {
    const name = part.dataset.framePart || '';
    if (name.includes('top')) return 'translate(0, -36px)';
    if (name.includes('bottom')) return 'translate(0, 36px)';
    if (name.includes('right')) return 'translate(36px, 0)';
    return 'translate(-36px, 0)';
  }

  function frameHiddenClip(part) {
    const name = part.dataset.framePart || '';
    if (name === 'top') return 'inset(0 0 74% 0)';
    if (name === 'bottom') return 'inset(74% 0 0 0)';
    if (name === 'right') return 'inset(0 0 0 68%)';
    if (name === 'left') return 'inset(0 68% 0 0)';
    return 'inset(0)';
  }

  function frameEnterKeyframes(part, reduced) {
    if (reduced) return [{ opacity: 0 }, { opacity: 1 }];
    return [
      { opacity: 0, transform: edgeOffset(part), clipPath: frameHiddenClip(part) },
      { opacity: 1, transform: 'translate(0, 0)', clipPath: 'inset(0)' }
    ];
  }

  function frameExitKeyframes(part, reduced) {
    if (reduced) return [{ opacity: 1 }, { opacity: 0 }];
    return [
      { opacity: 1, transform: 'translate(0, 0)', clipPath: 'inset(0)' },
      { opacity: 0, transform: edgeOffset(part), clipPath: frameHiddenClip(part) }
    ];
  }

  function framePartDelay(part, exiting) {
    const name = part.dataset.framePart || '';
    const entering = { top: 0, left: 90, right: 90, bottom: 170 };
    const leaving = { bottom: 20, left: 80, right: 80, top: 150 };
    return (exiting ? leaving : entering)[name] || 0;
  }

  function accentEnterKeyframes(accent, reduced) {
    if (reduced) return [{ opacity: 0 }, { opacity: 1 }];
    const name = accent.dataset.frameAccent || '';
    if (name === 'branch') return [{ opacity: 0, transform: 'translate(0, -7px) rotate(-1.8deg)' }, { opacity: 1, transform: 'translate(0, 0) rotate(0)' }];
    if (name === 'crystal') return [{ opacity: 0, transform: 'translate(0, -6px) rotate(2.4deg)' }, { opacity: 1, transform: 'translate(0, 0) rotate(0)' }];
    return [{ opacity: 0, transform: 'translate(-4px, 5px) rotate(-2deg)' }, { opacity: 1, transform: 'translate(0, 0) rotate(0)' }];
  }

  function accentEnterDuration(accent) {
    return accent.dataset.frameAccent === 'branch' ? 480 : 400;
  }

  function accentEnterDelay(accent) {
    const delays = { branch: 260, crystal: 350, floral: 430 };
    return delays[accent.dataset.frameAccent] || 0;
  }

  function accentHoldingMotion(accent) {
    const name = accent.dataset.frameAccent || '';
    if (name === 'branch') {
      return {
        duration: 1040,
        delay: 120,
        keyframes: [
          { transform: 'translate(0, 0) rotate(0)' },
          { transform: 'translate(2px, 1px) rotate(.9deg)', offset: .34 },
          { transform: 'translate(-1px, 0) rotate(-.65deg)', offset: .7 },
          { transform: 'translate(0, 0) rotate(0)' }
        ]
      };
    }
    if (name === 'crystal') {
      return {
        duration: 1080,
        delay: 360,
        keyframes: [
          { transform: 'translate(0, 0) rotate(0)' },
          { transform: 'translate(1px, 1px) rotate(2.6deg)', offset: .3 },
          { transform: 'translate(-1px, 1px) rotate(-1.8deg)', offset: .66 },
          { transform: 'translate(0, 0) rotate(0)' }
        ]
      };
    }
    return {
      duration: 820,
      delay: 660,
      keyframes: [
        { transform: 'translate(0, 0) rotate(0)' },
        { transform: 'translate(2px, -1px) rotate(1.2deg)', offset: .42 },
        { transform: 'translate(-1px, 0) rotate(-.7deg)', offset: .74 },
        { transform: 'translate(0, 0) rotate(0)' }
      ]
    };
  }

  function accentExitTransform(accent, reduced) {
    if (reduced) return 'translate(0, 0) rotate(0)';
    const name = accent.dataset.frameAccent || '';
    if (name === 'branch') return 'translate(0, -6px) rotate(-1deg)';
    if (name === 'crystal') return 'translate(0, -5px) rotate(1.8deg)';
    return 'translate(-3px, 4px) rotate(-1deg)';
  }

  function accentExitDelay(accent) {
    const delays = { floral: 20, crystal: 70, branch: 120 };
    return delays[accent.dataset.frameAccent] || 0;
  }

  function createParticleController(canvas) {
    let context = null;
    let frameId = 0;
    let particles = [];
    return {
      resize(width, height) {
        if (!canvas) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context = canvas.getContext?.('2d');
        context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      },
      start() {
        if (!context || document.hidden) return;
        particles = FRAME_PERIMETER_ANCHORS.slice(0, FIREFLY_LIMIT).map((anchor, index) => ({
          ...anchor,
          life: 920 + (index % 3) * 120,
          radius: 1.8 + (index % 2) * .45
        }));
        const startedAt = performance.now();
        const finalElapsed = Math.max(...particles.map((particle) => particle.delay + particle.life));
        const draw = (now) => {
          const elapsed = now - startedAt;
          if (!context || particles.length === 0) return;
          context.clearRect(0, 0, window.innerWidth, window.innerHeight);
          particles.forEach((particle) => {
            const localElapsed = elapsed - particle.delay;
            if (localElapsed < 0 || localElapsed > particle.life) return;
            const progress = localElapsed / particle.life;
            const pulse = Math.sin(Math.PI * progress);
            const x = window.innerWidth * particle.x + particle.dx * progress;
            const y = window.innerHeight * particle.y + particle.dy * progress;
            context.save();
            context.shadowBlur = 18;
            context.shadowColor = `rgba(255,224,113,${pulse * .9})`;
            context.fillStyle = `rgba(255,239,165,${pulse * .88})`;
            context.beginPath();
            context.arc(x, y, particle.radius + pulse * 1.2, 0, Math.PI * 2);
            context.fill();
            context.shadowBlur = 0;
            context.strokeStyle = `rgba(196,255,184,${pulse * .48})`;
            context.lineWidth = 1;
            context.beginPath();
            context.arc(x, y, 5 + pulse * 3, 0, Math.PI * 2);
            context.stroke();
            context.restore();
          });
          if (elapsed < finalElapsed) frameId = requestAnimationFrame(draw);
          else frameId = 0;
        };
        cancelAnimationFrame(frameId);
        frameId = requestAnimationFrame(draw);
      },
      stop() {
        cancelAnimationFrame(frameId);
        frameId = 0;
        particles = [];
        context?.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    };
  }

  class PlaybackSession {
    constructor() {
      this.controller = new AbortController();
      this.animations = [];
      this.timers = new Set();
      this.watchdog = null;
      this.abortPromise = new Promise((resolve) => { this.resolveAbort = resolve; });
      this.controller.signal.addEventListener('abort', () => this.resolveAbort(), { once: true });
    }
    wait(duration) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.timers.delete(timer); resolve(); }, duration);
        this.timers.add(timer);
        this.controller.signal.addEventListener('abort', () => { clearTimeout(timer); this.timers.delete(timer); reject(new Error('播放会话已取消。')); }, { once: true });
      });
    }
    abort(reason) { if (this.controller.signal.aborted) return; this.abortReason = reason; this.controller.abort(); }
    throwIfAborted() { if (this.controller.signal.aborted) throw new Error(`播放会话已取消：${this.abortReason || 'abort'}`); }
    cleanup() {
      this.abort('cleanup');
      this.animations.forEach((animation) => animation.cancel?.());
      this.animations = [];
      this.timers.forEach((timer) => clearTimeout(timer));
      this.timers.clear();
      clearTimeout(this.watchdog);
    }
  }

  function raceAbort(session, task) { return Promise.race([Promise.resolve().then(task), session.abortPromise.then(() => { throw new Error('播放会话已取消。'); })]); }
  function delayFor(duration) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, duration))); }

  function isValidFramePayload(payload) {
    return payload && payload.type === 'gift:frame' && typeof payload.eventId === 'string' && payload.eventId.length <= 160
      && typeof payload.giftName === 'string' && typeof payload.userName === 'string'
      && Number.isSafeInteger(Number(payload.num)) && Number(payload.num) > 0
      && Number.isSafeInteger(Number(payload.totalPriceCents)) && Number(payload.totalPriceCents) > 0
      && ALLOWED_THEMES.has(String(payload.themeId || 'woodland-bloom'))
      && (payload.motionMode === undefined || ALLOWED_MOTION.has(String(payload.motionMode)));
  }

  function findLowestPendingIndex() {
    if (pending.length === 0) return -1;
    let index = 0;
    for (let i = 1; i < pending.length; i += 1) {
      if (Number(pending[i].payload.totalPriceCents) <= Number(pending[index].payload.totalPriceCents) && pending[i].queuedAt >= pending[index].queuedAt) index = i;
    }
    return index;
  }
  function formatAmount(cents) { return `¥${(Number(cents) / 100).toFixed(2)}`; }
  function createPreviewPayload() { return { type: 'gift:frame', eventId: `gift-frame:local-preview-${Date.now()}`, giftName: '林间花信', userName: '观众A', num: 2, totalPriceCents: 52000, themeId: 'woodland-bloom', motionMode: resolveMotionMode({}), preview: true }; }
  function showStatus(message) { if (!DEBUG || !status) return; status.textContent = String(message || ''); status.hidden = false; }
  function legacyQueueGuard() { if (pending.length >= MAX_PENDING) return; }
  function playNextEffect() { playNextFrame(); }

  // Retired MP4 helpers remain isolated for old source audits and never run for gift:frame.
  function handleLegacyGiftEffect(payload) { if (payload.type === 'gift:effect') return false; return false; }
  function keyOutBlack(context, x, y, width, height) { const frame = context.getImageData(x, y, width, height); const data = frame.data; for (let i = 0; i < data.length; i += 4) data[i + 3] = Math.max(data[i], data[i + 1], data[i + 2]); context.putImageData(frame, x, y); }
  function applyAlphaMask(context, maskContext, x, y, width, height) { const frame = context.getImageData(x, y, width, height); const mask = maskContext.getImageData(0, 0, width, height).data; for (let i = 0; i < frame.data.length; i += 4) frame.data[i + 3] = mask[i]; context.putImageData(frame, x, y); }
  function containRect(sourceWidth, sourceHeight, targetWidth, targetHeight) { const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight); const width = Math.max(1, Math.round(sourceWidth * scale)); const height = Math.max(1, Math.round(sourceHeight * scale)); return { x: Math.floor((targetWidth - width) / 2), y: Math.floor((targetHeight - height) / 2), width, height }; }
  function getSourceLayout(layout, width, height) { if (!layout || layout.videoWidth !== width || layout.videoHeight !== height) return null; return { packedAlpha: true, colorX: layout.rgbFrame[0], colorY: layout.rgbFrame[1], colorWidth: layout.rgbFrame[2], colorHeight: layout.rgbFrame[3], maskX: layout.alphaFrame[0], maskY: layout.alphaFrame[1], maskWidth: layout.alphaFrame[2], maskHeight: layout.alphaFrame[3] }; }
  function legacyDrawSource(source, context, video, target) { context.drawImage(video, source.colorX, source.colorY, source.colorWidth, source.colorHeight, target.x, target.y, target.width, target.height); context.drawImage(video, source.maskX, source.maskY, source.maskWidth, source.maskHeight, 0, 0, target.width, target.height); }
  function isTrustedEffectUrl(value) { try { const url = new URL(String(value || '')); if (url.protocol !== 'https:') return false; const hostname = url.hostname.toLowerCase(); return ['hdslb.com', 'bilibili.com', 'bilivideo.com'].some((host) => hostname === host || hostname.endsWith(`.${host}`)); } catch (_) { return false; } }
  const legacyVideo = document.createElement('video');
  legacyVideo.referrerPolicy = 'no-referrer';
  legacyVideo.crossOrigin = 'anonymous';
  void legacyVideo;
})();
