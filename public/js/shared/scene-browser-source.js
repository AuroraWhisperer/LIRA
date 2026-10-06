export const BROWSER_SOURCE_DEFAULTS = Object.freeze({ url: '', viewportWidth: 800, viewportHeight: 600 });

export function normalizeBrowserSourceConfig(config, { allowEmptyUrl = false } = {}) {
  const invalid = (message) => Object.assign(new Error(message), { code: 'INVALID_SCENE_CONFIG', statusCode: 400 });
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).length !== 3
    || Object.keys(BROWSER_SOURCE_DEFAULTS).some((key) => !Object.hasOwn(config, key))) {
    throw invalid('浏览器源配置无效。');
  }
  const { viewportWidth, viewportHeight } = config;
  if (![viewportWidth, viewportHeight].every((size) => Number.isInteger(size) && size >= 32 && size <= 7680)) {
    throw invalid('网页宽度和高度须为 32–7680 的整数。');
  }
  if (typeof config.url !== 'string' || config.url.length > 8192 || /[\u0000-\u001f\u007f]/.test(config.url)) {
    throw invalid('请输入有效的 HTTP 或 HTTPS 浏览器源地址。');
  }
  const value = config.url.trim();
  if (!value && allowEmptyUrl) return { url: '', viewportWidth, viewportHeight };
  try {
    if (!/^https?:\/\//i.test(value)) throw new Error();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    return { url: url.href, viewportWidth, viewportHeight };
  } catch {
    throw invalid('请输入有效的 HTTP 或 HTTPS 浏览器源地址，不能包含用户名或密码。');
  }
}
