// 特效 2 · 缎带礼笺：礼盒从下方一角弹出，缎带沿画面四边一笔绕成闭合画框，
// 在对角上方系成蝴蝶结并垂下礼签。全部美术在播放时用 SVG 现建现拆，
// 观众文字只经 textContent 写入 1920×1080 设计坐标。
'use strict';

import { createGuardParticles } from '../shared/guard-thanks-particles.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DESIGN = Object.freeze({ width: 1920, height: 1080 });

export const RIBBON_TIMELINE = Object.freeze({
  boxIn: [0, 420],
  lidOpen: [300, 640],
  boxBurstAt: 420,
  strandsDraw: [480, 1900],
  bowTie: [1880, 2200],
  bowBurstAt: 1900,
  tagDrop: [2100, 3200],
  sheen: [2700, 3700],
  tagFade: [3950, 4250],
  bowShrink: [4100, 4400],
  strandsRetract: [4250, 4850],
  boxClose: [4650, 5050],
  total: 5050,
});

const SIDE_ORDER = Object.freeze(['left', 'right']);
const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
const EASE_POP = 'cubic-bezier(.24,1.12,.32,1)';
const EASE_IN = 'cubic-bezier(.55,0,.75,.2)';
const STRAND_DASH = '1 2';

// 缎带沿画面四边走一圈，中间留出直播安全区；两条带子在蝴蝶结处收口。
const FRAME_BOX = Object.freeze({ left: 214, right: 1706, top: 150, bottom: 940, radius: 150 });
const BOX_CENTER = Object.freeze({ x: 236, y: 866 });
const BOW_CENTER = Object.freeze({ x: 1700, y: 176 });
// 礼签宽度是中文排版的下限来源：两行文字、每行留出 26px 内边距。
const TAG = Object.freeze({ left: 1360, top: 306, width: 380, height: 120 });

let nextSideIndex = 0;

function createPalette() {
  return Object.freeze({
    wine: '#A82944',
    wineDeep: '#6E1B30',
    rose: '#E4708B',
    roseLight: '#F3A6B6',
    pink: '#F6C3CE',
    gold: '#E3C07A',
    goldDeep: '#A8792F',
    cream: '#FFF8EC',
    ink: '#5A2430',
    shadow: 'rgba(74, 22, 36, 0.32)',
  });
}

export function createRibbonController({ root }) {
  if (!root) throw new Error('缎带礼笺缺少舞台容器。');
  const particles = createGuardParticles(ensureCanvas());
  let stop = null;
  let disposed = false;

  function ensureCanvas() {
    let canvas = root.querySelector('canvas.ribbon-particles');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'ribbon-particles';
      canvas.setAttribute('aria-hidden', 'true');
      root.append(canvas);
    }
    return canvas;
  }

  function resize() {
    const host = root.parentElement || root;
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    root.style.setProperty('--frame-scale', Math.min(width / DESIGN.width, height / DESIGN.height));
  }

  function play(payload) {
    if (disposed) return Promise.resolve();
    stop?.();
    const side = SIDE_ORDER[nextSideIndex % SIDE_ORDER.length];
    nextSideIndex += 1;

    const session = createSession();
    const art = buildArtwork(side);
    const caption = buildCaption(payload, side);
    root.append(art.node, caption.node);
    root.classList.add('is-playing');
    particles.start({
      origin: art.boxCenter,
      colors: [art.palette.gold, art.palette.pink, art.palette.cream],
      bursts: [
        { at: RIBBON_TIMELINE.boxBurstAt, count: 14, kinds: ['spark', 'star'], origin: art.boxCenter, spread: 0.4 },
        { at: RIBBON_TIMELINE.bowBurstAt, count: 26, kinds: ['spark', 'confetti', 'star'], origin: art.bowCenter, spread: 0.62 },
      ],
      endAt: RIBBON_TIMELINE.sheen[1],
      resolution: Math.min(1.5, Math.max(0.3, (window.devicePixelRatio || 1) > 1.5 ? 1.2 : 1)),
    });

    const done = new Promise((resolve) => {
      stop = () => {
        session.abort();
        resolve();
      };
      runTimeline(session, art, caption);
      session.wait(RIBBON_TIMELINE.total).then(() => {
        if (!session.aborted) resolve();
      });
    });
    return done.finally(() => {
      stop = null;
      session.cleanup();
      particles.stop();
      art.node.remove();
      caption.node.remove();
      root.classList.remove('is-playing');
    });
  }

  window.addEventListener('resize', resize);
  resize();
  return {
    play,
    dispose() {
      disposed = true;
      stop?.();
      window.removeEventListener('resize', resize);
      particles.stop();
      root.querySelectorAll('.ribbon-stage, .ribbon-tag').forEach((node) => node.remove());
      root.classList.remove('is-playing');
    },
  };
}

function runTimeline(session, art, caption) {
  const t = RIBBON_TIMELINE;
  const at = ([start, end]) => ({ duration: end - start, delay: start });
  session.animate(art.box, [{ transform: 'translateY(120px) scale(.82)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
    ...at(t.boxIn),
    easing: EASE_POP,
  });
  art.lid.style.transformOrigin = '138px 776px';
  art.lid.style.transformBox = 'view-box';
  session.animate(art.lid, [{ transform: 'translateY(0) rotate(0deg)' }, { transform: 'translateY(-14px) rotate(-26deg)' }], {
    ...at(t.lidOpen),
    easing: EASE_OUT,
    fill: 'forwards',
  });
  for (const [index, strand] of art.strands.entries()) {
    const draw = at(t.strandsDraw);
    const delay = draw.delay + index * 220;
    for (const line of strand.lines) {
      session.animate(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: draw.duration, delay, easing: 'linear' });
    }
    session.animate(strand.sheen, [{ strokeDashoffset: 1.13 }, { strokeDashoffset: -0.13 }], {
      ...at(t.sheen),
      easing: 'linear',
    });
    for (const line of strand.lines) {
      session.animate(line, [{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }], {
        ...at(t.strandsRetract),
        easing: EASE_IN,
        fill: 'forwards',
      });
    }
  }
  session.animate(art.bow, [{ transform: 'scale(.2) rotate(-24deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
    ...at(t.bowTie),
    easing: EASE_POP,
  });
  session.animate(art.bow, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.72) rotate(10deg)', opacity: 0 }], {
    ...at(t.bowShrink),
    easing: EASE_IN,
    fill: 'forwards',
  });
  session.animate(caption.string, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
    ...at(t.tagDrop),
    easing: EASE_OUT,
  });
  session.animate(caption.node, [{ transform: 'translateY(-70px)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
    ...at(t.tagDrop),
    easing: EASE_POP,
  });
  session.animate(caption.node, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(14px)', opacity: 0 }], {
    ...at(t.tagFade),
    easing: EASE_IN,
    fill: 'forwards',
  });
  session.animate(art.box, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.9)', opacity: 0 }], {
    ...at(t.boxClose),
    easing: EASE_IN,
    fill: 'forwards',
  });
  session.animate(art.lid, [{ transform: 'translateY(-14px) rotate(-26deg)' }, { transform: 'none' }], {
    ...at(t.boxClose),
    easing: EASE_IN,
    fill: 'forwards',
  });
}

function buildArtwork(side) {
  const mirrored = side === 'right';
  const mirrorX = (x) => (mirrored ? DESIGN.width - x : x);
  const palette = createPalette();

  const boxCenter = { x: mirrorX(BOX_CENTER.x), y: BOX_CENTER.y };
  const bowCenter = { x: mirrorX(BOW_CENTER.x), y: BOW_CENTER.y };
  const { left, right, top, bottom, radius: r } = FRAME_BOX;
  // 两条缎带各走半圈，在蝴蝶结处收口，合起来是闭合画框。
  const strandPaths = mirrored
    ? [
        `M ${mirrorX(left)} ${bottom - 168} L ${mirrorX(left)} ${top + r}` +
          ` A ${r} ${r} 0 0 1 ${mirrorX(left) - r} ${top}` +
          ` L ${mirrorX(right) + r - 40} ${top}` +
          ` C ${mirrorX(right) + 10} ${top} ${mirrorX(BOW_CENTER.x)} ${top + 30} ${mirrorX(BOW_CENTER.x)} ${top + 44}`,
        `M ${mirrorX(left) + 96} ${bottom}` +
          ` L ${mirrorX(right) - r + 30} ${bottom}` +
          ` A ${r} ${r} 0 0 0 ${mirrorX(right)} ${bottom - r}` +
          ` L ${mirrorX(right)} ${top + r + 42}` +
          ` C ${mirrorX(right)} ${top + 60} ${mirrorX(BOW_CENTER.x)} ${top + 60} ${mirrorX(BOW_CENTER.x)} ${top + 50}`,
      ]
    : [
        `M ${left} ${bottom - 168} L ${left} ${top + r}` +
          ` A ${r} ${r} 0 0 1 ${left + r} ${top}` +
          ` L ${right - r + 40} ${top}` +
          ` C ${right - 10} ${top} ${BOW_CENTER.x} ${top + 30} ${BOW_CENTER.x} ${top + 44}`,
        `M ${left + 96} ${bottom}` +
          ` L ${right - r + 30} ${bottom}` +
          ` A ${r} ${r} 0 0 0 ${right} ${bottom - r}` +
          ` L ${right} ${top + r + 42}` +
          ` C ${right} ${top + 60} ${BOW_CENTER.x} ${top + 60} ${BOW_CENTER.x} ${top + 50}`,
      ];

  const node = svg('svg', { class: 'ribbon-stage', viewBox: `0 0 ${DESIGN.width} ${DESIGN.height}`, 'aria-hidden': 'true' });
  node.append(buildDefs(palette));

  const art = svg('g', { class: 'ribbon-art' });
  if (mirrored) art.setAttribute('transform', `matrix(-1 0 0 1 ${DESIGN.width} 0)`);
  node.append(art);

  art.append(buildBox(palette));

  const strands = strandPaths.map((d) => {
    const group = svg('g', { class: 'ribbon-strand' });
    const dash = { pathLength: '1', 'stroke-dasharray': STRAND_DASH, 'stroke-dashoffset': '1' };
    const line = (attributes) => svg('path', { d, fill: 'none', 'stroke-linecap': 'round', ...dash, ...attributes });
    const contours = [
      line({ stroke: palette.shadow, 'stroke-width': '30', transform: 'translate(2 5)' }),
      line({ stroke: palette.wineDeep, 'stroke-width': '28' }),
      line({ stroke: `url(#ribbonSatin)`, 'stroke-width': '22' }),
      line({ stroke: palette.roseLight, 'stroke-width': '9', 'stroke-dasharray': '1 2', opacity: '0.75' }),
      line({ stroke: palette.cream, 'stroke-width': '3.4', opacity: '0.6' }),
    ];
    const sheen = line({ stroke: palette.cream, 'stroke-width': '18', 'stroke-dasharray': '0.13 1', 'stroke-dashoffset': '1.13', opacity: '0.5' });
    group.append(...contours, sheen);
    art.append(group);
    return { lines: contours, sheen };
  });

  art.append(buildBow(palette));
  art.append(buildClasps(palette, mirrored));

  return { node, palette, strands, box: art.querySelector('.ribbon-box'), lid: art.querySelector('.ribbon-lid'), bow: art.querySelector('.ribbon-bow'), boxCenter, bowCenter };
}

function buildDefs(palette) {
  const defs = svg('defs');
  defs.append(
    svg('linearGradient', { id: 'ribbonSatin', x1: '0.5', y1: '0', x2: '0.5', y2: '1' }, [
      svg('stop', { offset: '0', 'stop-color': palette.rose }),
      svg('stop', { offset: '0.34', 'stop-color': palette.roseLight }),
      svg('stop', { offset: '0.62', 'stop-color': palette.wine }),
      svg('stop', { offset: '1', 'stop-color': palette.wineDeep }),
    ]),
    svg('linearGradient', { id: 'ribbonGold', x1: '0', y1: '0', x2: '0', y2: '1' }, [
      svg('stop', { offset: '0', 'stop-color': '#F6DFAC' }),
      svg('stop', { offset: '0.5', 'stop-color': palette.gold }),
      svg('stop', { offset: '1', 'stop-color': palette.goldDeep }),
    ]),
    svg('linearGradient', { id: 'ribbonBoxFace', x1: '0', y1: '0', x2: '0', y2: '1' }, [
      svg('stop', { offset: '0', 'stop-color': '#BE3352' }),
      svg('stop', { offset: '1', 'stop-color': '#7C1E36' }),
    ]),
    svg('linearGradient', { id: 'ribbonBoxSide', x1: '0', y1: '0', x2: '1', y2: '0' }, [
      svg('stop', { offset: '0', 'stop-color': '#8E2540' }),
      svg('stop', { offset: '1', 'stop-color': '#5E1628' }),
    ]),
    svg('radialGradient', { id: 'ribbonKnot', cx: '0.36', cy: '0.3', r: '0.75' }, [
      svg('stop', { offset: '0', 'stop-color': '#FBEDC6' }),
      svg('stop', { offset: '0.55', 'stop-color': palette.gold }),
      svg('stop', { offset: '1', 'stop-color': palette.goldDeep }),
    ]),
    svg('filter', { id: 'ribbonSoft', x: '-25%', y: '-25%', width: '150%', height: '150%' }, [
      svg('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '7', result: 'blur' }),
      svg('feOffset', { in: 'blur', dx: '0', dy: '7', result: 'drop' }),
      svg('feComponentTransfer', { in: 'drop', result: 'faded' }, [
        svg('feFuncA', { type: 'linear', slope: '0.42' }),
      ]),
      svg('feMerge', {}, [svg('feMergeNode', { in: 'faded' }), svg('feMergeNode', { in: 'SourceGraphic' })]),
    ]),
  );
  return defs;
}

function buildBox(palette) {
  const group = svg('g', { filter: 'url(#ribbonSoft)' });
  const box = svg('g', { class: 'ribbon-box' });
  box.append(
    // 立体盒身：正面 + 右侧面 + 顶部受光面。
    svg('path', { d: 'M 150 806 L 320 806 L 320 942 L 150 942 Z', fill: 'url(#ribbonBoxFace)' }),
    svg('path', { d: 'M 320 806 L 356 776 L 356 912 L 320 942 Z', fill: 'url(#ribbonBoxSide)' }),
    svg('path', { d: 'M 150 806 L 186 776 L 356 776 L 320 806 Z', fill: '#D2546E' }),
    // 竖向缠绕的金色缎带，带高光与阴影。
    svg('path', { d: 'M 214 806 L 258 806 L 258 942 L 214 942 Z', fill: 'url(#ribbonGold)' }),
    svg('path', { d: 'M 224 806 L 232 806 L 232 942 L 224 942 Z', fill: palette.cream, opacity: '0.55' }),
    svg('path', { d: 'M 252 806 L 258 806 L 258 942 L 252 942 Z', fill: palette.goldDeep, opacity: '0.5' }),
  );
  const lid = svg('g', { class: 'ribbon-lid' });
  lid.append(
    svg('path', { d: 'M 138 776 L 174 748 L 372 748 L 336 776 Z', fill: '#EEC98A' }),
    svg('path', { d: 'M 336 776 L 372 748 L 372 772 L 336 800 Z', fill: palette.goldDeep }),
    svg('path', { d: 'M 138 776 L 336 776 L 336 800 L 138 800 Z', fill: 'url(#ribbonGold)' }),
    svg('path', { d: 'M 214 748 L 258 748 L 258 800 L 214 800 Z', fill: '#F7E4B8' }),
    svg('path', { d: 'M 224 748 L 232 748 L 232 800 L 224 800 Z', fill: palette.cream, opacity: '0.5' }),
  );
  group.append(box, lid);
  return group;
}

function buildBow(palette) {
  const group = svg('g', { class: 'ribbon-bow', filter: 'url(#ribbonSoft)' });
  const loop = (d, fill) => svg('path', { d, fill, stroke: palette.wineDeep, 'stroke-width': '2.5', 'stroke-linejoin': 'round' });
  group.append(
    // 左环：上缘高光 + 内折暗部，做出缎面翻折。
    loop(`M ${BOW_CENTER.x} ${BOW_CENTER.y} C ${BOW_CENTER.x - 86} ${BOW_CENTER.y - 96} ${BOW_CENTER.x - 186} ${BOW_CENTER.y - 74} ${BOW_CENTER.x - 190} ${BOW_CENTER.y - 8} C ${BOW_CENTER.x - 192} ${BOW_CENTER.y + 54} ${BOW_CENTER.x - 110} ${BOW_CENTER.y + 62} ${BOW_CENTER.x - 20} ${BOW_CENTER.y + 16} Z`, `url(#ribbonSatin)`),
    loop(`M ${BOW_CENTER.x - 20} ${BOW_CENTER.y + 14} C ${BOW_CENTER.x - 96} ${BOW_CENTER.y + 34} ${BOW_CENTER.x - 158} ${BOW_CENTER.y + 20} ${BOW_CENTER.x - 178} ${BOW_CENTER.y - 6} C ${BOW_CENTER.x - 150} ${BOW_CENTER.y + 6} ${BOW_CENTER.x - 80} ${BOW_CENTER.y + 4} ${BOW_CENTER.x - 26} ${BOW_CENTER.y - 18} Z`, palette.wineDeep),
    // 右环
    loop(`M ${BOW_CENTER.x} ${BOW_CENTER.y} C ${BOW_CENTER.x + 86} ${BOW_CENTER.y - 96} ${BOW_CENTER.x + 186} ${BOW_CENTER.y - 74} ${BOW_CENTER.x + 190} ${BOW_CENTER.y - 8} C ${BOW_CENTER.x + 192} ${BOW_CENTER.y + 54} ${BOW_CENTER.x + 110} ${BOW_CENTER.y + 62} ${BOW_CENTER.x + 20} ${BOW_CENTER.y + 16} Z`, `url(#ribbonSatin)`),
    loop(`M ${BOW_CENTER.x + 20} ${BOW_CENTER.y + 14} C ${BOW_CENTER.x + 96} ${BOW_CENTER.y + 34} ${BOW_CENTER.x + 158} ${BOW_CENTER.y + 20} ${BOW_CENTER.x + 178} ${BOW_CENTER.y - 6} C ${BOW_CENTER.x + 150} ${BOW_CENTER.y + 6} ${BOW_CENTER.x + 80} ${BOW_CENTER.y + 4} ${BOW_CENTER.x + 26} ${BOW_CENTER.y - 18} Z`, palette.wineDeep),
    // 两条飘带尾
    svg('path', { d: `M ${BOW_CENTER.x - 8} ${BOW_CENTER.y + 22} C ${BOW_CENTER.x - 34} ${BOW_CENTER.y + 110} ${BOW_CENTER.x - 66} ${BOW_CENTER.y + 168} ${BOW_CENTER.x - 104} ${BOW_CENTER.y + 214} L ${BOW_CENTER.x - 62} ${BOW_CENTER.y + 232} C ${BOW_CENTER.x - 36} ${BOW_CENTER.y + 170} ${BOW_CENTER.x - 6} ${BOW_CENTER.y + 110} ${BOW_CENTER.x + 8} ${BOW_CENTER.y + 26} Z`, fill: palette.rose, stroke: palette.wineDeep, 'stroke-width': '2.5' }),
    svg('path', { d: `M ${BOW_CENTER.x + 10} ${BOW_CENTER.y + 22} C ${BOW_CENTER.x + 40} ${BOW_CENTER.y + 112} ${BOW_CENTER.x + 74} ${BOW_CENTER.y + 170} ${BOW_CENTER.x + 116} ${BOW_CENTER.y + 212} L ${BOW_CENTER.x + 74} ${BOW_CENTER.y + 234} C ${BOW_CENTER.x + 40} ${BOW_CENTER.y + 172} ${BOW_CENTER.x + 8} ${BOW_CENTER.y + 112} ${BOW_CENTER.x - 6} ${BOW_CENTER.y + 26} Z`, fill: palette.wine, stroke: palette.wineDeep, 'stroke-width': '2.5' }),
    // 束腰与结心
    svg('ellipse', { cx: BOW_CENTER.x, cy: BOW_CENTER.y + 4, rx: '26', ry: '22', fill: palette.wineDeep }),
    svg('circle', { cx: BOW_CENTER.x, cy: BOW_CENTER.y + 2, r: '15', fill: 'url(#ribbonKnot)' }),
    svg('circle', { cx: BOW_CENTER.x - 4, cy: BOW_CENTER.y - 4, r: '4.5', fill: palette.cream, opacity: '0.85' }),
  );
  return group;
}

function buildClasps(palette, mirrored) {
  const group = svg('g', { class: 'ribbon-clasps' });
  for (const [x, y, rotate] of [
    [DESIGN.width / 2, FRAME_BOX.top, 45],
    [DESIGN.width / 2, FRAME_BOX.bottom, 45],
  ]) {
    group.append(
      svg('path', {
        d: `M ${x} ${y - 16} L ${x + 16} ${y} L ${x} ${y + 16} L ${x - 16} ${y} Z`,
        fill: 'url(#ribbonGold)', stroke: palette.goldDeep, 'stroke-width': '2', transform: `rotate(${rotate} ${x} ${y})`,
      }),
      svg('circle', { cx: x, cy: y, r: '4', fill: palette.cream, opacity: '0.9' }),
    );
  }
  if (mirrored) return group;
  return group;
}


function buildCaption(payload, side) {
  const mirrored = side === 'right';
  const node = document.createElement('div');
  node.className = 'ribbon-tag';

  const string = svg('svg', {
    class: 'ribbon-tag-string', viewBox: '0 0 120 120', 'aria-hidden': 'true',
    style: `left:${(mirrored ? TAG.left + TAG.width - 62 : TAG.left + 40)}px;top:${TAG.top - 118}px;`,
  });
  const line = svg('path', {
    d: mirrored ? 'M 108 0 C 112 46 66 74 22 108' : 'M 12 0 C 8 46 54 74 98 108',
    fill: 'none', stroke: '#B28A46', 'stroke-width': '3', pathLength: '1',
    'stroke-dasharray': '1 2', 'stroke-dashoffset': '1',
  });
  string.append(line);
  node.append(string);

  const card = document.createElement('div');
  card.className = 'ribbon-tag-card';
  card.style.left = `${TAG.left}px`;
  card.style.top = `${TAG.top}px`;
  card.style.width = `${TAG.width}px`;
  card.style.height = `${TAG.height}px`;
  if (mirrored) card.style.transformOrigin = 'right top';
  const viewer = document.createElement('div');
  viewer.className = 'ribbon-tag-viewer';
  const viewerLabel = document.createElement('span');
  viewerLabel.textContent = '感谢';
  const user = document.createElement('strong');
  user.className = 'ribbon-tag-user';
  user.textContent = payload.userName;
  viewer.append(viewerLabel, user);
  const giftRow = document.createElement('div');
  giftRow.className = 'ribbon-tag-gift';
  const giftLabel = document.createElement('span');
  giftLabel.textContent = '送出';
  const gift = document.createElement('strong');
  gift.className = 'ribbon-tag-name';
  gift.textContent = payload.giftName;
  const quantity = document.createElement('strong');
  quantity.className = 'ribbon-tag-num';
  quantity.textContent = `×${payload.num}`;
  giftRow.append(giftLabel, gift, quantity);
  card.append(viewer, giftRow);
  node.append(card);

  fitText(user, 30, 22);
  fitText(gift, 34, 25);
  return { node, string: line };
}

function fitText(node, size, minimum) {
  const row = node.parentElement;
  let current = size;
  row.style.fontSize = `${current}px`;
  while (current > minimum && node.scrollWidth > node.clientWidth) {
    current -= 1;
    row.style.fontSize = `${current}px`;
  }
}

function createSession() {
  const animations = [];
  const timers = new Set();
  let aborted = false;
  return {
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
    },
    cleanup() {
      animations.forEach((animation) => animation.cancel());
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    },
  };
}

function svg(tagName, attributes = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (children.length) node.append(...children);
  return node;
}
