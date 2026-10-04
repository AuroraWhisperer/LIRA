// 大航海感谢动画：管理页预览与礼物特效投屏共用。观众文字只经 textContent 写入。
// 本文件是风格分发器：classic（金属徽章）与 aurora（辉光柔和）各自独立渲染器。
import { classicRenderer } from './guard-thanks-classic.js';
import { auroraRenderer } from './guard-thanks-aurora.js';
import { AVATAR_WAIT_MS, AURORA_COMPRESSED_HOLD_RATIO, AURORA_EXIT_MS, COMPRESSED_HOLD_RATIO, ENTER_MS, cssColor, element, fitName } from './guard-thanks-stage.js';
import { createGuardParticles } from './guard-thanks-particles.js';

export const GUARD_THANKS_STAGE = Object.freeze({ width: 1280, height: 1080 });
export const GUARD_TEXT_MODES = Object.freeze(['bilingual', 'zh', 'en']);
export const GUARD_STYLES = Object.freeze(['aurora', 'classic']);
const DEFAULT_STYLE = 'aurora';
const RENDERERS = Object.freeze({ classic: classicRenderer, aurora: auroraRenderer });

export const GUARD_TIERS = Object.freeze({
  captain: Object.freeze({
    key: 'captain',
    zh: '舰长',
    en: 'CAPTAIN',
    emblem: 'anchor',
    holdMs: 3300,
    waves: 2,
    sample: '/img/overlays/danmaku-ranked/captain.webp',
    bursts: [{ at: 560, count: 36, kinds: ['spark', 'bubble', 'spark', 'star'] }],
    ambient: { kind: 'bubble', rate: 7 },
  }),
  admiral: Object.freeze({
    key: 'admiral',
    zh: '提督',
    en: 'ADMIRAL',
    emblem: 'compass',
    holdMs: 4000,
    waves: 2,
    sample: '/img/overlays/danmaku-ranked/admiral.webp',
    bursts: [{ at: 560, count: 48, kinds: ['star', 'spark', 'star'] }],
    ambient: { kind: 'twinkle', rate: 6 },
  }),
  governor: Object.freeze({
    key: 'governor',
    zh: '总督',
    en: 'GOVERNOR',
    emblem: 'helm',
    holdMs: 5000,
    waves: 3,
    sample: '/img/overlays/danmaku-ranked/governor.webp',
    bursts: [
      { at: 560, count: 60, kinds: ['confetti', 'spark', 'confetti', 'star'] },
      { at: 1240, count: 40, kinds: ['confetti', 'spark'] },
    ],
    ambient: { kind: 'ember', rate: 10 },
  }),
});

// 辉光风格的三档时长与粒子计划，与渲染器内的分层配置分开维护。
const AURORA_PLANS = Object.freeze({
  captain: Object.freeze({
    holdMs: 3000,
    enterMs: 1800,
    bursts: [{ at: 900, count: 30, kinds: ['mote', 'halo', 'mote', 'blade'], spread: 1.15 }],
    ambient: { kind: 'mote', rate: 12 },
  }),
  admiral: Object.freeze({
    holdMs: 3400,
    enterMs: 2000,
    bursts: [
      { at: 1000, count: 42, kinds: ['mote', 'halo', 'blade', 'mote'], spread: 1.3 },
      { at: 2600, count: 20, kinds: ['mote', 'halo'], spread: 0.7, origin: { x: 640, y: 330 } },
    ],
    ambient: { kind: 'orbit', rate: 9 },
  }),
  governor: Object.freeze({
    holdMs: 4000,
    enterMs: 2200,
    bursts: [
      { at: 1100, count: 56, kinds: ['mote', 'halo', 'blade', 'petal'], spread: 1.45 },
      { at: 2500, count: 34, kinds: ['converge', 'mote'], spread: 0.55, origin: { x: 640, y: 470 } },
      { at: 3400, count: 46, kinds: ['halo', 'mote', 'petal'], spread: 1.7 },
    ],
    ambient: { kind: 'petal', rate: 12 },
  }),
});

const PARTICLE_OFFSET_X = 320;
const MEDALLION_CENTER = Object.freeze({ x: 640, y: 500 });
const SPARK_VARS = Object.freeze(['--gt-spark-a', '--gt-spark-b', '--gt-spark-c']);
let instanceSequence = 0;

export function resolveGuardRenderer(style) {
  return RENDERERS[String(style)] || RENDERERS[DEFAULT_STYLE];
}

export function safeGuardAvatarUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const trusted = url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com');
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
}

export function isGuardThanksPayload(payload) {
  const months = Number(payload?.months ?? 1);
  return Boolean(
    payload &&
      Object.hasOwn(GUARD_TIERS, payload.tier) &&
      typeof payload.userName === 'string' &&
      payload.userName.length <= 100 &&
      Number.isSafeInteger(months) &&
      months > 0 &&
      (payload.textMode === undefined || GUARD_TEXT_MODES.includes(payload.textMode)) &&
      (payload.style === undefined || GUARD_STYLES.includes(payload.style)) &&
      (payload.avatarUrl === undefined || typeof payload.avatarUrl === 'string'),
  );
}

export function guardThanksCopy(tier, textMode = 'bilingual', months = 1) {
  const labels = GUARD_TIERS[tier];
  const extra = Number(months) > 1;
  if (textMode === 'en') {
    return {
      lang: 'en',
      title: labels.en,
      eyebrow: 'WELCOME ABOARD',
      lead: 'THANK YOU',
      tail: '',
      months: extra ? `${months} MONTHS` : '',
    };
  }
  return {
    lang: 'zh',
    title: labels.zh,
    eyebrow: textMode === 'zh' ? '欢迎上舰' : `WELCOME ABOARD · ${labels.en}`,
    eyebrowLang: textMode === 'zh' ? 'zh' : 'en',
    lead: '感谢',
    tail: `开通${labels.zh}`,
    months: extra ? `${months} 个月` : '',
  };
}

function createSession() {
  const animations = [];
  const timers = new Set();
  let aborted = false;
  let resolveAbort;
  const abortPromise = new Promise((resolve) => {
    resolveAbort = resolve;
  });
  return {
    abortPromise,
    get aborted() {
      return aborted;
    },
    animate(node, keyframes, options) {
      if (!node?.animate) return null;
      const animation = node.animate(keyframes, { fill: 'both', ...options });
      animations.push(animation);
      return animation;
    },
    wait(duration) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          resolve();
        }, duration);
        timers.add(timer);
      });
    },
    abort() {
      aborted = true;
      resolveAbort();
    },
    cleanup() {
      animations.forEach((animation) => animation.cancel());
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    },
  };
}

function loadAvatar(avatar, source) {
  if (!source) return Promise.resolve(false);
  return new Promise((resolve) => {
    const image = document.createElement('img');
    image.className = 'gt-avatar-image';
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false;
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => resolve(true), { once: true });
    image.addEventListener(
      'error',
      () => {
        image.remove();
        resolve(false);
      },
      { once: true },
    );
    image.src = source;
    avatar.append(image);
  });
}

// 按风格决定停留时长：辉光更柔和，连播压缩得更轻，避免总督档被压垮。
function resolveMotion(renderer, tier, compressed) {
  if (renderer.id === 'aurora') {
    const plan = AURORA_PLANS[tier.key] || AURORA_PLANS.captain;
    const ratio = compressed ? AURORA_COMPRESSED_HOLD_RATIO : 1;
    return { holdMs: Math.round(plan.holdMs * ratio), plan, enterMs: plan.enterMs, aura: true };
  }
  return {
    holdMs: Math.round(tier.holdMs * (compressed ? COMPRESSED_HOLD_RATIO : 1)),
    plan: null,
    enterMs: ENTER_MS,
    aura: false,
  };
}

export function createGuardThanksPlayer({ root, resolveAvatarUrl = safeGuardAvatarUrl } = {}) {
  const stage = element('div', 'gt-stage');
  const canvas = element('canvas', 'gt-particles');
  canvas.setAttribute('aria-hidden', 'true');
  stage.append(canvas);
  root.append(stage);
  const particles = createGuardParticles(canvas);
  let scale = 1;
  let active = null;

  function fit() {
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (!width || !height) return;
    scale = Math.min(width / GUARD_THANKS_STAGE.width, height / GUARD_THANKS_STAGE.height);
    const left = (width - GUARD_THANKS_STAGE.width * scale) / 2;
    const top = (height - GUARD_THANKS_STAGE.height * scale) / 2;
    stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  if (resizeObserver) resizeObserver.observe(root);
  else window.addEventListener('resize', fit);
  fit();

  function stop() {
    active?.abort();
  }

  async function play(payload, { motion = 'full', compressed = false } = {}) {
    if (!isGuardThanksPayload(payload)) return false;
    stop();
    const session = createSession();
    active = session;
    const tier = GUARD_TIERS[payload.tier];
    const textMode = GUARD_TEXT_MODES.includes(payload.textMode) ? payload.textMode : 'bilingual';
    const copy = guardThanksCopy(payload.tier, textMode, Number(payload.months ?? 1));
    const uid = `gt${(instanceSequence += 1)}`;
    const renderer = resolveGuardRenderer(payload.style);
    const parts = renderer.build(payload, tier, copy, uid);
    const timing = resolveMotion(renderer, tier, compressed);
    stage.insertBefore(parts.card, canvas);
    root.classList.add('is-playing');
    try {
      if (renderer.needsAvatar) {
        const avatarSource = payload.avatarUrl
          ? resolveAvatarUrl(payload.avatarUrl)
          : payload.preview === true
            ? tier.sample
            : '';
        await Promise.race([loadAvatar(parts.avatar, avatarSource), session.wait(AVATAR_WAIT_MS), session.abortPromise]);
        if (session.aborted) return false;
      }
      fit();
      if (parts.name) fitName(parts.name);
      let total;
      if (motion === 'reduced') {
        total = timing.aura
          ? renderer.scheduleReduced(session, parts, timing.holdMs, timing.enterMs, timing.enterMs + timing.holdMs + AURORA_EXIT_MS)
          : renderer.scheduleReduced(session, parts, timing.holdMs);
      } else {
        total = renderer.schedule(session, parts, tier, timing.holdMs);
      }
      parts.card.classList.add('is-live');
      if (motion !== 'reduced') {
        particles.start(
          timing.aura
            ? {
                origin: { x: MEDALLION_CENTER.x, y: MEDALLION_CENTER.y - 40 },
                colors: SPARK_VARS.map((name) => cssColor(parts.card, name)),
                bursts: timing.plan.bursts,
                ambient: { ...timing.plan.ambient, from: timing.enterMs, until: timing.enterMs + timing.holdMs },
                endAt: total,
                resolution: Math.min(1, scale * (window.devicePixelRatio || 1)),
                soft: true,
              }
            : {
                origin: { x: MEDALLION_CENTER.x + PARTICLE_OFFSET_X, y: MEDALLION_CENTER.y },
                colors: SPARK_VARS.map((name) => cssColor(parts.card, name)),
                bursts: tier.bursts,
                ambient: { ...tier.ambient, from: ENTER_MS, until: ENTER_MS + timing.holdMs },
                endAt: total,
                resolution: scale * (window.devicePixelRatio || 1),
              },
        );
      }
      await Promise.race([session.wait(total), session.abortPromise]);
      return !session.aborted;
    } finally {
      session.cleanup();
      if (active === session) {
        active = null;
        particles.stop();
        root.classList.remove('is-playing');
      }
      parts.card.remove();
    }
  }

  return {
    play,
    stop,
    dispose() {
      stop();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', fit);
      stage.remove();
    },
  };
}
