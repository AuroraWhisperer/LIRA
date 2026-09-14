// 编写人：Aurora
// 前端共享工具 — escapedHtml, toast, api, format 系列。
'use strict';

import {
  dangerConfirm,
  logoutConfirm,
  showConfirmationDialog,
} from './confirmation-dialog.js';
import { toast, showStackedToast } from './toast.js';

export { dangerConfirm, logoutConfirm, showConfirmationDialog };

const multilingualFontFallback =
  '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';

export { toast, showStackedToast };

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

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

export function formatTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('zh-CN', { hour12: false });
}

export function formatDateTime(v) {
  if (!v) return '--';
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

export function formatBytes(v) {
  const bytes = Number(v);
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
}

export function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '--';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = Math.floor(total % 60);
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  if (minutes > 0) return `${minutes}分钟${rest}秒`;
  return `${rest}秒`;
}

export function formatSuperChatPrice(v) {
  const number = Number(v);
  if (!Number.isFinite(number)) return '0';
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatMoney(v) {
  const number = Number(v);
  if (!Number.isFinite(number) || number <= 0) return '¥0.00';
  return `¥${number.toFixed(2)}`;
}

export function formatCompactNumber(v) {
  const number = Math.max(0, Number(v) || 0);
  if (number >= 100000000)
    return `${(number / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
  if (number >= 10000)
    return `${(number / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  return String(Math.round(number));
}

export function withMultilingualFallback(fontFamily) {
  const selected = String(fontFamily || '').trim();
  if (!selected) return multilingualFontFallback;
  return `${selected}, ${multilingualFontFallback}`;
}

export async function api(url, body, { notifyError = true } = {}) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = window.__API_TOKEN__;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });
    const payload = await readJsonResponse(response, '请求失败');
    if (!payload.ok) {
      const error = new Error(payload.error || '请求失败');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (notifyError) showError(error);
    throw error;
  }
}

export async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  if (!text) {
    if (!response.ok)
      throw new Error(`${fallbackMessage}（HTTP ${response.status}）`);
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    const preview = text.replace(/\s+/g, ' ').slice(0, 80);
    throw new Error(
      `${fallbackMessage}：服务返回了非 JSON 内容（HTTP ${response.status}${preview ? `，${preview}` : ''}）`,
    );
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
