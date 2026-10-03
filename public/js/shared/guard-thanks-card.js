// 大航海感谢动画：管理页预览与礼物特效投屏共用。观众文字只经 textContent 写入。
import { buildEmblem, buildGlint, buildMedallionRing, buildRibbon } from './guard-thanks-emblems.js';
import { createGuardParticles } from './guard-thanks-particles.js';

export const GUARD_THANKS_STAGE = Object.freeze({ width: 1280, height: 1080 });
export const GUARD_TEXT_MODES = Object.freeze(['bilingual', 'zh', 'en']);
export const GUARD_TIERS = Object.freeze({
  captain: Object.freeze({
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

const ENTER_MS = 1500;
const EXIT_MS = 700;
const AVATAR_WAIT_MS = 700;
const COMPRESSED_HOLD_RATIO = 0.45;
const MEDALLION_CENTER = Object.freeze({ x: 640, y: 500 });
const PARTICLE_OFFSET_X = 320;
const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
const EASE_POP = 'cubic-bezier(.2,.8,.3,1)';
const EASE_IN = 'cubic-bezier(.55,0,.75,.2)';
const EASE_SWAY = 'cubic-bezier(.45,0,.55,1)';
let instanceSequence = 0;

export function safeGuardAvatarUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const trusted = url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com');
    return url.protocol === 'https:' && trusted && !url.username && !url.password ? url.toString() : '';
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

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

function buildCard(payload, tier, copy, uid) {
  const card = element('div', 'gt-card');
  card.dataset.tier = payload.tier;
  card.dataset.lang = copy.lang;
  const parts = { card };

  parts.halo = element('div', 'gt-halo');
  parts.rays = element('div', 'gt-rays');
  parts.raysBroad = element('div', 'gt-rays-layer gt-rays-broad');
  parts.raysFine = element('div', 'gt-rays-layer gt-rays-fine');
  parts.rays.append(parts.raysBroad, parts.raysFine);
  parts.waves = Array.from({ length: tier.waves }, () => element('div', 'gt-wave'));
  parts.pings = Array.from({ length: 2 }, () => element('div', 'gt-wave gt-ping'));

  parts.emblem = element('div', `gt-emblem is-${tier.emblem}`);
  parts.emblemSpin = element('div', 'gt-emblem-spin');
  parts.emblemSpin.append(buildEmblem(tier.emblem, uid));
  parts.emblem.append(parts.emblemSpin);
  parts.flash = element('div', 'gt-flash');

  parts.medallion = element('div', 'gt-medallion');
  parts.medallionFloat = element('div', 'gt-medallion-float');
  parts.avatar = element('div', 'gt-avatar');
  parts.avatar.append(element('span', 'gt-avatar-initial', Array.from(payload.userName.trim())[0] || '舰'));
  const ring = buildMedallionRing(tier.emblem, uid);
  parts.ringMetal = ring.querySelector('.gt-ring-metal');
  parts.ringDeco = ring.querySelector('.gt-ring-deco');
  parts.glint = buildGlint();
  parts.medallionFloat.append(parts.avatar, ring, parts.glint);
  parts.medallion.append(parts.medallionFloat);

  parts.ribbon = element('div', 'gt-ribbon');
  const title = element('div', 'gt-ribbon-title');
  parts.ribbonChars = Array.from(copy.title, (character) => element('span', 'gt-ribbon-char', character));
  title.append(...parts.ribbonChars);
  const sheenBox = element('div', 'gt-ribbon-sheen');
  parts.sheen = element('i');
  sheenBox.append(parts.sheen);
  parts.ribbon.append(buildRibbon(uid), sheenBox, title);

  parts.eyebrow = element('div', 'gt-eyebrow');
  parts.eyebrow.dataset.lang = copy.eyebrowLang || copy.lang;
  parts.eyebrowLines = [element('i', 'gt-eyebrow-line'), element('i', 'gt-eyebrow-line is-end')];
  parts.eyebrow.append(parts.eyebrowLines[0], element('span', 'gt-eyebrow-text', copy.eyebrow), parts.eyebrowLines[1]);

  const nameRow = element('div', 'gt-name-row');
  parts.namePill = element('div', 'gt-name-pill');
  parts.name = element('strong', 'gt-name', payload.userName);
  parts.namePill.append(element('span', 'gt-name-lead', copy.lead), parts.name);
  if (copy.tail) parts.namePill.append(element('span', 'gt-name-tail', copy.tail));
  if (copy.months) {
    parts.months = element('span', 'gt-months', copy.months);
    parts.namePill.append(parts.months);
  }
  nameRow.append(parts.namePill);

  card.append(
    parts.halo,
    parts.rays,
    ...parts.waves,
    ...parts.pings,
    parts.emblem,
    parts.flash,
    parts.medallion,
    parts.ribbon,
    parts.eyebrow,
    nameRow,
  );
  return parts;
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

function fitName(name) {
  let size = 40;
  while (size > 28 && name.scrollWidth > name.clientWidth + 1) {
    size -= 2;
    name.style.fontSize = `${size}px`;
  }
}

const EMBLEM_ENTER = {
  anchor: [
    { opacity: 0, transform: 'translateY(-90px) rotate(-12deg) scale(.9)' },
    { opacity: 1, transform: 'translateY(10px) rotate(5deg) scale(1.02)', offset: 0.55 },
    { transform: 'translateY(-4px) rotate(-2deg) scale(1)', offset: 0.8 },
    { opacity: 1, transform: 'translateY(0) rotate(0deg) scale(1)' },
  ],
  compass: [
    { opacity: 0, transform: 'rotate(-150deg) scale(.5)' },
    { opacity: 1, transform: 'rotate(10deg) scale(1.06)', offset: 0.7 },
    { opacity: 1, transform: 'rotate(0deg) scale(1)' },
  ],
  helm: [
    { opacity: 0, transform: 'rotate(-220deg) scale(.55)' },
    { opacity: 1, transform: 'rotate(12deg) scale(1.05)', offset: 0.72 },
    { opacity: 1, transform: 'rotate(0deg) scale(1)' },
  ],
};

const EMBLEM_HOLD = {
  anchor: (duration) => ({
    duration,
    keyframes: [
      { transform: 'rotate(0deg)', easing: EASE_SWAY },
      { transform: 'rotate(2deg)', offset: 0.3, easing: EASE_SWAY },
      { transform: 'rotate(-1.5deg)', offset: 0.68, easing: EASE_SWAY },
      { transform: 'rotate(0deg)' },
    ],
  }),
  compass: (duration) => ({ duration, keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(22.5deg)' }] }),
  helm: (duration) => ({ duration, keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(30deg)' }] }),
};

function scheduleFull(session, parts, tier, holdMs) {
  const exitAt = ENTER_MS + holdMs;
  const total = exitAt + EXIT_MS;
  const enter = (node, keyframes, duration, delay, easing = EASE_OUT) =>
    session.animate(node, keyframes, { duration, delay, easing });
  // 同一节点的后续动画只向后填充，避免在等待阶段覆盖入场结果。
  const later = (node, keyframes, duration, delay, easing = EASE_IN) =>
    session.animate(node, keyframes, { duration, delay, easing, fill: 'forwards' });

  enter(parts.halo, [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'scale(1)' }], 800, 60);
  enter(parts.rays, [{ opacity: 0, transform: 'scale(.45)' }, { opacity: 1, transform: 'scale(1)' }], 1000, 180);
  enter(parts.raysBroad, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(40deg)' }], total, 0, 'linear');
  enter(parts.raysFine, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-26deg)' }], total, 0, 'linear');
  parts.waves.forEach((wave, index) =>
    enter(
      wave,
      [
        { opacity: 0, transform: 'scale(.45)' },
        { opacity: 0.95, transform: 'scale(.6)', offset: 0.06 },
        { opacity: 0, transform: 'scale(3.1)' },
      ],
      1150,
      260 + index * 210,
      'cubic-bezier(.2,.7,.3,1)',
    ),
  );
  enter(parts.emblem, EMBLEM_ENTER[tier.emblem], 1100, 120, EASE_POP);
  const hold = EMBLEM_HOLD[tier.emblem](holdMs + EXIT_MS);
  enter(parts.emblemSpin, hold.keyframes, hold.duration, ENTER_MS, 'linear');
  enter(
    parts.flash,
    [
      { opacity: 0, transform: 'scale(.2)' },
      { opacity: 1, transform: 'scale(1)', offset: 0.3 },
      { opacity: 0, transform: 'scale(1.5)' },
    ],
    700,
    380,
  );
  enter(
    parts.medallion,
    [
      { opacity: 0, transform: 'scale(.25)' },
      { opacity: 1, transform: 'scale(1.12)', offset: 0.55 },
      { transform: 'scale(.96)', offset: 0.78 },
      { opacity: 1, transform: 'scale(1)' },
    ],
    820,
    300,
    EASE_POP,
  );
  enter(parts.ringMetal, [{ strokeDashoffset: '1000' }, { strokeDashoffset: '0' }], 900, 340);
  enter(parts.ringDeco, [{ opacity: 0 }, { opacity: 1 }], 320, 1050, 'linear');
  enter(parts.avatar, [{ opacity: 0, transform: 'scale(1.25)' }, { opacity: 1, transform: 'scale(1)' }], 700, 420);
  const glint = [
    { opacity: 0, transform: 'rotate(0deg)' },
    { opacity: 1, offset: 0.15 },
    { opacity: 1, offset: 0.75 },
    { opacity: 0, transform: 'rotate(360deg)' },
  ];
  enter(parts.glint, glint, 1200, 720, 'cubic-bezier(.45,.05,.3,1)');
  later(parts.glint, glint, 1200, exitAt - 1500, 'cubic-bezier(.45,.05,.3,1)');
  enter(
    parts.ribbon,
    [
      { opacity: 0, clipPath: 'inset(-40px 50% -40px 50%)', transform: 'translateY(14px)' },
      { opacity: 1, clipPath: 'inset(-40px -40px -40px -40px)', transform: 'translateY(0)' },
    ],
    640,
    640,
    'cubic-bezier(.2,.85,.25,1)',
  );
  parts.ribbonChars.forEach((character, index) =>
    enter(
      character,
      [
        { opacity: 0, transform: 'translateY(26px) scale(.86)' },
        { opacity: 1, transform: 'translateY(-4px) scale(1.04)', offset: 0.65 },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      520,
      860 + index * 70,
      EASE_POP,
    ),
  );
  const sheen = [{ transform: 'translateX(-200px) skewX(-18deg)' }, { transform: 'translateX(760px) skewX(-18deg)' }];
  enter(parts.sheen, sheen, 900, 1260, 'cubic-bezier(.4,0,.2,1)');
  later(parts.sheen, sheen, 900, exitAt - 1300, 'cubic-bezier(.4,0,.2,1)');
  enter(
    parts.eyebrow,
    [
      { opacity: 0, transform: 'translateY(10px) scaleX(1.18)' },
      { opacity: 1, transform: 'translateY(0) scaleX(1)' },
    ],
    700,
    1000,
  );
  parts.eyebrowLines.forEach((line) =>
    enter(line, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 600, 1120),
  );
  enter(
    parts.namePill,
    [
      { opacity: 0, transform: 'translateY(22px) scale(.96)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    620,
    1150,
  );
  enter(parts.name, [{ backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0' }], 1100, 1500, EASE_SWAY);
  if (parts.months) {
    enter(
      parts.months,
      [
        { opacity: 0, transform: 'scale(.5)' },
        { opacity: 1, transform: 'scale(1.12)', offset: 0.7 },
        { opacity: 1, transform: 'scale(1)' },
      ],
      450,
      1450,
      EASE_POP,
    );
  }
  const pingGap = Math.max(1000, holdMs / 2.4);
  parts.pings.forEach((ping, index) => {
    const delay = ENTER_MS + 300 + index * pingGap;
    if (delay + 1500 > exitAt) return;
    enter(
      ping,
      [
        { opacity: 0, transform: 'scale(.95)' },
        { opacity: 0.7, transform: 'scale(1.05)', offset: 0.1 },
        { opacity: 0, transform: 'scale(2.3)' },
      ],
      1500,
      delay,
      'cubic-bezier(.2,.6,.3,1)',
    );
  });
  enter(
    parts.medallionFloat,
    [
      { transform: 'translateY(0)', easing: EASE_SWAY },
      { transform: 'translateY(-7px)', offset: 0.25, easing: EASE_SWAY },
      { transform: 'translateY(0)', offset: 0.5, easing: EASE_SWAY },
      { transform: 'translateY(-7px)', offset: 0.75, easing: EASE_SWAY },
      { transform: 'translateY(0)' },
    ],
    holdMs,
    ENTER_MS,
    'linear',
  );

  later(parts.namePill, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(16px) scale(.98)' }], 320, exitAt);
  later(parts.eyebrow, [{ opacity: 1 }, { opacity: 0 }], 280, exitAt);
  later(
    parts.ribbon,
    [
      { opacity: 1, clipPath: 'inset(-40px -40px -40px -40px)' },
      { opacity: 0, clipPath: 'inset(-40px 50% -40px 50%)' },
    ],
    420,
    exitAt + 60,
  );
  later(
    parts.medallion,
    [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.06)', offset: 0.3 },
      { opacity: 0, transform: 'scale(.55)' },
    ],
    460,
    exitAt + 140,
  );
  const emblemExit =
    tier.emblem === 'anchor'
      ? [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(30px) scale(.8)' }]
      : [{ opacity: 1, transform: 'rotate(0deg) scale(1)' }, { opacity: 0, transform: 'rotate(40deg) scale(.7)' }];
  later(parts.emblem, emblemExit, 500, exitAt + 120);
  later(parts.rays, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.6)' }], 560, exitAt + 120);
  later(parts.halo, [{ opacity: 1 }, { opacity: 0 }], 600, exitAt + 100, 'linear');
  later(
    parts.flash,
    [
      { opacity: 0, transform: 'scale(.3)' },
      { opacity: 0.85, transform: 'scale(.7)', offset: 0.35 },
      { opacity: 0, transform: 'scale(1.1)' },
    ],
    420,
    exitAt + 260,
    EASE_OUT,
  );
  return total;
}

function scheduleReduced(session, parts, holdMs) {
  const total = ENTER_MS + holdMs + EXIT_MS;
  session.animate(parts.card, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'linear' });
  session.animate(parts.card, [{ opacity: 1 }, { opacity: 0 }], {
    duration: 280,
    delay: total - 280,
    easing: 'linear',
    fill: 'forwards',
  });
  return total;
}

function cssColor(node, name) {
  return getComputedStyle(node).getPropertyValue(name).trim();
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
    const parts = buildCard(payload, tier, copy, uid);
    const holdMs = Math.round(tier.holdMs * (compressed ? COMPRESSED_HOLD_RATIO : 1));
    stage.insertBefore(parts.card, canvas);
    root.classList.add('is-playing');
    try {
      const avatarSource = payload.avatarUrl
        ? resolveAvatarUrl(payload.avatarUrl)
        : payload.preview === true
          ? tier.sample
          : '';
      await Promise.race([loadAvatar(parts.avatar, avatarSource), session.wait(AVATAR_WAIT_MS), session.abortPromise]);
      if (session.aborted) return false;
      fit();
      fitName(parts.name);
      const total = motion === 'reduced' ? scheduleReduced(session, parts, holdMs) : scheduleFull(session, parts, tier, holdMs);
      parts.card.classList.add('is-live');
      if (motion !== 'reduced') {
        particles.start({
          origin: { x: MEDALLION_CENTER.x + PARTICLE_OFFSET_X, y: MEDALLION_CENTER.y },
          colors: ['--gt-spark-a', '--gt-spark-b', '--gt-spark-c'].map((name) => cssColor(parts.card, name)),
          bursts: tier.bursts,
          ambient: { ...tier.ambient, from: ENTER_MS, until: ENTER_MS + holdMs },
          endAt: total,
          resolution: scale * (window.devicePixelRatio || 1),
        });
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
