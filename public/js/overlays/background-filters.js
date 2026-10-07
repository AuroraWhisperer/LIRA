import { BACKGROUND_FIELDS, getBackgroundAppearance } from '../shared/background-appearance.js';
import { levelTable } from './component-effect-filters.js';
import { whiteBalanceMatrix, liftGammaGainParameters } from './background-color-science.js';

const SVG = 'http://www.w3.org/2000/svg';
const effectKeys = Object.keys(BACKGROUND_FIELDS).filter(key => !['basic', 'color', 'playback', undefined].includes(BACKGROUND_FIELDS[key].group));
let sequence = 0;

// One filter for the existing image/video. Processing opaque RGB then restoring
// SourceAlpha avoids painting letterboxes or multiplying translucent edges twice.
export function createBackgroundFilters(document) {
  let root;
  let signature;
  let reference = '';
  const view = document.defaultView;
  const id = `lira-background-filter-${++sequence}`;
  const node = (tag, attributes, parent) => {
    const element = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    parent?.append(element);
    return element;
  };
  function clear() {
    root?.remove(); root = null; reference = ''; signature = undefined;
  }
  function build(config) {
    const p = getBackgroundAppearance(config);
    const standard = p.colorProcessing === 'standard';
    const grading = standard ? ['Red', 'Green', 'Blue'].some(channel => p[`lift${channel}`] || p[`gamma${channel}`] !== 1 || p[`gain${channel}`] !== 1)
      : p.shadowStrength || p.midtoneStrength || p.highlightStrength;
    const active = p.temperature || p.tint || grading
      || p.glowStrength || p.irisBlur || p.vignetteOpacity || p.grainStrength
      || p.inputBlack || p.inputWhite !== 255 || p.gamma !== 1 || p.outputBlack || p.outputWhite !== 255;
    if (!active) { clear(); return ''; }
    const width = document.documentElement.clientWidth || 1920;
    const height = document.documentElement.clientHeight || 1080;
    const next = JSON.stringify([...effectKeys.map(key => p[key]), width, height]);
    if (next === signature) return reference;
    if (!root) {
      root = node('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
      root.dataset.backgroundFilters = '';
      Object.assign(root.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden' });
      document.body.append(root);
    }
    const filter = node('filter', { id, x: '0%', y: '0%', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' });
    const add = (tag, attrs) => node(tag, attrs, filter);
    const transfer = add('feComponentTransfer', { in: 'SourceGraphic', result: 'opaque' });
    node('feFuncA', { type: 'linear', slope: 0, intercept: 1 }, transfer);
    let input = 'opaque';

    if (standard && (p.temperature || p.tint)) {
      const matrix = whiteBalanceMatrix(p.temperature, p.tint);
      const values = [0, 1, 2].flatMap(row => [...matrix.slice(row * 3, row * 3 + 3), 0, 0]);
      add('feColorMatrix', { in: input, type: 'matrix', values: [...values, 0, 0, 0, 1, 0].join(' '),
        'color-interpolation-filters': 'linearRGB', result: 'balanced' });
      input = 'balanced';
    } else if (!standard && (p.temperature || p.tint)) {
      const gains = [1 + p.temperature * .0025 + p.tint * .001, 1 - p.tint * .0025, 1 - p.temperature * .0025 + p.tint * .001];
      const weights = [.2126, .7152, .0722];
      const matrix = gains.flatMap((gain, row) => [...gains.map((value, column) =>
        (row === column ? gain : 0) + (p.preserveLuminance ? weights[column] * (1 - value) : 0)), 0, 0]);
      add('feColorMatrix', { in: input, type: 'matrix', values: [...matrix, 0, 0, 0, 1, 0].join(' '), result: 'balanced' });
      input = 'balanced';
    }
    if (standard && grading) {
      const linear = add('feComponentTransfer', { in: input, 'color-interpolation-filters': 'linearRGB', result: 'lgg-linear' });
      const power = add('feComponentTransfer', { in: 'lgg-linear', 'color-interpolation-filters': 'linearRGB', result: 'graded' });
      for (const channel of ['Red', 'Green', 'Blue']) {
        const { slope, intercept, exponent } = liftGammaGainParameters(p[`lift${channel}`], p[`gamma${channel}`], p[`gain${channel}`]);
        node(`feFunc${channel[0]}`, { type: 'linear', slope, intercept }, linear);
        node(`feFunc${channel[0]}`, { type: 'gamma', amplitude: 1, exponent, offset: 0 }, power);
      }
      input = 'graded';
    } else if (!standard && grading) {
      add('feColorMatrix', { in: input, type: 'matrix', result: 'tone-luminance',
        values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .2126 .7152 .0722 0 0' });
      for (const tone of ['shadow', 'midtone', 'highlight']) {
        if (!p[`${tone}Strength`]) continue;
        const mask = add('feComponentTransfer', { in: 'tone-luminance', result: `${tone}-mask` });
        const tableValues = Array.from({ length: 256 }, (_, i) => {
          const l = i / 255;
          const weight = tone === 'shadow' ? (1 - l) ** 2 : tone === 'highlight' ? l ** 2 : 4 * l * (1 - l);
          return (weight * p[`${tone}Strength`]).toFixed(6);
        }).join(' ');
        node('feFuncA', { type: 'table', tableValues }, mask);
        const [r, g, b] = [1, 3, 5].map(start => parseInt(p[`${tone}Color`].slice(start, start + 2), 16) / 255);
        add('feColorMatrix', { in: input, type: 'matrix', result: `${tone}-color`,
          values: `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0` });
        add('feComposite', { in: `${tone}-color`, in2: `${tone}-mask`, operator: 'in', result: `${tone}-tint` });
        add('feComposite', { in: `${tone}-tint`, in2: input, operator: 'over', result: tone });
        input = tone;
      }
    }
    if (p.inputBlack || p.inputWhite !== 255 || p.gamma !== 1 || p.outputBlack || p.outputWhite !== 255) {
      const levels = add('feComponentTransfer', { in: input, result: 'levels' });
      const tableValues = levelTable({ black: p.inputBlack, white: p.inputWhite, gamma: p.gamma, outputBlack: p.outputBlack, outputWhite: p.outputWhite }).join(' ');
      for (const channel of p.levelsChannel === 'rgb' ? ['R', 'G', 'B'] : [p.levelsChannel.toUpperCase()]) {
        node(`feFunc${channel}`, { type: 'table', tableValues }, levels);
      }
      input = 'levels';
    }
    if (p.glowStrength) {
      add('feColorMatrix', { in: input, type: 'matrix', result: 'glow-luminance',
        values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .2126 .7152 .0722 0 0' });
      const mask = add('feComponentTransfer', { in: 'glow-luminance', result: 'glow-mask' });
      const tableValues = Array.from({ length: 256 }, (_, i) => {
        const l = i / 255;
        if (!p.glowSoftness) return l > p.glowThreshold ? 1 : 0;
        const t = Math.max(0, Math.min(1, (l - p.glowThreshold) / p.glowSoftness));
        return (t * t * (3 - 2 * t)).toFixed(6);
      }).join(' ');
      node('feFuncA', { type: 'table', tableValues }, mask);
      add('feComposite', { in: input, in2: 'glow-mask', operator: 'in', result: 'bright' });
      const radius = p.glowRadius / 2;
      add('feGaussianBlur', { in: 'bright', stdDeviation: p.glowMode === 'normal' ? radius : `${radius} ${radius / 8}`, result: 'glow-blur' });
      if (p.glowMode === 'star') {
        add('feGaussianBlur', { in: 'bright', stdDeviation: `${radius / 8} ${radius}`, result: 'glow-vertical' });
        add('feComposite', { in: 'glow-blur', in2: 'glow-vertical', operator: 'arithmetic', k2: .5, k3: .5, result: 'glow-blur' });
      }
      const strength = add('feComponentTransfer', { in: 'glow-blur', result: 'glow' });
      node('feFuncA', { type: 'linear', slope: p.glowStrength }, strength);
      add('feBlend', { in: input, in2: 'glow', mode: 'screen', result: 'lit' });
      input = 'lit';
    }
    function radialMask(prefix, roundness = 0) {
      const range = p[`${prefix}Range`];
      const end = Math.min(1, range + p[`${prefix}Softness`]);
      const x = p[`${prefix}CenterX`], y = p[`${prefix}CenterY`];
      const sx = 1 + (Math.min(width, height) / width - 1) * roundness;
      const sy = 1 + (Math.min(width, height) / height - 1) * roundness;
      const svg = `<svg xmlns="${SVG}" viewBox="0 0 1 1" preserveAspectRatio="none"><defs><radialGradient id="m" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="0.707107" gradientTransform="translate(${x} ${y}) scale(${sx} ${sy})"><stop offset="${range}" stop-color="white" stop-opacity="0"/><stop offset="${end}" stop-color="white"/></radialGradient></defs><rect width="1" height="1" fill="url(#m)"/></svg>`;
      add('feImage', { href: `data:image/svg+xml,${encodeURIComponent(svg)}`, x: 0, y: 0, width: '100%', height: '100%', preserveAspectRatio: 'none', result: `${prefix}-mask` });
    }
    if (p.irisBlur) {
      radialMask('iris');
      add('feGaussianBlur', { in: input, stdDeviation: p.irisBlur / 2, edgeMode: 'duplicate', result: 'iris-blurred' });
      add('feComposite', { in: 'iris-blurred', in2: 'iris-mask', operator: 'in', result: 'iris-edge' });
      add('feComposite', { in: input, in2: 'iris-mask', operator: 'out', result: 'iris-center' });
      add('feComposite', { in: 'iris-edge', in2: 'iris-center', operator: 'arithmetic', k2: 1, k3: 1, result: 'iris' });
      input = 'iris';
    }
    if (p.vignetteOpacity) {
      radialMask('vignette', p.vignetteRoundness);
      add('feFlood', { 'flood-color': p.vignetteColor, 'flood-opacity': p.vignetteOpacity, result: 'vignette-color' });
      add('feComposite', { in: 'vignette-color', in2: 'vignette-mask', operator: 'in', result: 'vignette-edge' });
      add('feComposite', { in: 'vignette-edge', in2: input, operator: 'over', result: 'vignette' });
      input = 'vignette';
    }
    if (p.grainStrength) {
      add('feTurbulence', { type: 'fractalNoise', baseFrequency: 1 / p.grainSize, numOctaves: 1, seed: 7, stitchTiles: 'stitch', result: 'noise' });
      add('feColorMatrix', { in: 'noise', type: 'saturate', values: 0, result: 'gray-noise' });
      const noise = add('feComponentTransfer', { in: 'gray-noise', result: 'grain' });
      for (const channel of ['R', 'G', 'B']) node(`feFunc${channel}`, { type: 'linear', slope: p.grainStrength, intercept: (1 - p.grainStrength) / 2 }, noise);
      node('feFuncA', { type: 'linear', slope: 0, intercept: 1 }, noise);
      add('feBlend', { in: 'grain', in2: input, mode: 'soft-light', result: 'textured' });
      input = 'textured';
    }
    const alpha = add('feComponentTransfer', { in: input, result: 'final-rgb' });
    node('feFuncA', { type: 'linear', slope: 0, intercept: 1 }, alpha);
    add('feComposite', { in: 'final-rgb', in2: 'SourceAlpha', operator: 'in' });
    root.replaceChildren(filter);
    signature = next;
    reference = `url("#${id}")`;
    return reference;
  }
  let current;
  function resize() { if (current) build(current); }
  view.addEventListener('resize', resize);
  return {
    build(config) { current = config; return build(config); },
    dispose() { current = null; clear(); view.removeEventListener('resize', resize); },
  };
}
