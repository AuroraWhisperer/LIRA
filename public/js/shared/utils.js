// 编写人：Aurora
// 前端共享工具 — escapedHtml, toast, api, format 系列。
'use strict';

import { dangerConfirm, logoutConfirm, showConfirmationDialog } from './confirmation-dialog.js';
import { toast, showStackedToast } from './toast.js';
import { assertApiResponse, readJsonResponse } from './json-response.js';
import { escapeHtml, escapeAttr } from './html-escape.js';
import {
  formatTime,
  formatDateTime,
  formatBytes,
  formatDuration,
  formatSuperChatPrice,
  formatMoney,
  formatCompactNumber,
} from './display-format.js';

export { dangerConfirm, logoutConfirm, showConfirmationDialog };

const multilingualFontFallback =
  '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';

export { toast, showStackedToast };
export { readJsonResponse };
export { escapeHtml, escapeAttr };
export {
  formatTime,
  formatDateTime,
  formatBytes,
  formatDuration,
  formatSuperChatPrice,
  formatMoney,
  formatCompactNumber,
};

export function value(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

export function setValue(id, nextValue) {
  const el = document.getElementById(id);
  if (el) el.value = nextValue ?? '';
}

export function localOverlayOrigin(locationLike = location) {
  const protocol = locationLike.protocol || 'http:';
  const port = locationLike.port ? `:${locationLike.port}` : '';
  return `${protocol}//127.0.0.1${port}`;
}

export async function copyText(text) {
  const valueToCopy = String(text ?? '');
  if (!valueToCopy) throw new Error('没有可复制的地址。');
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(valueToCopy);
      return;
    } catch (clipboardError) {
      // Fall through to the DOM fallback for Electron and non-secure pages.
      void clipboardError;
    }
  }
  const input = document.createElement('textarea');
  input.value = valueToCopy;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('复制失败，请手动复制地址。');
}

export function withMultilingualFallback(fontFamily) {
  const selected = String(fontFamily || '').trim();
  if (!selected) return multilingualFontFallback;
  return `${selected}, ${multilingualFontFallback}`;
}

export async function api(url, body, { notifyError = true, signal } = {}) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = window.__API_TOKEN__;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      signal,
    });
    return assertApiResponse(response, await readJsonResponse(response, '请求失败'), '请求失败');
  } catch (error) {
    if (notifyError) showError(error);
    throw error;
  }
}

export function showError(error) {
  toast(error.message || String(error), { type: 'error' });
}

export function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function normalizeRangeValue(input, min, max, fallback) {
  const valueNumber = Number(input);
  const fallbackNumber = Number(fallback);
  const safeValue = Number.isFinite(valueNumber) ? valueNumber : fallbackNumber;
  const clamped = Math.max(min, Math.min(max, safeValue));
  return String(Math.round(clamped * 100) / 100);
}

// 聚合导出
export const utils = {
  multilingualFontFallback,
  escapeHtml,
  escapeAttr,
  value,
  setValue,
  localOverlayOrigin,
  copyText,
  formatTime,
  formatDateTime,
  formatBytes,
  formatDuration,
  formatSuperChatPrice,
  formatMoney,
  formatCompactNumber,
  withMultilingualFallback,
  toast,
  showStackedToast,
  api,
  readJsonResponse,
  showError,
  debounce,
  normalizeRangeValue,
  showConfirmationDialog,
  logoutConfirm,
  dangerConfirm,
};

// 【过渡期兼容层】- 保持window.AdminApp.utils可用
// 阶段5时删除
if (typeof window !== 'undefined') {
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.utils = utils;
}
