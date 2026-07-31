// 编写人：Aurora
// 前端共享工具 — escapedHtml, toast, api, format 系列。
// 挂载到 window.AdminApp.utils
'use strict';

(function () {
  const multilingualFontFallback = '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';

  let activeToastKeys = new Set();

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function value(id) {
    return document.getElementById(id).value.trim();
  }

  function setValue(id, nextValue) {
    const el = document.getElementById(id);
    if (el) el.value = nextValue ?? '';
  }

  function formatTime(v) {
    if (!v) return '';
    return new Date(v).toLocaleTimeString('zh-CN', { hour12: false });
  }

  function formatDateTime(v) {
    if (!v) return '--';
    return new Date(v).toLocaleString('zh-CN', { hour12: false });
  }

  function formatBytes(v) {
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

  function formatDuration(seconds) {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) return '--';
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = Math.floor(total % 60);
    if (hours > 0) return `${hours}小时${minutes}分钟`;
    if (minutes > 0) return `${minutes}分钟${rest}秒`;
    return `${rest}秒`;
  }

  function formatSuperChatPrice(v) {
    const number = Number(v);
    if (!Number.isFinite(number)) return '0';
    return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function formatMoney(v) {
    const number = Number(v);
    if (!Number.isFinite(number) || number <= 0) return '¥0.00';
    return `¥${number.toFixed(2)}`;
  }

  function formatCompactNumber(v) {
    const number = Math.max(0, Number(v) || 0);
    if (number >= 100000000) return `${(number / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
    if (number >= 10000) return `${(number / 10000).toFixed(1).replace(/\.0$/, '')}万`;
    return String(Math.round(number));
  }

  function withMultilingualFallback(fontFamily) {
    const selected = String(fontFamily || '').trim();
    if (!selected) return multilingualFontFallback;
    return `${selected}, ${multilingualFontFallback}`;
  }

  function toast(message) {
    showStackedToast({ key: `toast:${message}`, message, duration: 2600 });
  }

  function showStackedToast(options) {
    const container = document.getElementById('toast');
    if (!container) return;
    const key = options.key || `toast:${options.title || ''}:${options.message || ''}`;
    if (activeToastKeys.has(key)) return;
    activeToastKeys.add(key);

    const node = document.createElement('div');
    node.className = `toast${options.className ? ` ${options.className}` : ''}`;
    if (options.title) {
      node.innerHTML = `<strong>${escapeHtml(options.title)}</strong><span>${escapeHtml(options.message || '')}</span>`;
    } else {
      node.textContent = options.message || '';
    }
    if (typeof options.onClick === 'function') {
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.addEventListener('click', options.onClick);
      node.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        options.onClick();
      });
    }
    container.prepend(node);
    void node.offsetWidth;
    node.classList.add('show');
    const duration = Number.isFinite(Number(options.duration)) ? Number(options.duration) : 2600;
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => { activeToastKeys.delete(key); node.remove(); }, 180);
    }, duration);
  }

  async function api(url, body) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const payload = await readJsonResponse(response, '请求失败');
      if (!payload.ok) throw new Error(payload.error || '请求失败');
      return payload;
    } catch (error) {
      showError(error);
      throw error;
    }
  }

  async function readJsonResponse(response, fallbackMessage) {
    const text = await response.text();
    if (!text) {
      if (!response.ok) throw new Error(`${fallbackMessage}（HTTP ${response.status}）`);
      return {};
    }
    try { return JSON.parse(text); } catch (_) {
      const preview = text.replace(/\s+/g, ' ').slice(0, 80);
      throw new Error(`${fallbackMessage}：服务返回了非 JSON 内容（HTTP ${response.status}${preview ? `，${preview}` : ''}）`);
    }
  }

  function showError(error) {
    toast(error.message || String(error));
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function normalizeRangeValue(input, min, max, fallback) {
    const valueNumber = Number(input);
    const fallbackNumber = Number(fallback);
    const safeValue = Number.isFinite(valueNumber) ? valueNumber : fallbackNumber;
    const clamped = Math.max(min, Math.min(max, safeValue));
    return String(Math.round(clamped * 100) / 100);
  }

  /**
   * 右上角危险操作确认弹窗 — 替代原生 confirm()
   * @param {Object} opts
   * @param {string} opts.title       - 弹窗标题
   * @param {string} opts.message     - 主消息（正文）
   * @param {string[]} [opts.deletes] - 将被删除的项目列表
   * @param {string[]} [opts.keeps]   - 保留的项目列表
   * @param {string} [opts.confirmLabel] - 确认按钮文案，默认 "确认清空"
   * @returns {Promise<boolean>}
   */
  function dangerConfirm(opts) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'danger-confirm-backdrop';

      const deletesHtml = opts.deletes && opts.deletes.length
        ? `<ul>${opts.deletes.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
        : '';
      const keepsHtml = opts.keeps && opts.keeps.length
        ? `<div class="danger-confirm-keep"><strong>保留：</strong>${opts.keeps.map(k => escapeHtml(k)).join(' · ')}</div>`
        : '';

      backdrop.innerHTML = `
        <div class="danger-confirm-popup" role="alertdialog" aria-labelledby="dc-title" aria-describedby="dc-msg">
          <div class="danger-confirm-body">
            <div class="danger-confirm-header">
              <div class="danger-confirm-icon-wrap" aria-hidden="true">!</div>
              <div class="danger-confirm-header-text">
                <h3 class="danger-confirm-title" id="dc-title">${escapeHtml(opts.title || '确认操作')}</h3>
                <span class="danger-confirm-subtitle">此操作不可撤销</span>
              </div>
            </div>
            <div class="danger-confirm-message" id="dc-msg">
              ${escapeHtml(opts.message || '')}${deletesHtml}
            </div>
            ${keepsHtml}
            <div class="danger-confirm-actions">
              <button class="danger-confirm-cancel" type="button">取消</button>
              <button class="danger-confirm-execute" type="button">${escapeHtml(opts.confirmLabel || '确认清空')}</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const cancelBtn = backdrop.querySelector('.danger-confirm-cancel');
      const executeBtn = backdrop.querySelector('.danger-confirm-execute');

      function close(result) {
        backdrop.classList.add('is-leaving');
        backdrop.addEventListener('animationend', () => {
          backdrop.remove();
          resolve(result);
        }, { once: true });
        // 兜底：animationend 不触发时也清理
        setTimeout(() => { if (backdrop.parentNode) { backdrop.remove(); resolve(result); } }, 300);
      }

      cancelBtn.addEventListener('click', () => close(false));
      executeBtn.addEventListener('click', () => close(true));

      // 点击遮罩关闭
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close(false);
      });

      // ESC 关闭
      function onKey(e) {
        if (e.key === 'Escape') { close(false); }
      }
      document.addEventListener('keydown', onKey, { once: true });

      // 自动聚焦确认按钮
      requestAnimationFrame(() => executeBtn.focus());
    });
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.utils = {
    multilingualFontFallback,
    escapeHtml, escapeAttr, value, setValue,
    formatTime, formatDateTime, formatBytes, formatDuration,
    formatSuperChatPrice, formatMoney, formatCompactNumber,
    withMultilingualFallback, toast, showStackedToast,
    api, readJsonResponse, showError, debounce, normalizeRangeValue,
    dangerConfirm
  };
})();
