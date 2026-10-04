// 大航海感谢 · 辉光（aurora）风格：光线在雾气中成形、又缓缓散回雾气。
// 不出现送礼人头像与名字；三档靠层数、材质与时长递进，而不是靠文字。
import { buildEmblem } from './guard-thanks-emblems.js';
import {
  AURORA_EXIT_MS,
  EASE_BREATH,
  EASE_ORGANIC,
  element,
} from './guard-thanks-stage.js';

// 入场 / 停留 / 退场（毫秒）。柔和的东西不能收得太快，退场统一 1000ms。
const AURORA_TIERS = Object.freeze({
  captain: Object.freeze({
    emblem: 'anchor',
    layers: 3,
    ribbons: 2,
    rings: 1,
    ripples: 2,
    motes: 26,
    enterMs: 1800,
    holdMs: 3000,
    material: 'dew',
  }),
  admiral: Object.freeze({
    emblem: 'compass',
    layers: 4,
    ribbons: 3,
    rings: 2,
    ripples: 3,
    motes: 44,
    orbit: 10,
    enterMs: 2000,
    holdMs: 3400,
    material: 'frost',
  }),
  governor: Object.freeze({
    emblem: 'helm',
    layers: 5,
    ribbons: 4,
    rings: 3,
    ripples: 4,
    motes: 64,
    orbit: 16,
    converge: 30,
    veilSweep: true,
    enterMs: 2200,
    holdMs: 4000,
    material: 'gilt',
  }),
});
// 各层呼吸周期取互质，避免多层同时亮暗。
const BREATH_PERIOD_SECONDS = Object.freeze([7.3, 9.1, 11.7, 8.3, 10.1]);

export function buildAuroraCard(payload, tier, copy, uid) {
  const motion = AURORA_TIERS[payload.tier];
  const card = element('div', 'gta-card');
  card.dataset.tier = payload.tier;
  card.dataset.lang = copy.lang;
  card.dataset.material = motion.material;
  const parts = { card, motion };

  parts.veil = element('div', 'gta-veil');
  parts.washes = Array.from({ length: motion.layers }, (_, index) =>
    element('div', `gta-wash gta-wash-${index + 1}`),
  );

  parts.ribbons = Array.from({ length: motion.ribbons }, (_, index) => {
    const ribbon = element('div', `gta-ribbon gta-ribbon-${index + 1}`);
    ribbon.append(element('i'));
    return ribbon;
  });

  parts.halo = element('div', 'gta-halo');
  parts.haloCore = element('div', 'gta-halo-core');
  parts.halo.append(parts.haloCore);
  parts.rings = Array.from({ length: motion.rings }, (_, index) => {
    const ring = element('div', `gta-ring gta-ring-${index + 1}`);
    ring.append(element('i'), element('b'));
    return ring;
  });
  // 刻环：提督 1 圈、总督 2 圈反向旋转。
  parts.etchings = Array.from({ length: Math.max(0, motion.rings - 1) }, (_, index) =>
    element('div', `gta-etching gta-etching-${index + 1}`),
  );
  parts.ripples = Array.from({ length: motion.ripples }, (_, index) => element('div', `gta-ripple gta-ripple-${index + 1}`));

  // 光刻纹章：复用经典档的矢量几何，由 CSS 覆盖为描边-only。
  parts.sigil = element('div', `gta-sigil is-${motion.emblem}`);
  parts.sigilSpin = element('div', 'gta-sigil-spin');
  parts.sigilBloom = element('div', 'gta-sigil-bloom');
  parts.sigilTrace = element('div', 'gta-sigil-trace');
  parts.sigilSpin.append(buildEmblem(motion.emblem, uid));
  parts.sigil.append(parts.sigilBloom, parts.sigilSpin, parts.sigilTrace);

  parts.titleBlock = element('div', 'gta-title');
  parts.titleChars = Array.from(copy.title, (character) => element('span', 'gta-title-char', character));
  parts.titleBlock.append(...parts.titleChars);
  parts.scrim = element('div', 'gta-scrim');
  parts.titleRow = element('div', 'gta-title-row');
  parts.titleRow.append(parts.scrim, parts.titleBlock);

  parts.eyebrow = element('div', 'gta-eyebrow');
  parts.eyebrowBottomLine = element('i', 'gta-hairline');
  parts.eyebrowTopLine = element('i', 'gta-hairline');
  parts.eyebrow.dataset.lang = copy.eyebrowLang || copy.lang;
  parts.eyebrow.append(
    parts.eyebrowTopLine,
    element('span', 'gta-eyebrow-text', copy.eyebrow),
    parts.eyebrowBottomLine,
  );

  parts.footer = element('div', 'gta-footer');
  if (copy.months) parts.months = element('span', 'gta-months', copy.months);
  parts.footer.append(...(parts.months ? [parts.months] : []));

  parts.material = element('div', `gta-material is-${motion.material}`);
  parts.materialItems = Array.from({ length: motion.material === 'gilt' ? 14 : motion.material === 'frost' ? 9 : 12 }, (_, index) =>
    element('i', `gta-material-item gta-material-item-${(index % 4) + 1}`),
  );
  parts.material.append(...parts.materialItems);

  card.append(
    parts.veil,
    ...parts.washes,
    ...parts.ribbons,
    parts.halo,
    ...parts.rings,
    ...parts.etchings,
    ...parts.ripples,
    parts.sigil,
    parts.material,
    parts.eyebrow,
    parts.titleRow,
    parts.footer,
  );
  return parts;
}

export function scheduleAurora(session, parts, tier, holdMs) {
  const motion = parts.motion;
  const enterMs = motion.enterMs;
  const exitAt = enterMs + holdMs;
  const total = exitAt + AURORA_EXIT_MS;
  const enter = (node, keyframes, duration, delay, easing = EASE_ORGANIC) =>
    session.animate(node, keyframes, { duration, delay, easing });
  const later = (node, keyframes, duration, delay, easing = EASE_ORGANIC) =>
    session.animate(node, keyframes, { duration, delay, easing, fill: 'forwards' });

  // 1. 雾底光场：错位偏移、缓慢缩放横移，各层按互质周期呼吸。
  parts.washes.forEach((wash, index) => {
    const drift = index % 2 === 0 ? 40 : -34;
    enter(wash, [{ opacity: 0, transform: 'scale(.86) translateX(0)' }, { opacity: 1, transform: 'scale(1) translateX(0)' }], 1400, index * 130);
    enter(
      wash,
      [
        { opacity: 1, transform: `scale(1) translateX(0px)` },
        { opacity: 0.82, transform: `scale(1.06) translateX(${drift}px)`, offset: 0.5 },
        { opacity: 1, transform: 'scale(1) translateX(0px)' },
      ],
      BREATH_PERIOD_SECONDS[index % BREATH_PERIOD_SECONDS.length] * 1000,
      enterMs,
      'linear',
    );
  });

  // 2. 极光绸带：反向漂移 + 宽度呼吸。
  parts.ribbons.forEach((ribbon, index) => {
    const forward = index % 2 === 0;
    enter(
      ribbon,
      [
        { opacity: 0, transform: `translateX(${forward ? -90 : 90}px) scaleY(.7)` },
        { opacity: 1, transform: 'translateX(0px) scaleY(1)' },
      ],
      1500,
      220 + index * 150,
    );
    enter(
      ribbon.querySelector('i'),
      [
        { opacity: 0.9, transform: 'scaleY(.75)' },
        { opacity: 1, transform: 'scaleY(1.15)', offset: 0.5 },
        { opacity: 0.9, transform: 'scaleY(.75)' },
      ],
      6800 + index * 1100,
      enterMs - 400,
      'linear',
    );
  });

  // 3. 光晕环：从略大温和收到 0.62，边缘靠双层 blur 消硬边。
  enter(parts.halo, [{ opacity: 0 }, { opacity: 1 }], 1100, 120);
  enter(
    parts.haloCore,
    [
      { opacity: 0, transform: 'scale(1.15)' },
      { opacity: 1, transform: 'scale(.72)', offset: 0.72 },
      { opacity: 1, transform: 'scale(.62)' },
    ],
    enterMs,
    260,
  );
  // 中段一次呼吸：亮度 +12%、尺寸 +3%，让画面"活着"。
  if (holdMs > 1200) {
    const breathAt = enterMs + holdMs / 2 - 450;
    later(
      parts.haloCore,
      [
        { opacity: 1, transform: 'scale(.62)' },
        { opacity: 1, transform: 'scale(.639)', offset: 0.5 },
        { opacity: 1, transform: 'scale(.62)' },
      ],
      900,
      breathAt,
      EASE_BREATH,
    );
  }

  parts.rings.forEach((ring, index) => {
    enter(
      ring,
      [
        { opacity: 0, transform: 'scale(1.1)' },
        { opacity: 1, transform: 'scale(1)', offset: 0.6 },
        { opacity: 0.86, transform: 'scale(.99)' },
      ],
      1500,
      420 + index * 220,
    );
  });
  parts.etchings.forEach((etching, index) =>
    enter(etching, [{ opacity: 0 }, { opacity: .7 }], 1200, 900 + index * 300),
  );
  parts.etchings.forEach((etching, index) =>
    enter(
      etching,
      [{ transform: `rotate(0deg)` }, { transform: `rotate(${index % 2 === 0 ? 46 : -52}deg)` }],
      holdMs + AURORA_EXIT_MS,
      enterMs,
      'linear',
    ),
  );

  // 4. 涟漪：填充式圆环，不用描边圆圈。
  parts.ripples.forEach((ripple, index) =>
    enter(
      ripple,
      [
        { opacity: 0, transform: 'scale(.42)' },
        { opacity: 0.82, transform: 'scale(.58)', offset: 0.08 },
        { opacity: 0, transform: 'scale(2.9)' },
      ],
      2100 + index * 160,
      520 + index * 380,
      'cubic-bezier(.2,.7,.3,1)',
    ),
  );

  // 5. 光刻纹章：底衬泛光先亮，再让光沿轮廓"画"出来，最后彗尾收束。
  enter(parts.sigilBloom, [{ opacity: 0 }, { opacity: 1 }], 1200, 760);
  enter(
    parts.sigil,
    [
      { opacity: 0, transform: 'scale(.9)' },
      { opacity: 1, transform: 'scale(1)' },
    ],
    1600,
    620,
  );
  enter(parts.sigilSpin, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(12deg)' }], total, 0, 'linear');
  enter(
    parts.sigilTrace,
    [
      { opacity: 0, transform: 'rotate(0deg)' },
      { opacity: 1, transform: 'rotate(0deg)', offset: 0.12 },
      { opacity: 1, transform: 'rotate(300deg)', offset: 0.62 },
      { opacity: 0, transform: 'rotate(330deg)' },
    ],
    1900,
    780,
  );

  // 6. 专属材质：舰长露珠、提督霜纹、总督金箔。
  enter(parts.material, [{ opacity: 0 }, { opacity: 1 }], 1400, 1000);
  parts.materialItems.forEach((item, index) =>
    enter(
      item,
      [
        { opacity: 0, transform: 'translateY(14px) scale(.7) rotate(0deg)' },
        { opacity: 0.9, transform: 'translateY(-6px) scale(1) rotate(60deg)', offset: 0.55 },
        { opacity: 0.35, transform: 'translateY(-22px) scale(.94) rotate(150deg)' },
      ],
      3200 + index * 120,
      1050 + index * 90,
      EASE_BREATH,
    ),
  );

  // 7. 文字：整块一次模糊聚焦，逐字只做透明度与位移。
  enter(
    parts.eyebrow,
    [
      { opacity: 0, filter: 'blur(8px)', transform: 'translateY(10px)' },
      { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)' },
    ],
    1100,
    1150,
  );
  [parts.eyebrowTopLine, parts.eyebrowBottomLine].forEach((line, index) =>
    enter(line, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 900, 1250 + index * 120),
  );
  enter(
    parts.titleRow,
    [
      { opacity: 0, filter: 'blur(14px)' },
      { opacity: 1, filter: 'blur(0px)' },
    ],
    1400,
    1280,
  );
  enter(parts.scrim, [{ opacity: 0, transform: 'scaleX(.6)' }, { opacity: 1, transform: 'scaleX(1)' }], 1200, 1380);
  parts.titleChars.forEach((character, index) =>
    enter(
      character,
      [
        { opacity: 0, transform: 'translateY(18px)', letterSpacing: '.62em' },
        { opacity: 1, transform: 'translateY(0)', letterSpacing: '.3em' },
      ],
      1200,
      1400 + index * 110,
    ),
  );
  if (parts.months) {
    enter(
      parts.months,
      [
        { opacity: 0, transform: 'scale(.82)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      900,
      1900,
    );
  }

  // 8. 整体缓慢漂移，制造手持镜头感。
  enter(
    parts.card,
    [
      { transform: 'translate(0px, 0px)' },
      { transform: 'translate(-4px, -6px)', offset: 0.32 },
      { transform: 'translate(5px, -2px)', offset: 0.68 },
      { transform: 'translate(0px, 0px)' },
    ],
    total,
    0,
    'linear',
  );

  // 退场：上浮虚化，不缩放。
  const fadeOut = (node, delay, distance = -24, blur = 10) =>
    later(
      node,
      [
        { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0px)' },
        { opacity: 0, filter: `blur(${blur}px)`, transform: `translateY(${distance}px)` },
      ],
      680,
      delay,
      EASE_ORGANIC,
    );
  fadeOut(parts.footer, exitAt, -18, 6);
  fadeOut(parts.eyebrow, exitAt + 60, -20, 6);
  fadeOut(parts.titleRow, exitAt + 40, -26, 10);
  later(parts.material, [{ opacity: 1 }, { opacity: 0 }], 700, exitAt + 20, 'linear');
  later(
    parts.sigil,
    [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(1.06)' },
    ],
    760,
    exitAt + 80,
    EASE_ORGANIC,
  );
  parts.ripples.slice(0, 2).forEach((ripple, index) =>
    later(
      ripple,
      [
        { opacity: 0, transform: 'scale(.9)' },
        { opacity: 0.5, transform: 'scale(1.05)', offset: 0.35 },
        { opacity: 0, transform: 'scale(2.1)' },
      ],
      1200,
      exitAt + index * 140,
      EASE_ORGANIC,
    ),
  );
  later(parts.halo, [{ opacity: 1 }, { opacity: 0 }], 900, exitAt, 'linear');
  parts.rings.forEach((ring, index) =>
    later(
      ring,
      [
        { opacity: .86, transform: 'scale(.99)' },
        { opacity: 0, transform: 'scale(1.04)' },
      ],
      800,
      exitAt + index * 90,
      EASE_ORGANIC,
    ),
  );
  later(parts.veil, [{ opacity: .9 }, { opacity: 0 }], 1000, exitAt + 120, 'linear');
  return total;
}

// 减少动态效果时保留静帧构图，只做柔和淡入淡出，而不是退化成纯色闪一下。
export function scheduleAuroraReduced(session, parts, holdMs, enterMs, total) {
  session.animate(parts.card, [{ opacity: 0 }, { opacity: 1 }], { duration: 520, easing: EASE_ORGANIC });
  session.animate(parts.card, [{ opacity: 1 }, { opacity: 0 }], {
    duration: 620,
    delay: total - 620,
    easing: EASE_ORGANIC,
    fill: 'forwards',
  });
  return total;
}

export const auroraRenderer = Object.freeze({
  id: 'aurora',
  needsAvatar: false,
  build: buildAuroraCard,
  schedule: scheduleAurora,
  scheduleReduced: scheduleAuroraReduced,
});
