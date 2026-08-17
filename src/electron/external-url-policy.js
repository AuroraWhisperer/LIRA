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

  // 仅允许 https: 协议，拒绝 file:, javascript:, data:, ms-settings:, 自定义协议
  if (parsed.protocol !== 'https:') {
    return false;
  }

  return true;
}

/**
 * 验证登录窗口导航 URL 是否在提供商域名白名单内。
 *
 * @param {string} rawUrl - 待验证的 URL
 * @param {string[]} providerDomains - 允许的域名列表（完整主机名，不含协议）
 * @returns {boolean} - URL 必须是 https: 且主机名精确匹配白名单
 */
function isAllowedLoginNavigation(rawUrl, providerDomains) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return false;
  }

  // 仅允许 https: 协议
  if (parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // 精确匹配或子域名匹配
  return providerDomains.some((allowed) => {
    const cleanAllowed = allowed.toLowerCase();
    // 精确匹配
    if (hostname === cleanAllowed) {
      return true;
    }
    // 子域名匹配：example.com 允许 sub.example.com
    if (hostname.endsWith(`.${cleanAllowed}`)) {
      return true;
    }
    return false;
  });
}

module.exports = {
  isAllowedExternal,
  isAllowedLoginNavigation
};
