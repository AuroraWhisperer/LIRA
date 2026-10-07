export const COMPONENT_WEB_PREFIX = '/component-web/';

export function isComponentWebSource(value) {
  if (typeof value !== 'string' || !/^\/component-web\/[a-f0-9-]{36}\/.+/.test(value) || /[?#\\\u0000-\u001f]/.test(value)) return false;
  try {
    return decodeURIComponent(value).split('/').slice(3).every(part => part && part !== '.' && part !== '..' && !/[\\:*?"<>|]/.test(part));
  } catch { return false; }
}

export function normalizeComponentCssStyle(type, value) {
  const fail = () => { throw new Error('CSS 样式无效，请重新导入。'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['id', 'src', 'engine', 'width', 'height'].includes(key))
    || !/^[a-f0-9-]{36}$/.test(value.id) || !isComponentWebSource(value.src) || !/\.css$/i.test(value.src)
    || !['native', 'blivechat', 'blc'].includes(value.engine)
    || (value.engine !== 'native' && type !== 'danmaku')) return fail();
  for (const axis of ['width', 'height']) if (!Number.isInteger(value[axis]) || value[axis] < 32 || value[axis] > 7680) return fail();
  return { id: value.id, src: value.src, engine: value.engine, width: value.width, height: value.height };
}

export function detectComponentCssEngine(css, type) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/yt-live-chat-|yt-live-chat-author-chip|blc-guard-level/.test(source)) {
    if (type !== 'danmaku') throw new Error('这是弹幕 CSS，请在弹幕姬中导入。');
    return 'blivechat';
  }
  if (/\.danmaku-(?:author-(?:face|name)|content|message|item)\b/.test(source)) {
    if (type !== 'danmaku') throw new Error('这是弹幕 CSS，请在弹幕姬中导入。');
    return 'blc';
  }
  if (/\.event--(?:message|gift|toast)|--event-message-/.test(source)) {
    throw new Error('这是 LAPLACE 弹幕样式，请在 LAPLACE 配置中应用后导入它的浏览器源地址，或选择作者提供的配套 HTML。');
  }
  return 'native';
}

export function componentCssRendererUrl(config, fallback) {
  return config?.cssStyle && config.cssStyle.engine !== 'native'
    ? `/imported-danmaku?componentPreview=1${String(fallback).includes('sceneComponent=1') ? '&sceneComponent=1' : ''}` : fallback;
}
