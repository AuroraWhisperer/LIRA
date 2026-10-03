// 大航海感谢的矢量部件：船锚（舰长）、罗盘（提督）、船舵（总督）、徽章环和丝带。
// 只用 DOM API 生成 SVG；颜色全部来自 guard-thanks.css 的分档 CSS 变量。
const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgNode(tag, attributes = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  for (const child of children) node.append(child);
  return node;
}

function gradientStops(classes) {
  return classes.map(([offset, className]) => svgNode('stop', { offset, class: className }));
}

// userSpaceOnUse 让零宽/零高的直线描边也能使用渐变。
function metalGradient(id, x1, y1, x2, y2) {
  return svgNode(
    'linearGradient',
    { id, gradientUnits: 'userSpaceOnUse', x1, y1, x2, y2 },
    gradientStops([
      [0, 'gt-m1'],
      [0.3, 'gt-m2'],
      [0.52, 'gt-m3'],
      [0.72, 'gt-m2'],
      [1, 'gt-m1'],
    ]),
  );
}

function point(radius, degrees) {
  const radians = (degrees * Math.PI) / 180;
  return [radius * Math.sin(radians), -radius * Math.cos(radians)];
}

function pointsAttribute(points) {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

// 经过相邻中点的二次曲线，把车床式轮廓点连成光滑闭合路径。
function smoothClosedPath(points) {
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(points[points.length - 1], points[0]);
  let d = `M${start[0].toFixed(1)} ${start[1].toFixed(1)}`;
  points.forEach((current, index) => {
    const next = mid(current, points[(index + 1) % points.length]);
    d += ` Q${current[0].toFixed(1)} ${current[1].toFixed(1)} ${next[0].toFixed(1)} ${next[1].toFixed(1)}`;
  });
  return `${d}Z`;
}

function emblemSvg(uid, children) {
  return svgNode(
    'svg',
    { class: 'gt-emblem-svg', viewBox: '-280 -280 560 560', 'aria-hidden': 'true' },
    [svgNode('defs', {}, [metalGradient(`${uid}-emblem-metal`, -260, -260, 260, 260)]), ...children],
  );
}

function buildAnchor(uid) {
  const metal = `url(#${uid}-emblem-metal)`;
  const shank = 'M0 -200 L0 206';
  const stock = 'M-146 -170 L146 -170';
  const arms = 'M-196 70 A205 205 0 0 0 196 70';
  const flukes = [-1, 1].map((side) => {
    const tip = [196 * side, 70];
    const normal = [0.956 * side, 0.293];
    const along = [0.293 * side, -0.956];
    const at = (n, u) => [tip[0] + normal[0] * n + along[0] * u, tip[1] + normal[1] * n + along[1] * u];
    return pointsAttribute([at(0, 54), at(30, -14), at(9, -6), at(0, -16), at(-9, -6), at(-30, -14)]);
  });
  const strokes = [
    [shank, 22],
    [stock, 18],
    [arms, 24],
  ];
  return emblemSvg(uid, [
    svgNode('g', { class: 'gt-outline' }, [
      ...strokes.map(([d, width]) => svgNode('path', { d, 'stroke-width': width + 7, 'stroke-linecap': 'round' })),
      svgNode('circle', { cx: 0, cy: -226, r: 24, 'stroke-width': 17 }),
      ...flukes.map((points) => svgNode('polygon', { points, 'stroke-width': 7, 'stroke-linejoin': 'round' })),
      ...[-1, 1].map((side) =>
        svgNode('circle', { class: 'gt-ball', cx: 160 * side, cy: -170, r: 15, 'stroke-width': 7 }),
      ),
    ]),
    svgNode('g', { fill: 'none', stroke: metal, 'stroke-linecap': 'round' }, [
      ...strokes.map(([d, width]) => svgNode('path', { d, 'stroke-width': width })),
      svgNode('circle', { cx: 0, cy: -226, r: 24, 'stroke-width': 10 }),
    ]),
    svgNode('g', { fill: metal }, [
      ...flukes.map((points) => svgNode('polygon', { points })),
      ...[-1, 1].map((side) => svgNode('circle', { cx: 160 * side, cy: -170, r: 15 })),
    ]),
    svgNode('g', { class: 'gt-ridge' }, strokes.map(([d]) => svgNode('path', { d, 'stroke-width': 3 }))),
  ]);
}

function compassPoint(degrees, tipRadius, halfWidth, baseRadius, lightClass, darkClass) {
  const tip = point(tipRadius, degrees);
  const base = point(baseRadius, degrees);
  const [px, py] = point(halfWidth, degrees + 90);
  const left = [base[0] - px, base[1] - py];
  const right = [base[0] + px, base[1] + py];
  return [
    svgNode('polygon', { class: lightClass, points: pointsAttribute([[0, 0], tip, left]) }),
    svgNode('polygon', { class: darkClass, points: pointsAttribute([[0, 0], tip, right]) }),
  ];
}

function buildCompass(uid) {
  const metal = `url(#${uid}-emblem-metal)`;
  let ticks = '';
  for (let degrees = 0; degrees < 360; degrees += 5) {
    const major = degrees % 45 === 0;
    const [x1, y1] = point(major ? 155 : 161, degrees);
    const [x2, y2] = point(major ? 182 : 172, degrees);
    ticks += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  const ordinal = [45, 135, 225, 315].flatMap((degrees) =>
    compassPoint(degrees, 214, 24, 84, 'gt-fill-light', 'gt-fill-deep'),
  );
  const cardinal = [0, 90, 180, 270].flatMap((degrees) =>
    compassPoint(degrees, 264, 32, 96, 'gt-fill-metal', 'gt-fill-main'),
  );
  cardinal.filter((_, index) => index % 2 === 0).forEach((node) => node.setAttribute('fill', metal));
  return emblemSvg(uid, [
    svgNode('circle', { class: 'gt-band', r: 168, 'stroke-width': 36 }),
    svgNode('path', { class: 'gt-ticks', d: ticks }),
    svgNode('circle', { r: 187, fill: 'none', stroke: metal, 'stroke-width': 4 }),
    svgNode('circle', { r: 152, fill: 'none', stroke: metal, 'stroke-width': 3 }),
    svgNode('g', { class: 'gt-points' }, [...ordinal, ...cardinal]),
  ]);
}

function buildHelm(uid) {
  const metal = `url(#${uid}-emblem-metal)`;
  const profile = [
    [196, 8],
    [204, 10.5],
    [213, 13],
    [221, 9],
    [228, 8.5],
    [236, 12.5],
    [246, 15],
    [254, 11],
    [260, 0],
  ];
  const handle = smoothClosedPath([
    ...profile.map(([radius, width]) => [-width, -radius]),
    ...profile
      .slice(0, -1)
      .reverse()
      .map(([radius, width]) => [width, -radius]),
  ]);
  const spokes = Array.from({ length: 8 }, (_, index) =>
    svgNode('g', { transform: `rotate(${index * 45})` }, [
      svgNode('rect', { x: -8, y: -204, width: 16, height: 70, rx: 3 }),
      svgNode('path', { d: handle }),
    ]),
  );
  const studs = Array.from({ length: 8 }, (_, index) => {
    const [cx, cy] = point(174, index * 45 + 22.5);
    return svgNode('circle', { class: 'gt-stud', cx: cx.toFixed(1), cy: cy.toFixed(1), r: 5.5 });
  });
  return emblemSvg(uid, [
    svgNode('g', { class: 'gt-spokes', fill: metal }, spokes),
    svgNode('circle', { r: 174, fill: 'none', stroke: metal, 'stroke-width': 24 }),
    svgNode('circle', { class: 'gt-inlay', r: 174, 'stroke-width': 7 }),
    svgNode('circle', { class: 'gt-edge', r: 161.5, 'stroke-width': 2.5 }),
    svgNode('circle', { class: 'gt-edge', r: 186.5, 'stroke-width': 2.5 }),
    ...studs,
  ]);
}

const EMBLEMS = { anchor: buildAnchor, compass: buildCompass, helm: buildHelm };

export function buildEmblem(kind, uid) {
  return EMBLEMS[kind](uid);
}

function ringDecorations(kind) {
  if (kind === 'anchor') {
    return Array.from({ length: 12 }, (_, index) => {
      const [cx, cy] = point(139, index * 30 + 15);
      return svgNode('circle', { class: 'gt-rivet', cx: cx.toFixed(1), cy: cy.toFixed(1), r: 3.4 });
    });
  }
  if (kind === 'compass') {
    return [0, 90, 180, 270].map((degrees) => {
      const [cx, cy] = point(139, degrees);
      return svgNode('rect', {
        class: 'gt-gem',
        x: (cx - 6).toFixed(1),
        y: (cy - 6).toFixed(1),
        width: 12,
        height: 12,
        transform: `rotate(45 ${cx.toFixed(1)} ${cy.toFixed(1)})`,
      });
    });
  }
  return Array.from({ length: 8 }, (_, index) => {
    const [cx, cy] = point(139, index * 45);
    return svgNode('circle', { class: 'gt-jewel', cx: cx.toFixed(1), cy: cy.toFixed(1), r: 5.5 });
  });
}

export function buildMedallionRing(kind, uid) {
  return svgNode('svg', { class: 'gt-ring', viewBox: '-150 -150 300 300', 'aria-hidden': 'true' }, [
    svgNode('defs', {}, [metalGradient(`${uid}-ring-metal`, -150, -150, 150, 150)]),
    svgNode('circle', { class: 'gt-ring-back', r: 145, 'stroke-width': 12 }),
    svgNode('circle', {
      class: 'gt-ring-metal',
      r: 139,
      fill: 'none',
      stroke: `url(#${uid}-ring-metal)`,
      'stroke-width': 16,
      pathLength: 1000,
      'stroke-dasharray': 1000,
      transform: 'rotate(-90)',
    }),
    svgNode('circle', { class: 'gt-ring-tier', r: 127.5, 'stroke-width': 7 }),
    svgNode('circle', { class: 'gt-ring-inner', r: 123.5, 'stroke-width': 1.5 }),
    svgNode('g', { class: 'gt-ring-deco' }, ringDecorations(kind)),
  ]);
}

export function buildGlint() {
  return svgNode('svg', { class: 'gt-glint', viewBox: '-150 -150 300 300', 'aria-hidden': 'true' }, [
    svgNode('circle', {
      r: 139,
      fill: 'none',
      pathLength: 1000,
      'stroke-dasharray': '64 936',
      'stroke-linecap': 'round',
      'stroke-width': 6,
      transform: 'rotate(-90)',
    }),
  ]);
}

function fourPointStar(cx, cy, size) {
  const inner = size * 0.32;
  return pointsAttribute([
    [cx, cy - size],
    [cx + inner, cy - inner],
    [cx + size, cy],
    [cx + inner, cy + inner],
    [cx, cy + size],
    [cx - inner, cy + inner],
    [cx - size, cy],
    [cx - inner, cy - inner],
  ]);
}

export function buildRibbon(uid) {
  const panel = `${uid}-ribbon-panel`;
  const tail = `${uid}-ribbon-tail`;
  const metal = `${uid}-ribbon-metal`;
  return svgNode('svg', { class: 'gt-ribbon-svg', viewBox: '0 0 680 124', 'aria-hidden': 'true' }, [
    svgNode('defs', {}, [
      svgNode(
        'linearGradient',
        { id: panel, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 18, x2: 0, y2: 100 },
        gradientStops([
          [0, 'gt-r1'],
          [0.48, 'gt-r2'],
          [1, 'gt-r3'],
        ]),
      ),
      svgNode(
        'linearGradient',
        { id: tail, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 40, x2: 0, y2: 118 },
        gradientStops([
          [0, 'gt-r2'],
          [1, 'gt-r3'],
        ]),
      ),
      metalGradient(metal, 64, 0, 616, 120),
    ]),
    svgNode('g', { class: 'gt-ribbon-tails', fill: `url(#${tail})` }, [
      svgNode('polygon', { points: '0,40 108,40 108,118 0,118 30,79' }),
      svgNode('polygon', { points: '680,40 572,40 572,118 680,118 650,79' }),
    ]),
    svgNode('g', { class: 'gt-ribbon-folds' }, [
      svgNode('polygon', { points: '64,100 108,118 108,100' }),
      svgNode('polygon', { points: '616,100 572,118 572,100' }),
    ]),
    svgNode('rect', { x: 64, y: 18, width: 552, height: 82, fill: `url(#${panel})` }),
    svgNode('path', { class: 'gt-ribbon-gloss', d: 'M70 25H610' }),
    svgNode('path', { class: 'gt-ribbon-shade', d: 'M70 93H610' }),
    svgNode('rect', {
      x: 64,
      y: 18,
      width: 552,
      height: 82,
      fill: 'none',
      stroke: `url(#${metal})`,
      'stroke-width': 3.5,
    }),
    svgNode('g', { class: 'gt-ribbon-stars' }, [
      svgNode('polygon', { points: fourPointStar(100, 59, 10) }),
      svgNode('polygon', { points: fourPointStar(580, 59, 10) }),
    ]),
  ]);
}
