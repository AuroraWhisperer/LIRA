const SVG = 'http://www.w3.org/2000/svg';
let sequence = 0;
export const componentEffectProfiles = new WeakMap();

// Layout uses the same transform as painting, including the outward effect footprint.
export function componentEffectBounds(node, width, height, content = { x: 0, y: 0, width, height }) {
  const parameters = componentEffectProfiles.get(node);
  if (!parameters) return content;
  const pad = Math.max(0, ...['shadow', 'outerGlow'].map(key => {
    const value = parameters[key];
    return value?.opacity ? Math.max(Math.abs(value.x || 0), Math.abs(value.y || 0)) + value.blur * 1.5 : 0;
  }), parameters.outline?.width || 0, parameters.bloom?.intensity ? parameters.bloom.radius * 1.5 : 0,
  parameters.textOutline?.width || 0);
  const transform = effectTransform(parameters.transform).replaceAll('50%', `${width / 2}px`);
  const css = transform.replace(`translate(${width / 2}px, ${width / 2}px)`, `translate(${width / 2}px, ${height / 2}px)`)
    .replace(`translate(-${width / 2}px, -${width / 2}px)`, `translate(-${width / 2}px, -${height / 2}px)`);
  const Matrix = node.ownerDocument.defaultView.DOMMatrix;
  const matrix = css ? new Matrix(css) : new Matrix();
  const left = content.x - pad, top = content.y - pad;
  const right = content.x + content.width + pad, bottom = content.y + content.height + pad;
  const points = [[left, top], [right, top], [left, bottom], [right, bottom]]
    .map(([x, y]) => matrix.transformPoint({ x, y })).map(point => ({ x: point.x / point.w, y: point.y / point.w }));
  const x = Math.min(...points.map(point => point.x));
  const y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
}

export function effectColor({ color, opacity = 100 }) {
  const values = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
  return `rgba(${values.join(', ')}, ${opacity / 100})`;
}

export function effectTransform(value) {
  if (!value || !['rotateX', 'rotateY', 'rotateZ', 'skewX', 'skewY'].some(key => value[key])) return '';
  return `translate(50%, 50%) perspective(1000px) rotateX(${value.rotateX || 0}deg) rotateY(${value.rotateY || 0}deg) rotateZ(${value.rotateZ || 0}deg) skew(${value.skewX || 0}deg, ${value.skewY || 0}deg) translate(-50%, -50%)`;
}

export function levelTable({ black, white, gamma, outputBlack, outputWhite }) {
  return Array.from({ length: 256 }, (_, index) => {
    const input = Math.max(0, Math.min(1, (index - black) / (white - black)));
    return Number(((outputBlack + (outputWhite - outputBlack) * input ** (1 / gamma)) / 255).toFixed(6));
  });
}

export function createEffectFilters(document) {
  let root;
  function node(tag, attributes = {}, parent = root) {
    const element = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    parent?.append(element);
    return element;
  }
  function clear() { root?.remove(); root = null; }
  return {
    build(parameters, { artwork = false } = {}) {
      const active = parameters.whiteBalance || parameters.levels || parameters.bloom
        || artwork && (parameters.shadow || parameters.outerGlow || parameters.outline);
      if (!active) return '';
      if (!root) {
        root = node('svg', { 'aria-hidden': 'true', width: 0, height: 0 });
        root.dataset.componentEffectFilters = '';
        Object.assign(root.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden' });
        document.body.append(root);
      }
      const id = `lira-component-effect-${++sequence}`;
      const filter = node('filter', { id, x: '-100%', y: '-100%', width: '300%', height: '300%', 'color-interpolation-filters': 'sRGB' });
      let input = 'SourceGraphic';
      const add = (tag, attributes) => node(tag, attributes, filter);
      if (parameters.whiteBalance) {
        const { temperature, tint } = parameters.whiteBalance;
        const red = 1 + temperature * .0025 + tint * .001;
        const green = 1 - tint * .0025;
        const blue = 1 - temperature * .0025 + tint * .001;
        add('feColorMatrix', { in: input, type: 'matrix', result: 'balanced',
          values: `${red} 0 0 0 0  0 ${green} 0 0 0  0 0 ${blue} 0 0  0 0 0 1 0` });
        input = 'balanced';
      }
      if (parameters.levels) {
        const transfer = add('feComponentTransfer', { in: input, result: 'levels' });
        const tableValues = levelTable(parameters.levels).join(' ');
        for (const channel of ['R', 'G', 'B']) node(`feFunc${channel}`, { type: 'table', tableValues }, transfer);
        input = 'levels';
      }
      if (parameters.bloom?.intensity > 0 && parameters.bloom.threshold < 100) {
        const { threshold, radius, intensity } = parameters.bloom;
        add('feColorMatrix', { in: input, type: 'matrix', result: 'luminance',
          values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  .2126 .7152 .0722 0 0' });
        const transfer = add('feComponentTransfer', { in: 'luminance', result: 'bright-mask' });
        node('feFuncA', { type: 'linear', slope: 100 / (100 - threshold), intercept: -threshold / (100 - threshold) }, transfer);
        add('feComposite', { in: input, in2: 'bright-mask', operator: 'in', result: 'bright' });
        add('feGaussianBlur', { in: 'bright', stdDeviation: radius / 2, result: 'bloom-blur' });
        const strength = add('feComponentTransfer', { in: 'bloom-blur', result: 'bloom' });
        node('feFuncA', { type: 'linear', slope: intensity / 100 }, strength);
        const merge = add('feMerge', { result: 'lit' });
        node('feMergeNode', { in: 'bloom' }, merge); node('feMergeNode', { in: input }, merge);
        input = 'lit';
      }
      const beneath = [];
      if (artwork) {
        for (const [key, value] of [['shadow', parameters.shadow], ['outerGlow', parameters.outerGlow]]) {
          if (!value?.opacity) continue;
          add('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: value.blur / 2, result: `${key}-blur` });
          add('feOffset', { in: `${key}-blur`, dx: value.x || 0, dy: value.y || 0, result: `${key}-offset` });
          add('feFlood', { 'flood-color': value.color, 'flood-opacity': value.opacity / 100, result: `${key}-color` });
          add('feComposite', { in: `${key}-color`, in2: `${key}-offset`, operator: 'in', result: key });
          beneath.push(key);
        }
        const outline = parameters.outline;
        if (outline?.width && outline.opacity) {
          add('feMorphology', { in: 'SourceAlpha', operator: 'dilate', radius: outline.width, result: 'outline-alpha' });
          add('feFlood', { 'flood-color': outline.color, 'flood-opacity': outline.opacity / 100, result: 'outline-color' });
          add('feComposite', { in: 'outline-color', in2: 'outline-alpha', operator: 'in', result: 'outline' });
          beneath.push('outline');
        }
      }
      const merge = add('feMerge');
      for (const source of [...beneath, input]) node('feMergeNode', { in: source }, merge);
      return `url("#${id}")`;
    },
    clear,
    dispose: clear,
  };
}
