// Display-only contract, mirrored by the server. No DOM or runtime dependencies.
const number = (label, value, min, max, step = 1, unit = '') => ({ label, default: value, min, max, step, unit });
const color = (value) => ({ label: '颜色', default: value, type: 'color' });
const opacity = () => number('不透明度', 35, 0, 100, 1, '%');

export const STYLE_PARAMETER_GROUPS = Object.freeze({
  shadow: { label: '外投影', fields: { color: color('#000000'), opacity: opacity(),
    x: number('水平偏移', 0, -100, 100, 1, 'px'), y: number('垂直偏移', 4, -100, 100, 1, 'px'),
    blur: number('模糊', 8, 0, 80, 1, 'px') } },
  innerShadow: { label: '内阴影', fields: { color: color('#000000'), opacity: opacity(),
    x: number('水平偏移', 0, -30, 30, 1, 'px'), y: number('垂直偏移', 2, -30, 30, 1, 'px'),
    blur: number('模糊', 6, 0, 40, 1, 'px') } },
  outerGlow: { label: '外发光', fields: { color: color('#ffffff'), opacity: opacity(),
    blur: number('半径', 12, 0, 80, 1, 'px') } },
  innerGlow: { label: '内发光', fields: { color: color('#ffffff'), opacity: opacity(),
    blur: number('半径', 6, 0, 40, 1, 'px') } },
  outline: { label: '轮廓', fields: { color: color('#ffffff'), opacity: number('不透明度', 100, 0, 100, 1, '%'),
    width: number('宽度', 2, 0, 16, 0.5, 'px') } },
  textOutline: { label: '文字描边', fields: { color: color('#000000'), opacity: number('不透明度', 90, 0, 100, 1, '%'),
    width: number('宽度', 1, 0, 8, 0.5, 'px') } },
  whiteBalance: { label: '白平衡', advanced: true, fields: {
    temperature: number('色温（冷 → 暖）', 0, -100, 100), tint: number('色调（绿 → 洋红）', 0, -100, 100) } },
  bloom: { label: '亮部辉光', advanced: true, fields: { intensity: number('强度', 30, 0, 100, 1, '%'),
    radius: number('半径', 12, 0, 80, 1, 'px'), threshold: number('亮度阈值', 75, 0, 100, 1, '%') } },
  levels: { label: '色阶', advanced: true, fields: {
    black: number('输入黑场', 0, 0, 254), white: number('输入白场', 255, 1, 255),
    gamma: number('中间调', 1, 0.1, 3, 0.05), outputBlack: number('输出黑场', 0, 0, 254),
    outputWhite: number('输出白场', 255, 1, 255) } },
  transform: { label: '旋转与倾斜', advanced: true, fields: {
    rotateX: number('X 轴旋转', 0, -80, 80, 1, '°'), rotateY: number('Y 轴旋转', 0, -80, 80, 1, '°'),
    rotateZ: number('Z 轴旋转', 0, -180, 180, 1, '°'), skewX: number('X 轴倾斜', 0, -45, 45, 1, '°'),
    skewY: number('Y 轴倾斜', 0, -45, 45, 1, '°') } },
});

// Surface kinds describe editable artwork, not whether its background can be made transparent.
export const STYLE_PARAMETER_CAPABILITIES = Object.freeze({
  clock: {
    peach: 'panel', starlight: 'panel', soda: 'panel', 'timeline-horizontal': 'text',
    'timeline-vertical': 'text', digital: 'text', orbit: 'art', flip: 'panel', 'moonlit-fan': 'moon',
  },
  danmaku: {
    bubble: 'panel', signal: 'panel', minimal: 'art', ranked: 'panel', transparent: 'text',
    identity: 'panel', sketch: 'panel', starlight: 'art', moonlit: 'art', outline: 'panel', whiteframe: 'frame',
    cream: 'panel', glow: 'panel', starveil: 'panel', floating: 'panel', comet: 'art',
  },
});
const IMPORTED_STYLE = /^(css|media|resource|web):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const invalid = () => { throw Object.assign(new Error('样式参数无效，请检查数值范围。'),
  { code: 'INVALID_STYLE_PARAMETERS', statusCode: 400 }); };

export function styleParameterDefaults(group) {
  return Object.fromEntries(Object.entries(STYLE_PARAMETER_GROUPS[group].fields).map(([key, field]) => [key, field.default]));
}

export function normalizeStyleParameters(type, value) {
  if (!['clock', 'danmaku', 'browser'].includes(type) || !object(value) || Object.keys(value).length > 64) return invalid();
  const result = {};
  for (const [style, groups] of Object.entries(value)) {
    if (!(Object.hasOwn(STYLE_PARAMETER_CAPABILITIES[type] || {}, style) || IMPORTED_STYLE.test(style)
      || type === 'browser' && style === 'browser') || !object(groups)) return invalid();
    const normalized = {};
    for (const [group, settings] of Object.entries(groups)) {
      if (group === 'showEntryMessages' && type === 'danmaku' && typeof settings === 'boolean') {
        normalized[group] = settings;
        continue;
      }
      if (!Object.hasOwn(STYLE_PARAMETER_GROUPS, group) || !object(settings)
        || Object.hasOwn(STYLE_PARAMETER_CAPABILITIES[type] || {}, style)
          && !styleParameterCapabilities(type, { style }).includes(group)
        || type === 'browser' && !styleParameterCapabilities(type).includes(group)) return invalid();
      const fields = STYLE_PARAMETER_GROUPS[group].fields;
      const values = styleParameterDefaults(group);
      for (const [key, input] of Object.entries(settings)) {
        if (!Object.hasOwn(fields, key)) return invalid();
        const field = fields[key];
        if (field.type === 'color') {
          if (typeof input !== 'string' || !/^#[\da-f]{6}$/i.test(input)) return invalid();
          values[key] = input.toLowerCase();
        } else {
          if (typeof input !== 'number' || !Number.isFinite(input) || input < field.min || input > field.max
            || field.step === 1 && !Number.isInteger(input)) return invalid();
          values[key] = input;
        }
      }
      if (group === 'levels' && (values.black >= values.white || values.outputBlack >= values.outputWhite)) return invalid();
      normalized[group] = values;
    }
    result[style] = normalized;
  }
  return result;
}

export function componentStyleKey(config = {}) {
  for (const [field, prefix] of [['cssStyle', 'css'], ['resourceStyle', 'resource'], ['mediaStyle', 'media']]) {
    if (config[field]?.id) return `${prefix}:${config[field].id}`;
  }
  const web = /^\/component-web\/([a-f0-9-]{36})\//.exec(config.url || '');
  return web ? `web:${web[1]}` : config.style || 'browser';
}

export function styleParametersFor(config = {}) {
  return config.styleParameters?.[componentStyleKey(config)] || {};
}

export function styleParameterCapabilities(type, config = {}) {
  const external = type === 'browser';
  const engine = config.cssStyle?.engine;
  const surface = external ? 'external' : config.mediaStyle ? 'art'
    : engine === 'blc' || engine === 'blivechat' ? 'panel'
      : STYLE_PARAMETER_CAPABILITIES[type]?.[config.style] || 'art';
  return Object.keys(STYLE_PARAMETER_GROUPS).filter(group => {
    if (external) return ['shadow', 'outerGlow', 'outline', 'transform'].includes(group);
    if (['innerShadow', 'innerGlow'].includes(group)) return ['panel', 'moon'].includes(surface);
    if (group === 'outline') return surface !== 'text';
    if (group === 'textOutline') return !external;
    return true;
  });
}

export function editStyleParameter(config, group, settings) {
  const key = componentStyleKey(config);
  const groups = { ...styleParametersFor(config) };
  if (settings === null) delete groups[group];
  else groups[group] = settings;
  return { styleParameters: { ...config.styleParameters, [key]: groups } };
}
