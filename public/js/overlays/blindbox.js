// 编写人：AuroraWhisperer
// 盲盒盈亏 overlay — 直播间投屏展示
'use strict';

import { escapeHtml, hexToRgba } from './overlay-utils-module.js';
import { applyOverlayTheme } from './overlay-theme.js';
import { createOverlaySocket } from './socket-client.js';
import { startOverlayPages } from './auto-pages.js';

let state = null;
let stateRevision = 0;
let statsRevision = 0;
let lastStats = null;
let lastContentKey = null;
let socketController = null;
let refreshTimer = null;
let stopPages = null;
let initialBlindboxViewportWidth = 0;
let initialBlindboxViewportHeight = 0;
let blindboxViewportResized = false;

// URL 参数解析 — 支持短别名：t=top, w=winners, c=compact, tt=title
const urlParams = new URLSearchParams(location.search);
const param = (longKey, shortKey) => urlParams.get(longKey) || urlParams.get(shortKey);
const requestedTop = Number.parseInt(param('top', 't') || '3', 10);
const TOP_N = Number.isFinite(requestedTop) ? Math.min(10, Math.max(-1, requestedTop)) : 3;
const SUMMARY_ONLY = TOP_N === 0;
const COMPACT = param('compact', 'c') === '1';
const WINNERS_ONLY = param('winners', 'w') === '1' || urlParams.get('show') === 'winners';
const HEART_BOX_ONLY = param('heartBox', 'hb') === '1';
const CUSTOM_TITLE = (param('title', 'tt') || '').trim();
const HIDE_LOSS = param('hideLoss', 'hl') === '1' || WINNERS_ONLY;
const REFRESH_SEC = Math.max(10, parseInt(param('refresh', 'r') || '0', 10) || 0);
const NO_SCROLL = param('noScroll', 'ns') !== '0';

document.addEventListener('DOMContentLoaded', () => {
  const panel = document.querySelector('.blindbox-panel');
  initialBlindboxViewportWidth = window.innerWidth;
  initialBlindboxViewportHeight = window.innerHeight;
  window.addEventListener('resize', handleBlindboxViewportResize);
  if (COMPACT) panel.classList.add('compact');
  if (WINNERS_ONLY) panel.classList.add('winners-only');
  if (NO_SCROLL) panel.classList.add('no-scroll');
  if (NO_SCROLL) stopPages = startOverlayPages(panel);
  if (SUMMARY_ONLY) panel.classList.add('summary-only');

  if (CUSTOM_TITLE) {
    document.getElementById('blindboxTitle').textContent = CUSTOM_TITLE;
  }

  loadStateThenStats();
  connectSocket();
  window.addEventListener('beforeunload', disposeSocket, { once: true });

  if (REFRESH_SEC > 0) {
    refreshTimer = setInterval(loadStats, REFRESH_SEC * 1000);
  }
});

function handleBlindboxViewportResize() {
  const widthChanged = window.innerWidth !== initialBlindboxViewportWidth;
  const heightChanged = window.innerHeight !== initialBlindboxViewportHeight;
  if (blindboxViewportResized || (!widthChanged && !heightChanged)) return;

  blindboxViewportResized = true;
  document.body.classList.add('blindbox-viewport-resized');
}

async function loadStateThenStats() {
  const revision = ++stateRevision;
  try {
    const response = await fetch('/api/state');
    const payload = await response.json();
    if (payload.ok && revision === stateRevision) state = payload.data;
  } catch (error) {
    console.warn('[overlay-blindbox] loadState failed:', error.message || error);
  }
  await loadStats();
}

async function loadStats() {
  const revision = ++statsRevision;
  try {
    const boxFilter = HEART_BOX_ONLY ? '?boxName=' + encodeURIComponent('心动盲盒') : '';
    const response = await fetch('/api/gifts/blind-box-stats' + boxFilter);
    const payload = await response.json();
    if (payload.ok && revision === statsRevision) {
      render(payload.data);
    }
  } catch (error) {
    console.warn('[overlay-blindbox] loadStats failed:', error.message || error);
  }
}

function connectSocket() {
  if (socketController) return;
  socketController = createOverlaySocket({
    onReconnect: () => {
      loadStats();
    },
    onMessage: (payload) => {
      if (payload.type !== 'snapshot') return;
      if (payload.state) {
        stateRevision += 1;
        state = payload.state;
        render(lastStats);
      }
      // 礼物相关更新时刷新统计数据
      const reason = payload.reason || '';
      if (reason.startsWith('bilibili:gift') || reason === 'gift:sprint:reset' || reason === 'connect') {
        loadStats();
      }
    },
  });
  socketController.start();
}

function disposeSocket() {
  stateRevision += 1;
  statsRevision += 1;
  clearInterval(refreshTimer);
  stopPages?.();
  stopPages = null;
  window.removeEventListener('resize', handleBlindboxViewportResize);
  socketController?.dispose();
  socketController = null;
}

function render(stats) {
  const settings = (state && state.settings) || {};

  // 应用主题
  applyTheme(settings);

  // 自定义标题（URL 参数优先，其次 settings）
  if (!CUSTOM_TITLE) {
    const title = document.getElementById('blindboxTitle');
    const settingsTitle = String(settings.blindboxOverlayTitle || '').trim();
    title.textContent = settingsTitle || '今日盲盒盈亏';
  }

  if (!stats) return;
  lastStats = stats;
  const { summary, perUser } = stats;

  // 过滤和排序
  let users = Array.isArray(perUser) ? [...perUser] : [];
  if (HIDE_LOSS) {
    users = users.filter((u) => u.totalProfit > 0);
  }
  if (TOP_N > 0) {
    users = users.slice(0, TOP_N);
  }
  const contentKey = JSON.stringify([summary, users]);
  if (contentKey === lastContentKey) return;
  lastContentKey = contentKey;

  // ── 汇总 ──
  const summaryEl = document.getElementById('blindboxSummary');
  const summaryValues = summary || {
    boxCount: 0,
    totalCost: 0,
    totalProfit: 0,
  };
  if (SUMMARY_ONLY || summaryValues.boxCount > 0) {
    const profitClass = summaryValues.totalProfit >= 0 ? 'profit-up' : 'profit-down';
    const profitSign = summaryValues.totalProfit >= 0 ? '+' : '-';
    summaryEl.innerHTML = `
      <div class="blindbox-stat-card">
        <span class="stat-icon">📦</span>
        <span class="stat-value">${summaryValues.boxCount}</span>
        <span class="stat-label">盒子数</span>
      </div>
      <div class="blindbox-stat-card">
        <span class="stat-icon">💰</span>
        <span class="stat-value">¥${formatMoney(summaryValues.totalCost)}</span>
        <span class="stat-label">总成本</span>
      </div>
      <div class="blindbox-stat-card ${profitClass}">
        <span class="stat-icon">${summaryValues.totalProfit >= 0 ? '📈' : '📉'}</span>
        <span class="stat-value">${profitSign}¥${formatMoney(Math.abs(summaryValues.totalProfit))}</span>
        <span class="stat-label">总盈亏</span>
      </div>
    `;
  } else {
    summaryEl.innerHTML = `
      <div class="blindbox-stat-card" style="grid-column:1/-1">
        <span class="stat-icon">🎁</span>
        <span class="stat-value">—</span>
        <span class="stat-label">今天还没有盲盒礼物</span>
      </div>
    `;
  }

  // ── 排行榜 ──
  const leaderboard = document.getElementById('blindboxLeaderboard');
  if (SUMMARY_ONLY) {
    leaderboard.innerHTML = '';
    return;
  }

  if (users.length === 0) {
    leaderboard.innerHTML = `
      <div class="blindbox-empty">
        <span class="empty-icon">🎰</span>
        <span class="empty-text">${HIDE_LOSS ? '今天还没有盈利的观众' : '暂无数据'}</span>
      </div>
    `;
  } else {
    const rows = users
      .map((user, index) => {
        const rank = index + 1;
        let rankClass = '';
        let rankIcon = '';
        if (rank === 1) {
          rankClass = 'rank-1';
          rankIcon = '👑';
        } else if (rank === 2) {
          rankClass = 'rank-2';
          rankIcon = '🥈';
        } else if (rank === 3) {
          rankClass = 'rank-3';
          rankIcon = '🥉';
        }

        const profitSign = user.totalProfit >= 0 ? '+' : '-';
        const profitIsUp = user.totalProfit >= 0;
        const isLoss = user.totalProfit < 0;

        // 头衔
        let titleHtml = '';
        if (rank === 1 && user.totalProfit > 0) {
          titleHtml = '<span class="user-title lucky-king">欧皇</span>';
        } else if (user.totalProfit > 20) {
          titleHtml = '<span class="user-title lucky">好运</span>';
        }

        return `
        <div class="leaderboard-row ${rankClass}${isLoss ? ' is-loss' : ''}">
          <div class="rank-badge">${rank <= 3 ? rankIcon : rank}</div>
          <div class="user-info">
            <span class="user-name">${escapeHtml(user.userName)}</span>
            ${titleHtml}
          </div>
          <span class="box-count">${user.boxCount}个</span>
          <span class="profit-value ${profitIsUp ? 'is-up' : 'is-down'}">${profitSign}¥${formatMoney(Math.abs(user.totalProfit))}</span>
        </div>
      `;
      })
      .join('');

    // 预览表头
    const headerHtml = COMPACT
      ? ''
      : `
      <div class="leaderboard-header">
        <span>排行</span>
        <span></span>
        <span>数量</span>
        <span>盈亏</span>
      </div>
    `;

    leaderboard.innerHTML = headerHtml + rows;
  }

  // ── 底部 ── 已移除更新时间和参数显示
}

function applyTheme(settings) {
  if (!settings) return;
  const panel = document.querySelector('.blindbox-panel');
  const root = document.documentElement;
  applyOverlayTheme(root, panel, settings);

  panel.style.backgroundColor = hexToRgba(settings.themeBackground || '#181823', settings.themeOpacity || 0.76);
}

// ── 工具函数 ──

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return number.toFixed(2);
}
