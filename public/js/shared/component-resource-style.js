const opening = name => `/img/overlays/opening-moon-fan/${name}.webp`;
const danmaku = name => `/img/overlays/danmaku-moonlit/${name}.webp`;
const background = '/img/overlays/backgrounds/moonlit.webp';
const movie = '/img/overlays/backgrounds/moonlit-loop-hq-60.webm';

// These are trusted client renderers, never code supplied by an archive.
export const COMPONENT_RESOURCE_PRESETS = Object.freeze({
  'moonlit-background': { type: 'background', config: { style: 'moonlit' }, styles: ['moonlit', 'moonlit-animated'],
    size: [1920, 1080], resources: [background, movie], sheets: [] },
  'moonlit-opening': { type: 'opening', config: { style: 'moonlit-fan' }, styles: ['moonlit-fan', 'original'],
    size: [1920, 1080], resources: ['landscape', 'fan', 'title', 'silk', 'flowers-nw', 'flowers-ne', 'flowers-sw',
      'flowers-se', 'crane-body', 'crane-wing-near', 'crane-wing-far', 'jewel-left'].map(opening), sheets: [] },
  'moonlit-clock': { type: 'clock', config: { style: 'moonlit-fan' }, styles: ['moonlit-fan'], size: [580, 380],
    resources: ['fan', 'flowers-ne', 'jewel-left', 'flowers-sw', 'flowers-se'].map(opening)
      .concat('/img/overlays/clock-moonlit-fan/moon-landscape.webp', '/fonts/clock-moon-serif-400.woff2'),
    sheets: ['/css/overlays/clock/moonlit-fan.css'], fontFamily: 'Lira Moon Serif' },
  'moonlit-danmaku': { type: 'danmaku', config: { style: 'moonlit' }, styles: ['moonlit'], size: [480, 800],
    resources: ['brush', 'captain', 'admiral', 'governor', 'flowers', 'scroll-roller', 'guard-landscape', 'crane'].map(danmaku),
    sheets: ['/css/overlays/danmaku/moonlit.css'] },
  'moonlit-wishes': { type: 'gift-wishes', config: { displayStyle: 'moonlit' }, styles: ['moonlit'], size: [640, 400],
    resources: ['/img/shared/gift-wish-moonlit.webp', '/img/shared/gift-wish-moonlit-start.svg'],
    sheets: ['/css/shared/gift-wish-moonlit.css'] },
});

const SOURCE = /^\/component-media\/([a-f0-9-]{36})\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4|webm|svg|woff2)$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KEYS = ['id', 'preset', 'preview', 'width', 'height', 'resources'];

export function normalizeResourceStyle(type, input, config) {
  const fail = () => { throw new Error('套装资源无效或不受支持，请更新客户端后重新导入套装。'); };
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !KEYS.includes(key))) return fail();
  const preset = Object.hasOwn(COMPONENT_RESOURCE_PRESETS, input.preset) && COMPONENT_RESOURCE_PRESETS[input.preset];
  if (!preset || preset.type !== type || !UUID.test(input.id) || !SOURCE.test(input.preview)
    || !/\.(png|jpg|webp)$/.test(input.preview) || !preset.styles.includes(config?.style || config?.displayStyle)) return fail();
  for (const axis of ['width', 'height']) if (!Number.isInteger(input[axis]) || input[axis] < 1 || input[axis] > 7680) return fail();
  const resources = input.resources;
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)
    || Object.keys(resources).length !== preset.resources.length) return fail();
  const pack = SOURCE.exec(input.preview)[1];
  for (const key of preset.resources) {
    const match = SOURCE.exec(resources[key]);
    if (!match || match[1] !== pack || !resources[key].endsWith(key.slice(key.lastIndexOf('.')))) return fail();
  }
  return { id: input.id, preset: input.preset, preview: input.preview, width: input.width, height: input.height, resources: { ...resources } };
}

export function componentStyleMedia(config) {
  return config.resourceStyle ? { ...config.resourceStyle, src: config.resourceStyle.preview, kind: 'image' } : config.mediaStyle;
}

export function isExternalComponentStyle(value) {
  return ['moonlit', 'moonlit-animated', 'moonlit-fan'].includes(value);
}
