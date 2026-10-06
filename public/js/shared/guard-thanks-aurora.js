// 大航海感谢 · 辉光：分档珠贝纹章、流动反光与随卡片收尾的光饰。
import { buildEmblem, svgNode } from './guard-thanks-emblems.js';
import { AURORA_EXIT_MS, EASE_ORGANIC, element } from './guard-thanks-stage.js';

const ARTWORK_ROOT = '/img/overlays/guard-thanks/';
const ARTWORK_WAIT_MS = 1400;
const AURORA_TIERS = Object.freeze({
  captain: Object.freeze({
    emblem: 'anchor', rings: 1, motes: 18, enterMs: 2800, material: 'blue-pearl',
    glints: [[292, 94], [212, 202], [452, 458]],
  }),
  admiral: Object.freeze({
    emblem: 'compass', rings: 3, motes: 32, enterMs: 3000, material: 'violet-pearl',
    glints: [[320, 110], [478, 316], [261, 381], [181, 228], [346, 464], [214, 406]],
  }),
  governor: Object.freeze({
    emblem: 'helm', rings: 5, motes: 50, enterMs: 3200, material: 'ruby-pearl',
    glints: [[320, 304], [181, 159], [495, 294], [322, 511], [193, 448], [442, 164], [160, 314], [425, 447]],
  }),
});

export function buildAuroraCard(payload, tier, copy, uid) {
  const motion = AURORA_TIERS[payload.tier];
  const card = element('div', 'gta-card');
  card.dataset.tier = payload.tier;
  card.dataset.lang = copy.lang;
  card.dataset.material = motion.material;
  const parts = { card, motion };

  parts.aura = element('div', 'gta-aura');
  parts.rays = element('div', 'gta-rays');
  parts.halo = element('div', 'gta-halo');
  parts.orbit = svgNode('svg', { class: 'gta-orbit', viewBox: '0 0 800 760', 'aria-hidden': 'true' });
  const paths = [
    'M132 478 C50 272 208 72 420 96 C618 110 716 284 666 442',
    'M176 580 C354 690 660 570 688 350',
    'M128 338 C158 150 450 64 616 236',
    'M184 616 C370 710 646 624 712 440',
    'M90 402 C54 218 234 58 406 70',
  ];
  parts.orbitPaths = paths.slice(0, motion.rings).map((d, index) => svgNode('path', {
    d, class: `gta-orbit-path gta-orbit-path-${index + 1}`, pathLength: 1,
  }));
  parts.trails = paths.slice(0, motion.rings).map((d, index) => {
    const trail = svgNode('g', { class: `gta-orbit-trail gta-orbit-trail-${index + 1}` });
    trail.append(
      svgNode('path', { d, class: 'gta-trail-tail', pathLength: 1 }),
      svgNode('path', { d, class: 'gta-trail-head', pathLength: 1 }),
    );
    return trail;
  });
  parts.orbit.append(...parts.orbitPaths, ...parts.trails);

  parts.regaliaLines = [];
  parts.regaliaStars = [];
  parts.crownRays = [];
  parts.ripples = [];
  if (payload.tier !== 'captain') {
    parts.regalia = svgNode('svg', { class: 'gta-orbit gta-regalia', viewBox: '0 0 800 760', 'aria-hidden': 'true' });
    parts.regaliaLines = [
      'M154 104 A348 348 0 0 0 154 596',
      'M646 104 A348 348 0 0 1 646 596',
    ].map((d) => svgNode('path', { d, class: 'gta-regalia-line', pathLength: 1 }));
    const starsPerSide = payload.tier === 'governor' ? 6 : 4;
    parts.regaliaStars = Array.from({ length: starsPerSide * 2 }, (_, index) => {
      const angle = (145 + index % starsPerSide * 70 / (starsPerSide - 1) + (index < starsPerSide ? 0 : 180)) * Math.PI / 180;
      const x = 400 + Math.cos(angle) * 348;
      const y = 350 + Math.sin(angle) * 348;
      return svgNode('path', { class: 'gta-regalia-star', d: `M${x} ${y - 5} L${x + 3} ${y} L${x} ${y + 5} L${x - 3} ${y} Z` });
    });
    if (payload.tier === 'governor') {
      parts.crownRays = Array.from({ length: 9 }, (_, index) => {
        const angle = (-130 + index * 10) * Math.PI / 180;
        const radius = 352 + (index === 4 ? 20 : index % 2 === 0 ? 10 : 0);
        return svgNode('path', {
          class: 'gta-crown-ray', pathLength: 1,
          d: `M${400 + Math.cos(angle) * 322} ${350 + Math.sin(angle) * 322} L${400 + Math.cos(angle) * radius} ${350 + Math.sin(angle) * radius}`,
        });
      });
      parts.ripples = Array.from({ length: 2 }, () => element('div', 'gta-ripple'));
    }
    parts.regalia.append(...parts.regaliaLines, ...parts.regaliaStars, ...parts.crownRays);
  }

  parts.sigil = element('div', `gta-sigil is-${motion.emblem}`);
  parts.artwork = element('img', 'gta-artwork');
  parts.artwork.alt = '';
  parts.artwork.draggable = false;
  parts.artwork.decoding = 'async';
  // 与 CSS 蒙版使用相同请求模式，让显示图与反光共用一份素材。
  parts.artwork.crossOrigin = 'anonymous';
  parts.artwork.src = `${ARTWORK_ROOT}${payload.tier}-pearl-v1.webp`;
  parts.sigil.style.setProperty('--gta-artwork', `url("${parts.artwork.getAttribute('src')}")`);
  parts.reflection = element('div', 'gta-reflection');
  parts.glints = motion.glints.map(([x, y], index) => {
    const glint = element('i', 'gta-glint');
    glint.style.left = `${x}px`;
    glint.style.top = `${y}px`;
    glint.style.setProperty('--gta-glint-size', `${index === 0 ? 42 : 28}px`);
    return glint;
  });
  parts.fallback = element('div', 'gta-sigil-fallback');
  parts.fallback.append(buildEmblem(motion.emblem, uid));
  parts.sigil.append(parts.fallback, parts.artwork, parts.reflection, ...parts.glints);

  parts.motes = Array.from({ length: motion.motes }, (_, index) => {
    const angle = index * 2.4;
    const radius = 268 + index % 5 * 19;
    const mote = element('i', `gta-mote${index % 6 === 0 ? ' is-star' : ''}${index % 3 === 0 ? ' is-accent' : ''}`);
    mote.style.left = `${640 + Math.cos(angle) * radius * 1.08}px`;
    mote.style.top = `${444 + Math.sin(angle) * radius * 0.86}px`;
    mote.style.setProperty('--gta-mote-size', `${index % 6 === 0 ? 16 : 4 + index % 3}px`);
    return mote;
  });

  parts.caption = element('div', 'gta-caption');
  parts.titleRow = element('div', 'gta-title-row');
  parts.titleBlock = element('div', 'gta-title');
  parts.titleChars = Array.from(copy.title, (character) => element('span', 'gta-title-char', character));
  parts.titleBlock.append(...parts.titleChars);
  parts.titleRow.append(parts.titleBlock);
  parts.eyebrow = element('div', 'gta-eyebrow');
  parts.eyebrow.dataset.lang = copy.eyebrowLang || copy.lang;
  parts.eyebrow.append(element('i', 'gta-hairline'), element('span', 'gta-eyebrow-text', copy.eyebrow), element('i', 'gta-hairline'));
  parts.footer = element('div', 'gta-footer');
  if (copy.months) {
    parts.months = element('span', 'gta-months', copy.months);
    parts.footer.append(parts.months);
  }
  parts.caption.append(parts.titleRow, parts.eyebrow, parts.footer);
  card.append(parts.aura, parts.rays, parts.halo, ...parts.ripples);
  if (parts.regalia) card.append(parts.regalia);
  card.append(parts.orbit, parts.sigil, ...parts.motes, parts.caption);
  return parts;
}

async function prepareAurora(session, parts) {
  // 素材解码与标题字体都在入场前准备；超时使用矢量后备，播放中不突然换图。
  const artworkReady = parts.artwork.decode().then(() => true, () => false);
  const fontReady = document.fonts.load('400 96px "Lira Guard Serif"', parts.titleBlock.textContent).catch(() => []);
  const ready = await Promise.race([
    Promise.all([artworkReady, fontReady]).then(([artwork, fonts]) => ({ artwork, font: fonts.length > 0 })),
    session.wait(ARTWORK_WAIT_MS).then(() => null),
    session.abortPromise.then(() => null),
  ]);
  if (session.aborted) return;
  if (ready?.artwork) parts.sigil.classList.add('has-artwork');
  if (ready?.font) parts.card.classList.add('has-title-font');
}

export function scheduleAurora(session, parts, tier, holdMs) {
  const { enterMs } = parts.motion;
  const exitAt = enterMs + holdMs;
  const total = exitAt + AURORA_EXIT_MS;
  const enter = (node, frames, duration, delay = 0, easing = EASE_ORGANIC) =>
    session.animate(node, frames, { duration, delay, easing });
  const later = (node, frames, duration, delay, easing = 'ease-in-out') =>
    session.animate(node, frames, { duration, delay, easing, fill: 'forwards' });

  // 先勾勒弧线，再浮现纹章；光环、文字与星芒依次进入，各层保留自己的节奏。
  enter(parts.aura, [
    { opacity: 0, transform: 'scale(.88)' },
    { opacity: 0.9, transform: 'scale(1)', offset: 0.25 },
    { opacity: 0.65, transform: 'scale(1.04)', offset: 0.6 },
    { opacity: 0.85, transform: 'scale(1)' },
  ], exitAt, 0, 'ease-in-out');
  enter(parts.rays, [
    { opacity: 0, transform: 'rotate(-22deg) scale(.9)' },
    { opacity: 0.8, transform: 'rotate(-8deg) scale(1)', offset: 0.3 },
    { opacity: 0.55, transform: 'rotate(12deg) scale(1.035)', offset: 0.7 },
    { opacity: 0.7, transform: 'rotate(28deg) scale(1)' },
  ], exitAt - 1400, 1400, 'linear');
  enter(parts.halo, [
    { opacity: 0, transform: 'scale(.82) rotate(-25deg)' },
    { opacity: 0.85, transform: 'scale(1) rotate(0deg)', offset: 0.32 },
    { opacity: 0.65, transform: 'scale(1.05) rotate(25deg)', offset: 0.65 },
    { opacity: 0.8, transform: 'scale(1.01) rotate(45deg)' },
  ], exitAt - 1100, 1100, 'ease-in-out');
  enter(parts.orbit, [{ opacity: 0 }, { opacity: 1 }], 600, 80);
  parts.orbitPaths.forEach((path, index) => {
    enter(path, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 1000, 120 + index * 240);
  });
  parts.trails.forEach((trail, index) => {
    const from = 1 - index * 0.2;
    const delay = 1800 + index * 280;
    enter(trail, [
      { opacity: 0, strokeDashoffset: from },
      { opacity: 0.9, strokeDashoffset: from - 0.2, offset: 0.1 },
      { opacity: 0.9, strokeDashoffset: from - 1.9, offset: 0.88 },
      { opacity: 0, strokeDashoffset: from - 2.2 },
    ], exitAt - delay - 150, delay, 'linear');
  });
  // 中心纹章始终固定，只淡入淡出；空间运动全部留给外围光饰。
  enter(parts.sigil, [{ opacity: 0 }, { opacity: 1 }], 1000, 600);
  later(parts.orbit, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(12deg)' }], holdMs, enterMs, 'linear');

  // 提督沿两侧逐点亮起星链；总督再以金色冠芒和双重光环完成加冕。
  parts.regaliaLines.forEach((line, index) => {
    enter(line, [{ opacity: 0, strokeDashoffset: 1 }, { opacity: 0.5, strokeDashoffset: 0 }], 1100, 1800 + index * 200);
  });
  parts.regaliaStars.forEach((star, index) => {
    session.animate(star, [
      { opacity: 0, transform: 'scale(.4)' },
      { opacity: 0.9, transform: 'scale(1.15)', offset: 0.18 },
      { opacity: 0.55, transform: 'scale(1)', offset: 0.5 },
      { opacity: 0.8, transform: 'scale(1.1)', offset: 0.8 },
      { opacity: 0.45, transform: 'scale(1)' },
    ], { duration: 2800, delay: 2300 + index * 70, iterations: 2, direction: 'alternate', easing: 'ease-in-out' });
  });
  parts.crownRays.forEach((ray, index) => {
    enter(ray, [
      { opacity: 0, strokeDashoffset: 1 },
      { opacity: 0.8, strokeDashoffset: 0, offset: 0.5 },
      { opacity: 0.5, strokeDashoffset: 0 },
    ], 1100, 2150 + Math.abs(index - 4) * 80);
  });
  parts.ripples.forEach((ripple, index) => {
    enter(ripple, [
      { opacity: 0, transform: 'scale(.74)' },
      { opacity: 0.55, transform: 'scale(.86)', offset: 0.25 },
      { opacity: 0, transform: 'scale(1.1)' },
    ], 1550, 1650 + index * 640, 'ease-out');
  });

  // 反光由原图 alpha 裁切，只掠过珠贝表面；星点附着在各自纹章的受光位置。
  session.animate(parts.reflection, [
    { opacity: 0, backgroundPosition: '165% 0' },
    { opacity: 0.75, backgroundPosition: '125% 0', offset: 0.2 },
    { opacity: 0.75, backgroundPosition: '-20% 0', offset: 0.75 },
    { opacity: 0, backgroundPosition: '-65% 0' },
  ], { duration: 2600, delay: 1700, iterations: 2, easing: 'ease-in-out' });
  parts.glints.forEach((glint, index) => {
    session.animate(glint, [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.35) rotate(-12deg)' },
      { opacity: 0.9, transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', offset: 0.25 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.5) rotate(18deg)', offset: 0.6 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.35) rotate(18deg)' },
    ], { duration: 2350 + index * 170, delay: 2300 + index * 270, iterations: 2, easing: 'ease-in-out' });
  });

  // 文字不参与高光或虚化，短距离淡入后保持稳定。
  enter(parts.caption, [{ opacity: 0 }, { opacity: 1 }], 360, 1500);
  parts.titleChars.forEach((character, index) => {
    enter(character, [
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], 650, 1580 + index * 35);
  });
  enter(parts.eyebrow, [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], 550, 2080);
  if (parts.months) enter(parts.months, [{ opacity: 0 }, { opacity: 1 }], 400, 2380);

  // 六枚一组错峰点亮，后续批次延续到停留段，所有动效统一随卡片结束。
  parts.motes.forEach((mote, index) => {
    const drift = Math.sin(index * 1.7) * 48;
    const rise = 56 + index % 4 * 14;
    session.animate(mote, [
      { opacity: 0, transform: 'translate(0, 12px) scale(.6)' },
      { opacity: 0.82, transform: `translate(${drift * 0.3}px, -8px) scale(1)`, offset: 0.25 },
      { opacity: 0.55, transform: `translate(${drift * 0.75}px, ${-rise * 0.6}px) scale(.8)`, offset: 0.68 },
      { opacity: 0, transform: `translate(${drift}px, ${-rise}px) scale(.4)` },
    ], { duration: 2700 + index % 4 * 240, delay: 1500 + Math.floor(index / 6) * 420 + index % 6 * 70, iterations: 2, easing: 'ease-in-out' });
  });

  later(parts.card, [
    { opacity: 1 },
    { opacity: 0 },
  ], AURORA_EXIT_MS, exitAt, 'cubic-bezier(.4,0,.7,1)');
  return total;
}

export function scheduleAuroraReduced(session, parts, holdMs, enterMs, total) {
  session.animate(parts.card, [{ opacity: 0 }, { opacity: 1 }], { duration: 520, easing: EASE_ORGANIC });
  session.animate(parts.card, [{ opacity: 1 }, { opacity: 0 }], {
    duration: 620, delay: total - 620, easing: EASE_ORGANIC, fill: 'forwards',
  });
  return total;
}

export const auroraRenderer = Object.freeze({
  id: 'aurora',
  needsAvatar: false,
  prepare: prepareAurora,
  build: buildAuroraCard,
  schedule: scheduleAurora,
  scheduleReduced: scheduleAuroraReduced,
});
