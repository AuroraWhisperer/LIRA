export const MEDIA_STYLE_TYPES = Object.freeze(['background', 'opening', 'danmaku', 'clock', 'gift-wishes', 'gift-frame', 'guard-thanks']);
export const MEDIA_STYLE_TITLES = Object.freeze({ background: '背景', opening: '开播动画', danmaku: '弹幕装饰', clock: '时钟底图',
  'gift-wishes': '许愿装饰', 'gift-frame': '礼物感谢', 'guard-thanks': '大航海感谢' });
export const COMPONENT_MEDIA_SOURCE = /^\/component-media\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4|webm)$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KEYS = ['id', 'src', 'kind', 'width', 'height', 'content', 'textColor', 'fontSize', 'showText', 'textTemplate', 'textDelayMs', 'durationMs', 'volume'];

export function createMediaStyle(type, media) {
  return { ...media, content: { x: 10, y: 10, width: 80, height: 80 }, textColor: '#ffffff',
    fontSize: type === 'clock' ? 64 : 28, showText: ['gift-frame', 'guard-thanks'].includes(type),
    textTemplate: type === 'guard-thanks' ? '感谢 {name} 开通{tier}' : '感谢 {name} 的 {gift} ×{count}',
    textDelayMs: 0, durationMs: media.kind === 'video' ? 120000 : 6000, volume: 0 };
}

export function normalizeMediaStyle(type, input) {
  const fail = () => { throw new Error('素材样式无效，请重新选择文件。'); };
  if (!MEDIA_STYLE_TYPES.includes(type) || !input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !KEYS.includes(key))) return fail();
  const value = createMediaStyle(type, input);
  // Defaults must not replace values supplied by the editor or package author.
  Object.assign(value, input);
  if (!UUID.test(value.id) || !COMPONENT_MEDIA_SOURCE.test(value.src)) return fail();
  if (!['image', 'video'].includes(value.kind) || (value.kind === 'video') !== /\.(mp4|webm)$/.test(value.src)) return fail();
  for (const axis of ['width', 'height']) if (!Number.isInteger(value[axis]) || value[axis] < 1 || value[axis] > 7680) return fail();
  const area = value.content;
  if (!area || Object.keys(area).length !== 4 || !['x', 'y', 'width', 'height'].every(key =>
    typeof area[key] === 'number' && Number.isFinite(area[key]) && area[key] >= 0 && area[key] <= 100)
    || area.width < 5 || area.height < 5 || area.x + area.width > 100.001 || area.y + area.height > 100.001) return fail();
  if (!/^#[a-f0-9]{6}$/i.test(value.textColor) || typeof value.showText !== 'boolean'
    || typeof value.textTemplate !== 'string' || value.textTemplate.length > 160) return fail();
  for (const [key, min, max] of [['fontSize', 12, 200], ['textDelayMs', 0, 60000], ['durationMs', 250, 120000], ['volume', 0, 1]]) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) return fail();
  }
  return { ...value, content: { ...area } };
}

export function formatMediaThanks(template, payload) {
  const values = { name: payload.userName || '', gift: payload.giftName || '', count: payload.num || 1,
    tier: ({ captain: '舰长', admiral: '提督', governor: '总督' })[payload.tier] || '', months: payload.months || 1 };
  return template.replace(/\{(name|gift|count|tier|months)\}/g, (_match, key) => String(values[key]));
}
