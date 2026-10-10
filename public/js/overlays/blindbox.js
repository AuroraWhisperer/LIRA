// 编写人：AuroraWhisperer
// 盲盒盈亏 overlay — 直播间投屏展示
'use strict';

import { escapeHtml, hexToRgba } from './overlay-utils-module.js';
import { applyOverlayTheme } from './overlay-theme.js';
import { createOverlaySocket } from './socket-client.js';
import { startOverlayPages } from './auto-pages.js';
import { isComponentPreview } from './component-preview-client.js';
import { mountSceneExtraClient } from './scene-extra-client.js';

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
let TOP_N = Number.isFinite(requestedTop) ? Math.min(10, Math.max(-1, requestedTop)) : 3;
let SUMMARY_ONLY = TOP_N === 0;
let COMPACT = param('compact', 'c') === '1';
let WINNERS_ONLY = param('winners', 'w') === '1' || urlParams.get('show') === 'winners';
let HEART_BOX_ONLY = param('heartBox', 'hb') === '1';
const CUSTOM_TITLE = (param('title', 'tt') || '').trim();
let HIDE_LOSS = param('hideLoss', 'hl') === '1' || WINNERS_ONLY;
const REFRESH_SEC = Math.max(10, parseInt(param('refresh', 'r') || '0', 10) || 0);
let NO_SCROLL = param('noScroll', 'ns') !== '0';

document.addEventListener('DOMContentLoaded', () => {
  const panel = document.querySelector('.blindbox-panel');
  if (isComponentPreview()) {
    mountSceneExtraClient('blindbox', {
      onConfig(config) {
        state = { settings: config };
        TOP_N = config.top; SUMMARY_ONLY = TOP_N === 0; COMPACT = config.compact;
        WINNERS_ONLY = config.winnersOnly; HIDE_LOSS = config.hideLoss; NO_SCROLL = config.noScroll;
        HEART_BOX_ONLY = config.heartBoxOnly;
        for (const [name, active] of [['compact', COMPACT], ['winners-only', WINNERS_ONLY], ['no-scroll', NO_SCROLL], ['summary-only', SUMMARY_ONLY]]) panel.classList.toggle(name, active);
        stopPages?.(); stopPages = NO_SCROLL ? startOverlayPages(panel) : null;
        lastContentKey = null;
        render(lastStats || { summary: {}, perUser: [] });
      },
      onData(data) { lastStats = data || { summary: {}, perUser: [] }; render(lastStats); },
      onDispose() { stopPages?.(); },
    });
    return;
  }
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
    if (payload.ok && revision === stateRevision) { state = payload.data; receiveAppearance(); }
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
        receiveAppearance();
        render(lastStats);
      }
      // 礼物相关更新时刷新统计数据
      const reason = payload.reason || '';
      if (reason.startsWith('bilibili:gift') || reason === 'gift:sprint:reset' || reason === 'connect' || reason === 'settings') {
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

function receiveAppearance() {
  const settings = state?.settings || {};
  if (param('top', 't') === null && settings.blindboxOverlayTop !== undefined) {
    TOP_N = Math.max(-1, Math.min(10, Number(settings.blindboxOverlayTop)));
    SUMMARY_ONLY = TOP_N === 0;
  }
  if (param('winners', 'w') === null && !urlParams.has('show')) WINNERS_ONLY = settings.blindboxWinnersOnly === 'true';
  if (param('heartBox', 'hb') === null) HEART_BOX_ONLY = settings.blindboxHeartBoxOnly === 'true';
  if (param('compact', 'c') === null) COMPACT = settings.blindboxCompact === 'true';
  if (param('noScroll', 'ns') === null) {
    const autoPages = settings.blindboxAutoPages !== 'false';
    if (autoPages !== NO_SCROLL) {
      NO_SCROLL = autoPages;
      stopPages?.();
      stopPages = NO_SCROLL ? startOverlayPages(document.querySelector('.blindbox-panel')) : null;
    }
  }
  HIDE_LOSS = param('hideLoss', 'hl') === '1' || WINNERS_ONLY;
  const panel = document.querySelector('.blindbox-panel');
  panel?.classList.toggle('compact', COMPACT);
  panel?.classList.toggle('no-scroll', NO_SCROLL);
  panel?.classList.toggle('winners-only', WINNERS_ONLY);
  panel?.classList.toggle('summary-only', SUMMARY_ONLY);
}

function render(stats) {
  const settings = (state && state.settings) || {};

  // 应用主题
  applyTheme(settings);
  renderHeartBoxProgress(settings, stats);

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
    totalValue: 0,
    totalProfit: 0,
  };
  if (SUMMARY_ONLY || summaryValues.boxCount > 0) {
    const profitClass = summaryValues.totalProfit >= 0 ? 'profit-up' : 'profit-down';
    const profitSign = summaryValues.totalProfit >= 0 ? '+' : '-';
    summaryEl.innerHTML = `
      <div class="blindbox-summary-meta">
        <span class="summary-boxes"><span class="stat-value">${summaryValues.boxCount}</span> 盒</span>
        <span class="summary-cost">花费 <span class="stat-value">¥${formatMoney(summaryValues.totalCost)}</span></span>
        <span class="summary-value">开出价值 <span class="stat-value">¥${formatMoney(summaryValues.totalValue)}</span></span>
      </div>
      <div class="blindbox-total ${profitClass}" role="group" aria-label="总盈亏">
        <span class="stat-value">${profitSign}¥${formatMoney(Math.abs(summaryValues.totalProfit))}</span>
      </div>
    `;
  } else {
    summaryEl.innerHTML = '';
  }

  // ── 排行榜 ──
  const leaderboard = document.getElementById('blindboxLeaderboard');
  if (SUMMARY_ONLY) {
    leaderboard.innerHTML = '';
    return;
  }

  if (users.length === 0) {
    const emptyText = summaryValues.boxCount > 0
      ? (HIDE_LOSS ? '暂无盈利观众' : '暂无上榜观众')
      : '等待开盒';
    leaderboard.innerHTML = `
      <div class="blindbox-empty">
        <span class="empty-text">${emptyText}</span>
      </div>
    `;
  } else {
    const rows = users
      .map((user, index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const profitSign = user.totalProfit >= 0 ? '+' : '-';
        const profitIsUp = user.totalProfit >= 0;
        const isLoss = user.totalProfit < 0;

        return `
        <div class="leaderboard-row ${rankClass}${isLoss ? ' is-loss' : ''}">
          <div class="rank-badge">${rank}</div>
          <div class="user-info">
            <span class="user-name">${escapeHtml(user.userName)}</span>
            <div class="user-result">
              <span class="box-count">${user.boxCount} 盒</span>
              <span class="profit-value ${profitIsUp ? 'is-up' : 'is-down'}">${profitSign}¥${formatMoney(Math.abs(user.totalProfit))}</span>
            </div>
          </div>
        </div>
      `;
      })
      .join('');

    leaderboard.innerHTML = rows;
  }
}

function renderHeartBoxProgress(settings, stats) {
  const progress = document.getElementById('blindboxHeartProgress');
  const parts = [];
  const enabled = key => settings[key] === true || settings[key] === 'true';
  if (HEART_BOX_ONLY) {
    const multiplier = Number(settings.blindboxCastleMultiplier);
    if (Number.isFinite(multiplier) && multiplier > 0) {
      parts.push(`<span class="heart-multiplier">今天 <strong>${multiplier}</strong> 倍堡</span>`);
    }
    const remaining = Number(settings.blindboxCastlesRemaining);
    if (enabled('blindboxShowCastlesRemaining') && Number.isSafeInteger(remaining) && remaining >= 0) {
      parts.push(`<span>还有 <strong>${remaining}</strong> 个堡</span>`);
    }
    const opened = stats?.heartBoxProgress?.openedSinceCastle;
    if (enabled('blindboxShowOpenedSinceCastle') && Number.isSafeInteger(opened) && opened >= 0) {
      parts.push(`<span>已开 <strong>${opened}</strong> 个盲盒</span>`);
    }
  }
  const html = parts.join('');
  if (progress.innerHTML !== html) progress.innerHTML = html;
  progress.hidden = !parts.length;
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
