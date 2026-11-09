const SVG_NS = 'http://www.w3.org/2000/svg';

// These small filled marks belong to the schedule artwork, rather than the admin controls.
const ICON_SHAPES = {
  heart: [['path', { d: 'M12 21 3.2 12.4C-2.6 6.5 5.5-1.4 12 5.1c6.5-6.5 14.6 1.4 8.8 7.3Z' }]],
  star: [['path', { d: 'm12 1 3.3 6.8 7.5 1.1-5.4 5.3 1.3 7.5L12 18.2l-6.7 3.5 1.3-7.5-5.4-5.3 7.5-1.1Z' }]],
  paw: [
    ['ellipse', { cx: 6, cy: 7, rx: 2.7, ry: 3.6, transform: 'rotate(-22 6 7)' }],
    ['ellipse', { cx: 12, cy: 4.7, rx: 2.6, ry: 3.6 }],
    ['ellipse', { cx: 18.1, cy: 7, rx: 2.7, ry: 3.6, transform: 'rotate(22 18 7)' }],
    ['path', { d: 'M4 16c0-3.5 4.7-8 8-8s8 4.5 8 8c0 7-6 4-8 4s-8 3-8-4Z' }],
  ],
  flower: [
    ['path', { d: 'M12 3c5-6 9 1 5.6 5.1 8-.8 8 7.8.7 8.3 4 6.5-3 10-6.3 3.9-3.3 6.1-10.3 2.6-6.3-3.9-7.3-.5-7.3-9.1.7-8.3C3-2 9-3 12 3Z' }],
    ['circle', { cx: 12, cy: 12, r: 3, fill: 'var(--wsa-paper)' }],
  ],
  bow: [
    ['path', { d: 'M10 8C-4-3-4 19 10 13l-4 9 5-2 1-7h1l1 7 5 2-4-9C29 19 29-3 15 8Z' }],
    ['ellipse', { cx: 12.5, cy: 10.5, rx: 3, ry: 4 }],
  ],
  bell: [
    ['path', { d: 'M3 18c4-4 1-10 6-13V3a3 3 0 0 1 6 0v2c5 3 2 9 6 13H3Z' }],
    ['path', { d: 'M8 20h8a4 4 0 0 1-8 0Z' }],
  ],
  moon: [['path', { d: 'M20.8 14.5A10.2 10.2 0 0 1 9.5 3.2 10 10 0 1 0 20.8 14.5Z' }]],
  cloud: [['path', { d: 'M5 19a5 5 0 0 1-1-9.9A7 7 0 0 1 17.5 7 6 6 0 1 1 18 19Z' }]],
  cat: [
    ['path', { d: 'm3 2 6 4a12 12 0 0 1 6 0l6-4v12c0 11-18 11-18 0Z' }],
    ['path', { d: 'm8 13 1 1m6-1-1 1m-4 4h4', fill: 'none', stroke: 'var(--wsa-paper)', 'stroke-width': 1.8, 'stroke-linecap': 'round' }],
  ],
  rabbit: [
    ['ellipse', { cx: 8, cy: 6, rx: 3, ry: 6, transform: 'rotate(-12 8 6)' }],
    ['ellipse', { cx: 16, cy: 6, rx: 3, ry: 6, transform: 'rotate(12 16 6)' }],
    ['ellipse', { cx: 12, cy: 16, rx: 9, ry: 8 }],
    ['path', { d: 'M8 16h.1m7.8 0h.1m-5 3h2', fill: 'none', stroke: 'var(--wsa-paper)', 'stroke-width': 2, 'stroke-linecap': 'round' }],
  ],
  talisman: [
    ['path', { d: 'M5 1h14v22H5Z' }],
    ['path', { d: 'm9 5 6 3-6 4 6 3-6 4m3-16v18', fill: 'none', stroke: 'var(--wsa-paper)', 'stroke-width': 1.5 }],
  ],
};

export function createWeeklyScheduleIcon(documentRef, iconId) {
  const svg = documentRef.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('wsa-symbol');
  for (const [tag, attributes] of ICON_SHAPES[iconId] || ICON_SHAPES.heart) {
    const shape = documentRef.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, String(value));
    svg.append(shape);
  }
  return svg;
}
