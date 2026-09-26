// 编写人：Aurora
// Electron 外部 URL 安全策略：URI 协议限制、登录域名白名单验证。
'use strict';

/**
 * 验证外部打开的 URL 是否安全（主窗口、shell.openExternal）。
 *
 * @param {string} rawUrl - 待验证的 URL
 * @returns {boolean} - 仅当 URL 使用 https: 协议时返回 true
 */
function isAllowedExternal(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return false;
  }

  return parsed.protocol === 'https:';
}

/**
 * 验证桌面端可交给系统浏览器打开的本机 HTTP 地址。
 * 仅允许 LIRA 绑定的 IPv4 回环地址，避免放宽任意外部 HTTP 导航。
 *
 * @param {string} rawUrl - 待验证的 URL
 * @returns {boolean} - 仅当 URL 是无凭据的 127.0.0.1 HTTP 地址时返回 true
 */
function isAllowedLocalUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return false;
  }

  return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && !parsed.username && !parsed.password;
}

/**
 * 验证登录窗口导航 URL 是否在提供商域名白名单内。
 *
 * @param {string} rawUrl - 待验证的 URL
 * @param {string[]} providerDomains - 允许的域名列表（完整主机名，不含协议）
 * @returns {boolean} - URL 必须是 https: 且主机名匹配白名单域名或其子域名
 */
function isAllowedLoginNavigation(rawUrl, providerDomains) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  return providerDomains.some((allowed) => {
    const cleanAllowed = allowed.toLowerCase();
    return hostname === cleanAllowed || hostname.endsWith(`.${cleanAllowed}`);
  });
}

module.exports = {
  isAllowedExternal,
  isAllowedLocalUrl,
  isAllowedLoginNavigation,
};
