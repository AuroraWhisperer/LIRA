import { MOONLIT_OPENING_DEFAULTS } from './opening-appearance.js';

const opening = name => `/img/overlays/opening-moon-fan/${name}.webp`;
const danmaku = name => `/img/overlays/danmaku-moonlit/${name}.webp`;
const background = '/img/overlays/backgrounds/moonlit.webp';
const movie = '/img/overlays/backgrounds/moonlit-loop-hq-60.webm';
export const NAUTICAL_GUARD_ART = Object.freeze(Object.fromEntries(
  ['captain', 'admiral', 'governor'].map(tier => [tier, `/img/overlays/guard-nautical/${tier}.webp`])));
export const NAUTICAL_GUARD_AVATAR = '/img/overlays/guard-nautical/avatar.png';
export const WOODLAND_GIFT_VIDEO = '/img/overlays/gift-frame/woodland-bloom/woodland-bloom-v4.webm';
export const WINDOWLIGHT_ART = Object.freeze(Object.fromEntries(
  ['sunny', 'sunset', 'rainy', 'night', 'dappled-light', 'prismatic-light', 'window-mask', 'lamp-light']
    .map(name => [name, `/img/overlays/backgrounds/windowlight/${name}.webp`])));

// These are trusted client renderers, never code supplied by an archive.
export const COMPONENT_RESOURCE_PRESETS = Object.freeze({
  'windowlight-background': { type: 'background', config: { style: 'windowlight', sceneMode: 'manual',
    windowScene: 'sunny', sceneIntervalSeconds: 300 }, styles: ['windowlight'], size: [1920, 1080],
    resources: Object.values(WINDOWLIGHT_ART), sheets: [] },
  'woodland-gift-frame': { type: 'gift-frame', config: {}, size: [1920, 1080],
    resources: [WOODLAND_GIFT_VIDEO], sheets: [] },
  'nautical-guard-thanks': { type: 'guard-thanks', config: { textMode: 'follow' },
    size: [1920, 1080], resources: [...Object.values(NAUTICAL_GUARD_ART), NAUTICAL_GUARD_AVATAR],
    sheets: ['/css/overlays/guard-nautical.css'] },
  'moonlit-background': { type: 'background', config: { style: 'moonlit' }, styles: ['moonlit', 'moonlit-animated'],
    size: [1920, 1080], resources: [background, movie], sheets: [] },
  'moonlit-opening': { type: 'opening', config: { style: 'moonlit-fan', ...MOONLIT_OPENING_DEFAULTS }, styles: ['moonlit-fan', 'original'],
    size: [1920, 1080], resources: ['landscape', 'fan', 'title', 'silk', 'flowers-nw', 'flowers-ne', 'flowers-sw',
      'flowers-se', 'crane-body', 'crane-wing-near', 'crane-wing-far', 'jewel-left'].map(opening), sheets: [] },
  'moonlit-clock': { type: 'clock', config: { style: 'moonlit-fan' }, styles: ['moonlit-fan'], size: [580, 380],
    resources: ['fan', 'flowers-ne', 'jewel-left', 'flowers-sw', 'flowers-se'].map(opening)
      .concat('/img/overlays/clock-moonlit-fan/moon-landscape.webp', '/fonts/clock-moon-serif-400.woff2'),
    sheets: ['/css/overlays/clock/moonlit-fan.css'], fontFamily: 'Lira Moon Serif' },
  'moonlit-danmaku': { type: 'danmaku', config: { style: 'moonlit' }, styles: ['moonlit'], size: [480, 800],
    resources: ['brush', 'captain', 'admiral', 'governor', 'flowers', 'scroll-roller', 'guard-landscape', 'crane'].map(danmaku),
    optionalResources: [danmaku('scroll-landscape')],
    sheets: ['/css/overlays/danmaku/moonlit.css'] },
  'moonlit-wishes': { type: 'gift-wishes', config: { displayStyle: 'moonlit' }, styles: ['moonlit'], size: [640, 143],
    resources: ['/img/shared/gift-wish-moonlit.webp', '/img/shared/gift-wish-moonlit-start.svg'],
    sheets: ['/css/shared/gift-wish-moonlit.css'] },
  'moonlit-lyrics': { type: 'lyrics', config: { style: 'moonlit', desktopLyricFontFamily: '月渡花汀文楷',
    desktopLyricFontWeight: '400', desktopLyricFontSize: '48', desktopLyricTextColor: '#48657a',
    desktopLyricTextAlign: 'center', desktopLyricLineHeight: '1.2', desktopLyricVisibleLines: '1',
    desktopLyricStrokeWidth: '0.5', desktopLyricStrokeColor: '#f8f6ef', desktopLyricShadowEnabled: 'false' },
    styles: ['moonlit'], size: [960, 480], resources: [opening('flowers-ne')],
    optionalResources: Array.from({ length: 23 }, (_, index) => `/fonts/moonlit-wenkai/wenkai-${String(index).padStart(2, '0')}.woff2`),
    sheets: ['/css/lyrics/moonlit-font.css', '/css/lyrics/moonlit.css'], fontFamily: '月渡花汀文楷' },
  'moonlit-queue': { type: 'queue', config: { overlayQueueStyle: 'identity', identityQueueFontSize: '30',
    overlayShowIndex: 'true', overlayIndexThreshold: '0', overlayIndexColor: '#735020',
    overlayPin1: '', overlayPin2: '', overlayPin3: '',
    overlayRule1: '', overlayRule2: '', overlayRule3: '',
    overlayRule4: '', overlayRule5: '', overlayRule6: '',
    identityQueueScrollMode: 'bounce', identityQueueScrollSpeed: '80', backdropBlur: '0', glowIntensity: '0' },
    styles: ['identity'], size: [391, 506], resources: [opening('flowers-ne')],
    optionalResources: ['flowers-nw', 'flowers-sw', 'flowers-se'].map(opening)
      .concat('/img/overlays/queue-moonlit/vine-frame-v1.webp', '/img/overlays/queue-moonlit/vine-frame-gold-jade-v2.webp',
        '/img/overlays/queue-moonlit/vine-frame-hd-v3.webp', '/img/overlays/queue-moonlit/moon-lake-frame-hd-v4.webp'),
    sheets: ['/css/overlays/base/queue-moonlit.css'] },
});

export function hasResourceStyles(type) {
  return Object.values(COMPONENT_RESOURCE_PRESETS).some(preset => preset.type === type);
}

const SOURCE = /^\/component-media\/([a-f0-9-]{36})\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4|webm|svg|woff2)$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KEYS = ['id', 'preset', 'preview', 'width', 'height', 'resources'];

export function normalizeResourceStyle(type, input, config) {
  const fail = () => { throw new Error('样式资源无效或不受支持，请更新客户端后重新导入素材包。'); };
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !KEYS.includes(key))) return fail();
  const preset = Object.hasOwn(COMPONENT_RESOURCE_PRESETS, input.preset) && COMPONENT_RESOURCE_PRESETS[input.preset];
  if (!preset || preset.type !== type || !UUID.test(input.id) || !SOURCE.test(input.preview)
    || !/\.(png|jpg|webp)$/.test(input.preview)
    || (preset.styles && !preset.styles.includes(type === 'queue' ? config?.overlayQueueStyle : config?.style || config?.displayStyle))) return fail();
  for (const axis of ['width', 'height']) if (!Number.isInteger(input[axis]) || input[axis] < 1 || input[axis] > 7680) return fail();
  const resources = input.resources;
  const allowed = preset.resources.concat(preset.optionalResources || []);
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)
    || preset.resources.some(key => !Object.hasOwn(resources, key))
    || Object.keys(resources).some(key => !allowed.includes(key))) return fail();
  const pack = SOURCE.exec(input.preview)[1];
  for (const key of Object.keys(resources)) {
    const match = SOURCE.exec(resources[key]);
    if (!match || match[1] !== pack || !resources[key].endsWith(key.slice(key.lastIndexOf('.')))) return fail();
  }
  return { id: input.id, preset: input.preset, preview: input.preview, width: input.width, height: input.height, resources: { ...resources } };
}

export function componentStyleMedia(config) {
  if (config.cssStyle) return { ...config.cssStyle, kind: 'css' };
  if (Object.hasOwn(config, 'url')) return { kind: 'html', width: config.viewportWidth, height: config.viewportHeight };
  return config.resourceStyle ? { ...config.resourceStyle, src: config.resourceStyle.preview, kind: 'image' } : config.mediaStyle;
}

export function isExternalComponentStyle(value) {
  return ['moonlit', 'moonlit-animated', 'moonlit-fan', 'windowlight'].includes(value);
}
